import json
import hashlib
import os
import re
import subprocess
import sys
import zipfile
import csv
from queue import Empty, Queue
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from decimal import Decimal
from io import BytesIO
from io import StringIO
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import Lock, Thread
from time import perf_counter
from urllib.parse import urlparse, urlunparse
from uuid import uuid4
from xml.etree import ElementTree

import pandas as pd
import requests
from flask import Blueprint, Response, current_app, jsonify, request, send_file, send_from_directory, stream_with_context
from werkzeug.datastructures import FileStorage

from .db import execute, executemany, normalize_row, normalize_rows, query
from .services.agent import run_agent
from .services.citations import (
    CITATION_FAILED,
    CITATION_READY,
    best_title_match,
    citation_export_text,
    citation_formats_from_paper,
    citation_status_from_paper,
    citation_status_summary,
    extract_doi,
    extract_pdf_bibliography,
    fetch_and_persist_citation,
    load_papers_for_citation,
    mark_citation_status,
)
from .services.pdf import extract_pdf_metadata, extract_pdf_text, save_pdf, upload_pdf_to_object_store
from .services.llm import chat_completion, chat_completion_stream, list_available_models, llm_metadata, translate_text_stream
from .services.paper_qa import answer_paper_question, build_answer_messages, prepare_paper_qa_context, select_pdf_evidence, store_pdf_chunks
from .services.search_provider import search_web
from .services.skills import install_skill, list_skills, resolve_installed_skills, uninstall_skill

api = Blueprint("api", __name__)
citation_executor = ThreadPoolExecutor(max_workers=int(os.getenv("CITATION_FETCH_WORKERS", "4")))
pdf_task_executor = ThreadPoolExecutor(max_workers=int(os.getenv("PDF_TASK_WORKERS", "2")))
pdf_file_executor = ThreadPoolExecutor(max_workers=int(os.getenv("PDF_FILE_WORKERS", "4")))
citation_inflight = set()
citation_inflight_lock = Lock()
pdf_tasks = {}
pdf_tasks_lock = Lock()


def normalize_library_rows(rows):
    libraries = normalize_rows(rows)
    for library in libraries:
        count = library.get("paper_count", 0)
        if isinstance(count, Decimal):
            count = int(count)
        library["paper_count"] = count or 0
    return libraries


def normalize_paper_rows(rows):
    papers = normalize_rows(rows)
    seen = set()
    unique = []
    for paper in papers:
        paper_id = paper.get("id")
        if paper_id in seen:
            continue
        seen.add(paper_id)
        unique.append(paper)
    return unique


def body():
    return request.get_json(silent=True) or {}


def ok(payload=None, status=200):
    return jsonify(payload or {}), status


def pdf_task_snapshot(task_id):
    with pdf_tasks_lock:
        task = pdf_tasks.get(task_id)
        if task:
            return json.loads(json.dumps(task, default=str))
    if not str(task_id).isdigit():
        return None
    row = normalize_row(query("SELECT result_json FROM paper_tasks WHERE id=%s", (int(task_id),), one=True))
    return (row or {}).get("result_json") or None


def persist_pdf_task(task):
    if not task or not str(task.get("id")).isdigit():
        return
    execute(
        """
        UPDATE paper_tasks
        SET status=%s, library_id=%s, result_json=%s, error=%s, updated_at=CURRENT_TIMESTAMP
        WHERE id=%s
        """,
        (
            task.get("status") or "running",
            task.get("library_id"),
            task,
            task.get("error") or "",
            int(task["id"]),
        ),
    )


def persist_pdf_task_by_id(task_id):
    with pdf_tasks_lock:
        task = pdf_tasks.get(task_id)
        task_copy = json.loads(json.dumps(task, default=str)) if task else None
    persist_pdf_task(task_copy)


def create_pdf_task(kind, total, library_id=None, library_name=""):
    db_id = execute(
        """
        INSERT INTO paper_tasks (library_id, type, status, input_json, result_json)
        VALUES (%s, %s, 'running', %s, %s)
        RETURNING id
        """,
        (library_id, kind, {"library_name": library_name, "total": total}, {}),
    )
    task_id = str(db_id)
    now = datetime.utcnow().isoformat()
    task = {
        "id": task_id,
        "kind": kind,
        "status": "running",
        "library_id": library_id,
        "library_name": library_name,
        "total": total,
        "done": 0,
        "failed": 0,
        "items": [],
        "created_at": now,
        "updated_at": now,
        "result": None,
        "error": "",
    }
    with pdf_tasks_lock:
        pdf_tasks[task_id] = task
    persist_pdf_task(task)
    return task_id


def update_pdf_task(task_id, **updates):
    should_persist = False
    with pdf_tasks_lock:
        task = pdf_tasks.get(task_id)
        if not task:
            return
        task.update(updates)
        task["updated_at"] = datetime.utcnow().isoformat()
        should_persist = True
    if should_persist:
        persist_pdf_task_by_id(task_id)


def update_pdf_task_item(task_id, index, **updates):
    should_persist = False
    with pdf_tasks_lock:
        task = pdf_tasks.get(task_id)
        if not task or index >= len(task.get("items", [])):
            return
        task["items"][index].update(updates)
        task["updated_at"] = datetime.utcnow().isoformat()
        task["done"] = sum(1 for item in task["items"] if item.get("status") == "done")
        task["failed"] = sum(1 for item in task["items"] if item.get("status") == "error")
        should_persist = True
    if should_persist:
        persist_pdf_task_by_id(task_id)


def materialize_pdf_uploads(file_storages):
    uploads = []
    for file_storage in file_storages:
        stream = file_storage.stream
        try:
            stream.seek(0)
        except Exception:
            pass
        data = stream.read()
        if not data:
            continue
        uploads.append(FileStorage(
            stream=BytesIO(data),
            filename=file_storage.filename or "paper.pdf",
            content_type=file_storage.content_type or "application/pdf",
        ))
    return uploads


@api.get("/llm/models")
def llm_models_route():
    try:
        return ok(list_available_models())
    except Exception as exc:
        fallback_model = os.getenv("LLM_MODEL", "")
        return ok({
            "default_model": fallback_model,
            "models": [{"id": fallback_model, "name": fallback_model}] if fallback_model else [],
            "error": str(exc),
        })


def parse_list_value(value):
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if value:
        return [item.strip() for item in str(value).split(",") if item.strip()]
    return []


def parse_rank_values(value):
    ranks = []
    for item in parse_list_value(value):
        rank = re.sub(r"^CCF[\s_-]*", "", item.strip(), flags=re.IGNORECASE).upper()
        if rank[:1] in {"A", "B", "C"}:
            ranks.append(rank[:1])
    return list(dict.fromkeys(ranks))


def normalize_folder_path(value):
    return "/".join(part.strip() for part in str(value or "").split("/") if part.strip())


ROOT_FOLDER_MARKER = "__root__"


def folder_marker(folder):
    return normalize_folder_path(folder) or ROOT_FOLDER_MARKER


def normalize_extra_folders(value):
    if not isinstance(value, list):
        return []
    folders = []
    for item in value:
        marker = ROOT_FOLDER_MARKER if item == ROOT_FOLDER_MARKER else normalize_folder_path(item)
        if marker and marker not in folders:
            folders.append(marker)
    return folders


def folder_where_clause(folder):
    if folder == "__all__":
        return "", []
    if folder:
        return (
            " AND (COALESCE(lp.user_columns_json->>'folder', '') = %s"
            " OR COALESCE(lp.user_columns_json->'folders', '[]'::jsonb) ? %s)",
            [folder, folder],
        )
    return (
        " AND (COALESCE(lp.user_columns_json->>'folder', '') = ''"
        " OR COALESCE(lp.user_columns_json->'folders', '[]'::jsonb) ? %s)",
        [ROOT_FOLDER_MARKER],
    )


def apply_folder_operation(columns, target_folder, action="move", current_folder=None):
    data = dict(columns or {})
    primary = normalize_folder_path(data.get("folder"))
    extras = normalize_extra_folders(data.get("folders"))
    target = normalize_folder_path(target_folder)
    target_marker = folder_marker(target)
    source_marker = None if current_folder == "__all__" else folder_marker(current_folder) if current_folder is not None else None

    if action == "copy":
        if target_marker != folder_marker(primary) and target_marker not in extras:
            extras.append(target_marker)
    else:
        if source_marker is None:
            primary = target
        elif source_marker == folder_marker(primary):
            primary = target
        elif source_marker in extras:
            extras = [item for item in extras if item != source_marker]
            if target_marker != folder_marker(primary) and target_marker not in extras:
                extras.append(target_marker)
        else:
            primary = target
        extras = [item for item in extras if item != folder_marker(primary)]

    if primary:
        data["folder"] = primary
    else:
        data.pop("folder", None)
    if extras:
        data["folders"] = extras
    else:
        data.pop("folders", None)
    return data


def parse_filters(payload):
    rank_value = payload.get("rank") or ""
    ranks_value = parse_rank_values(payload.get("ranks"))
    if not ranks_value and rank_value:
        ranks_value = parse_rank_values(rank_value)
    venue_value = (payload.get("venue") or "").strip()
    venues_value = parse_list_value(payload.get("venues"))
    if not venues_value and venue_value:
        venues_value = [venue_value]
    return {
        "keyword": (payload.get("keyword") or "").strip(),
        "venue": venue_value,
        "venues": venues_value,
        "year_from": payload.get("year_from") or None,
        "year_to": payload.get("year_to") or None,
        "rank": rank_value,
        "ranks": ranks_value,
        "shared_with": payload.get("shared_with") or [],
        "tag_definitions": payload.get("tag_definitions") or [],
        "folders": payload.get("folders") or [],
    }


PAPER_VENUE_NAME_SQL = """
COALESCE(
    NULLIF(v.venue_name, ''),
    CASE WHEN jsonb_typeof(p.paper_details) = 'object' THEN p.paper_details->>'journal' END,
    CASE WHEN jsonb_typeof(p.paper_details) = 'object' THEN p.paper_details->>'booktitle' END,
    CASE WHEN jsonb_typeof(p.paper_details) = 'string' THEN (p.paper_details#>>'{}')::jsonb->>'journal' END,
    CASE WHEN jsonb_typeof(p.paper_details) = 'string' THEN (p.paper_details#>>'{}')::jsonb->>'booktitle' END,
    v.dblp_detail_key
)
"""


TABLE_SORT_COLUMNS = {
    "title": "p.title",
    "year": "p.pub_year",
    "rank": "CASE cvr.rank WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END",
    "venue": f"COALESCE(NULLIF(mv.venue_abbr, ''), NULLIF(v.venue_abbr, ''), {PAPER_VENUE_NAME_SQL})",
    "added_at": "lp.created_at",
}
DEFAULT_TABLE_SORTS = [("rank", "asc"), ("year", "desc")]


def serialize_table_sorts(sort_items):
    return ",".join(f"{column}:{direction}" for column, direction in sort_items)


def parse_table_sorts(payload):
    raw_sort = (payload.get("sort") or "").strip()
    if raw_sort.lower() == "none":
        return []
    sort_items = []
    if raw_sort:
        for token in raw_sort.split(","):
            column, _, direction = token.strip().partition(":")
            column = column.strip()
            direction = direction.strip().lower()
            if column in TABLE_SORT_COLUMNS and direction in {"asc", "desc"}:
                sort_items.append((column, direction))
    elif payload.get("sort_by"):
        column = (payload.get("sort_by") or "").strip()
        direction = "asc" if (payload.get("sort_dir") or "desc").lower() == "asc" else "desc"
        if column in TABLE_SORT_COLUMNS:
            sort_items.append((column, direction))

    deduped = []
    seen = set()
    for column, direction in sort_items:
        if column in seen:
            continue
        seen.add(column)
        deduped.append((column, direction))
    return deduped or list(DEFAULT_TABLE_SORTS)


def table_order_clause(sort_items):
    parts = [
        f"{TABLE_SORT_COLUMNS[column]} {direction.upper()} NULLS LAST"
        for column, direction in sort_items
        if column in TABLE_SORT_COLUMNS and direction in {"asc", "desc"}
    ]
    parts.append("p.id DESC")
    return " ORDER BY " + ", ".join(parts)


def paper_select_sql(extra_where="", include_library=False):
    library_cols = """
        lp.library_id, lp.tags_json, lp.notes, lp.status, lp.user_columns_json, lp.created_at AS added_at,
    """ if include_library else ""
    return f"""
        SELECT
            p.id, p.dblp_key, p.title, p.authors, p.pub_year, p.pub_url, p.doi_url, p.paper_details,
            {PAPER_VENUE_NAME_SQL} AS venue_name,
            v.venue_abbr, v.dblp_url,
            COALESCE(NULLIF(mv.venue_abbr, ''), NULLIF(v.venue_abbr, '')) AS main_venue_abbr,
            COALESCE(NULLIF(mv.venue_name, ''), NULLIF(v.venue_name, '')) AS main_venue_name,
            c.category_name, cvr.rank,
            pd.abstract, pd.abstract_source, pd.detail_snippet, pd.pdf_text_preview,
            pd.bib, pd.pdf_url, pd.metadata_json,
            {library_cols}
            COALESCE(pd.updated_at, pd.created_at) AS detail_updated_at
        FROM papers p
        LEFT JOIN venues v ON p.ref_venue = v.id
        LEFT JOIN venues mv ON mv.id = v.main_venue_id
        LEFT JOIN category_venue_rankings cvr ON cvr.venue_id = COALESCE(v.main_venue_id, v.id)
        LEFT JOIN categories c ON c.id = cvr.category_id
        LEFT JOIN paper_detail pd ON pd.paper_id = p.id
        {extra_where}
    """


def apply_paper_filters(filters, prefix="WHERE"):
    conditions = []
    params = []
    keyword = filters.get("keyword")
    if keyword:
        tsquery, tsquery_fn = normalize_keyword_query(keyword)
        conditions.append(f"p.fts @@ {tsquery_fn}('english', %s)")
        params.append(tsquery)
    venue_ids = []
    venues = filters.get("venues") or []
    for venue in venues:
        like = f"%{venue}%"
        venue_rows = query(
            """
            SELECT DISTINCT child.id
            FROM venues matched
            JOIN venues child ON COALESCE(child.main_venue_id, child.id) = COALESCE(matched.main_venue_id, matched.id)
            WHERE matched.main_venue_id IS NULL
              AND NULLIF(TRIM(matched.venue_name), '') IS NOT NULL
              AND (
                   matched.venue_name ILIKE %s
                OR matched.venue_abbr ILIKE %s
                OR matched.dblp_key ILIKE %s
                OR matched.dblp_detail_key ILIKE %s
              )
            LIMIT 5000
            """,
            (like, like, like, like),
        )
        venue_ids.extend(row["id"] for row in venue_rows)
    venue_ids = list(dict.fromkeys(venue_ids))
    if filters.get("year_from"):
        conditions.append("p.pub_year >= %s")
        params.append(int(filters["year_from"]))
    if filters.get("year_to"):
        conditions.append("p.pub_year <= %s")
        params.append(int(filters["year_to"]))
    ranks = [rank for rank in (filters.get("ranks") or []) if rank in {"A", "B", "C"}]
    venue_rank_conditions = []
    venue_rank_params = []
    if venues:
        if venue_ids:
            placeholders = ",".join(["%s"] * len(venue_ids))
            venue_rank_conditions.append(f"p.ref_venue IN ({placeholders})")
            venue_rank_params.extend(venue_ids)
        else:
            venue_rank_conditions.append("FALSE")
    if ranks:
        placeholders = ",".join(["%s"] * len(ranks))
        venue_rank_conditions.append(f"cvr.rank IN ({placeholders})")
        venue_rank_params.extend(ranks)
    if venue_rank_conditions:
        conditions.append("(" + " OR ".join(venue_rank_conditions) + ")")
        params.extend(venue_rank_params)
    return (f" {prefix} " + " AND ".join(conditions), params) if conditions else ("", params)


BOOLEAN_QUERY_TOKEN_RE = re.compile(
    r'"[^"]+"|\(|\)|\bAND\b|\bOR\b|\bNOT\b|&|\||!|-|[A-Za-z0-9][A-Za-z0-9_./:-]*',
    flags=re.I,
)


def is_advanced_keyword_query(value):
    return bool(re.search(r"\b(?:AND|OR|NOT)\b|[()&|!]|<->|:\*", value or "", flags=re.I))


def sanitize_tsquery_terms(value):
    text = str(value or "").strip().strip('"')
    prefix = text.endswith(":*")
    if prefix:
        text = text[:-2]
    terms = [
        term.lower()
        for term in re.findall(r"[A-Za-z0-9]+", text)
        if term
    ]
    if not terms:
        return ""
    rendered = " <-> ".join(terms)
    if prefix and len(terms) == 1:
        rendered = f"{rendered}:*"
    return rendered


def normalize_keyword_query(value):
    keyword = str(value or "").strip()
    if not keyword:
        return "", "websearch_to_tsquery"
    if not is_advanced_keyword_query(keyword):
        return keyword, "websearch_to_tsquery"

    tokens = BOOLEAN_QUERY_TOKEN_RE.findall(keyword)
    if not tokens:
        return keyword, "websearch_to_tsquery"

    output = []
    previous_was_operand = False
    expect_operand = True
    balance = 0

    def append_implicit_and_if_needed(next_is_operand):
        if previous_was_operand and next_is_operand:
            output.append("&")

    for token in tokens:
        raw = token.strip()
        upper = raw.upper()
        if upper in {"AND", "&"}:
            if not previous_was_operand:
                return keyword, "websearch_to_tsquery"
            output.append("&")
            previous_was_operand = False
            expect_operand = True
            continue
        if upper in {"OR", "|"}:
            if not previous_was_operand:
                return keyword, "websearch_to_tsquery"
            output.append("|")
            previous_was_operand = False
            expect_operand = True
            continue
        if upper in {"NOT", "!", "-"}:
            append_implicit_and_if_needed(True)
            output.append("!")
            previous_was_operand = False
            expect_operand = True
            continue
        if raw == "(":
            append_implicit_and_if_needed(True)
            output.append("(")
            balance += 1
            previous_was_operand = False
            expect_operand = True
            continue
        if raw == ")":
            if balance <= 0 or expect_operand:
                return keyword, "websearch_to_tsquery"
            output.append(")")
            balance -= 1
            previous_was_operand = True
            expect_operand = False
            continue

        term = sanitize_tsquery_terms(raw)
        if not term:
            continue
        append_implicit_and_if_needed(True)
        output.append(term)
        previous_was_operand = True
        expect_operand = False

    if balance != 0 or expect_operand or not output:
        return keyword, "websearch_to_tsquery"
    return " ".join(output), "to_tsquery"


def get_library_or_404(library_id):
    lib = query("SELECT * FROM paper_libraries WHERE id=%s", (library_id,), one=True)
    return normalize_row(lib)


def add_papers_to_library(library_id, paper_ids):
    if not paper_ids:
        return 0
    rows = [(library_id, int(pid)) for pid in paper_ids]
    added = executemany(
        """
        INSERT INTO library_papers (library_id, paper_id)
        VALUES (%s, %s)
        ON CONFLICT (library_id, paper_id) DO UPDATE SET status='active'
        """,
        rows,
    )
    schedule_citation_fetch(library_id, paper_ids)
    return added


def schedule_citation_fetch(library_id, paper_ids):
    paper_ids = [int(pid) for pid in (paper_ids or []) if pid]
    if not paper_ids:
        return
    papers = load_papers_for_citation(library_id, paper_ids)
    for paper in papers:
        if citation_status_from_paper(paper) == CITATION_READY:
            continue
        mark_citation_status(paper["id"], "pending")
        submit_citation_fetch(paper)


def submit_citation_fetch(paper, force=False):
    paper_id = paper.get("id")
    if not paper_id:
        return False
    with citation_inflight_lock:
        if paper_id in citation_inflight:
            return False
        citation_inflight.add(paper_id)

    def run():
        try:
            fetch_and_persist_citation(paper, force)
        finally:
            with citation_inflight_lock:
                citation_inflight.discard(paper_id)

    citation_executor.submit(run)
    return True


def citation_fetch_inflight(paper_id):
    with citation_inflight_lock:
        return paper_id in citation_inflight


def schedule_unfinished_citations(papers):
    scheduled = 0
    for paper in papers:
        paper_id = paper.get("id")
        if not paper_id:
            continue
        status = citation_status_from_paper(paper)
        if status in {CITATION_READY, CITATION_FAILED}:
            continue
        if citation_fetch_inflight(paper_id):
            continue
        metadata = paper.get("metadata_json") if isinstance(paper.get("metadata_json"), dict) else {}
        extra = {"citation_rescheduled_at": datetime.utcnow().isoformat()} if metadata.get("citation_status") == "pending" else {}
        mark_citation_status(paper_id, "pending", extra)
        if submit_citation_fetch(paper):
            scheduled += 1
    return scheduled


def auto_folder_for_tags(library_id, tags):
    library = get_library_or_404(library_id) or {}
    filters = library.get("filters_json") or {}
    definitions = filters.get("tag_definitions") or filters.get("tags") or []
    selected_tags = set(tags or [])
    for definition in reversed(definitions):
        if definition.get("auto_folder") and definition.get("name") in selected_tags:
            return definition["name"]
    return None


def apply_auto_tag_folders(library_id, filters):
    definitions = (filters or {}).get("tag_definitions") or (filters or {}).get("tags") or []
    for definition in definitions:
        folder = definition.get("name")
        if not definition.get("auto_folder") or not folder:
            continue
        execute(
            """
            UPDATE library_papers
            SET user_columns_json=COALESCE(user_columns_json, '{}'::jsonb) || %s
            WHERE library_id=%s
              AND COALESCE(tags_json, '[]'::jsonb) ? %s
            """,
            ({"folder": folder}, library_id, folder),
        )


def iter_pdf_uploads(files):
    for file_storage in files:
        filename = file_storage.filename or ""
        lower_name = filename.lower()
        if lower_name.endswith(".zip"):
            with zipfile.ZipFile(file_storage.stream) as archive:
                for item in archive.infolist():
                    if item.is_dir() or not item.filename.lower().endswith(".pdf"):
                        continue
                    basename = Path(item.filename).name
                    if not basename:
                        continue
                    yield FileStorage(
                        stream=BytesIO(archive.read(item)),
                        filename=basename,
                        content_type="application/pdf",
                    )
        elif lower_name.endswith(".pdf"):
            yield file_storage


def clean_pdf_title_candidate(value):
    text = re.sub(r"\s+", " ", value or "").strip(" -_.,;:|")
    text = re.sub(r"(?i)\b(arxiv|doi|abstract|keywords?|introduction)\b.*$", "", text).strip()
    return text[:300]


def pdf_title_candidates(original_filename, extracted_text):
    candidates = []
    filename_title = clean_pdf_title_candidate(Path(original_filename or "paper").stem.replace("_", " ").replace("-", " "))
    if filename_title:
        candidates.append(filename_title)
    for line in (extracted_text or "").splitlines()[:24]:
        candidate = clean_pdf_title_candidate(line)
        if 12 <= len(candidate) <= 220 and sum(char.isalpha() for char in candidate) >= 8:
            candidates.append(candidate)
    unique = []
    seen = set()
    for candidate in candidates:
        key = candidate.lower()
        if key not in seen:
            seen.add(key)
            unique.append(candidate)
    return unique[:6]


def plausible_pdf_title(value):
    text = clean_pdf_title_candidate(value)
    if not text:
        return False
    lowered = text.lower()
    if lowered in {"untitled", "unknown", "paper", "manuscript", "document"}:
        return False
    if any(token in lowered for token in ("microsoft word", "latex", "acrobat", "springer nature")):
        return False
    letters = sum(char.isalpha() for char in text)
    return 12 <= len(text) <= 260 and letters >= 8


def extract_arxiv_id(value):
    text = str(value or "")
    patterns = [
        r"arxiv[:\s/]*(\d{4}\.\d{4,5})(?:v\d+)?",
        r"arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5})(?:v\d+)?",
        r"\b(\d{4}\.\d{4,5})(?:v\d+)?\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.I)
        if match:
            return match.group(1)
    return ""


def pdf_identifier_text(original_filename, extracted_text, bibliography=None, metadata=None):
    bibliography = bibliography or {}
    metadata = metadata or {}
    parts = [
        original_filename,
        extracted_text[:20000] if extracted_text else "",
        bibliography.get("title"),
        bibliography.get("url"),
        bibliography.get("doi"),
        metadata.get("title"),
        metadata.get("subject"),
    ]
    return "\n".join(str(part or "") for part in parts)


def fetch_pdf_title_by_doi(doi):
    doi = extract_doi(doi)
    if not doi:
        return {}
    timeout = int(os.getenv("PDF_TITLE_LOOKUP_TIMEOUT_SECONDS", "8"))
    attempts = []
    endpoints = [
        ("crossref", f"https://api.crossref.org/v1/works/{requests.utils.quote(doi, safe='')}"),
        ("openalex", f"https://api.openalex.org/works/https://doi.org/{requests.utils.quote(doi, safe='')}"),
        ("semantic_scholar", f"https://api.semanticscholar.org/graph/v1/paper/DOI:{requests.utils.quote(doi, safe='')}?fields=title"),
    ]
    for source, url in endpoints:
        try:
            response = requests.get(url, timeout=timeout)
            response.raise_for_status()
            data = response.json()
        except (requests.RequestException, ValueError) as exc:
            attempts.append({"source": source, "status": "failed", "reason": str(exc)[:180]})
            continue
        title = ""
        if source == "crossref":
            titles = ((data.get("message") or {}).get("title") or [])
            title = titles[0] if titles else ""
        elif source == "openalex":
            title = data.get("title") or data.get("display_name") or ""
        else:
            title = data.get("title") or ""
        attempts.append({"source": source, "status": "success", "title_found": bool(title)})
        if plausible_pdf_title(title):
            return {"title": clean_pdf_title_candidate(title), "source": source, "doi": doi, "attempts": attempts}
    return {"doi": doi, "attempts": attempts}


def fetch_pdf_title_by_arxiv(arxiv_id):
    arxiv_id = extract_arxiv_id(arxiv_id)
    if not arxiv_id:
        return {}
    timeout = int(os.getenv("PDF_TITLE_LOOKUP_TIMEOUT_SECONDS", "8"))
    try:
        response = requests.get(f"https://export.arxiv.org/api/query?id_list={arxiv_id}", timeout=timeout)
        response.raise_for_status()
        root = ElementTree.fromstring(response.text)
    except (requests.RequestException, ElementTree.ParseError):
        return {"arxiv_id": arxiv_id, "attempts": [{"source": "arxiv", "status": "failed"}]}
    namespace = {"atom": "http://www.w3.org/2005/Atom"}
    entry = root.find("atom:entry", namespace)
    title = entry.findtext("atom:title", default="", namespaces=namespace) if entry is not None else ""
    title = re.sub(r"\s+", " ", title).strip()
    if plausible_pdf_title(title):
        return {"title": clean_pdf_title_candidate(title), "source": "arxiv", "arxiv_id": arxiv_id, "attempts": [{"source": "arxiv", "status": "success", "title_found": True}]}
    return {"arxiv_id": arxiv_id, "attempts": [{"source": "arxiv", "status": "success", "title_found": False}]}


def fetch_pdf_identifier_title(original_filename, extracted_text, bibliography=None, metadata=None):
    text = pdf_identifier_text(original_filename, extracted_text, bibliography, metadata)
    doi = extract_doi(text)
    if doi:
        result = fetch_pdf_title_by_doi(doi)
        if result.get("title"):
            return result
    arxiv_id = extract_arxiv_id(text)
    if arxiv_id:
        result = fetch_pdf_title_by_arxiv(arxiv_id)
        if result.get("title"):
            return result
    return {}


def best_pdf_title(original_filename, extracted_text, bibliography=None, metadata=None, identifier_metadata=None):
    candidates = []
    bibliography = bibliography or {}
    metadata = metadata or {}
    identifier_metadata = identifier_metadata or {}
    if identifier_metadata.get("title"):
        candidates.append(clean_pdf_title_candidate(identifier_metadata["title"]))
    for value in (bibliography.get("title"), metadata.get("title")):
        if plausible_pdf_title(value):
            candidates.append(clean_pdf_title_candidate(value))
    candidates.extend(pdf_title_candidates(original_filename, extracted_text))
    return next((candidate for candidate in candidates if plausible_pdf_title(candidate)), "") or (
        Path(original_filename or "paper").stem.replace("_", " ").replace("-", " ").strip() or "Uploaded PDF"
    )


def find_matching_paper_for_pdf(original_filename, extracted_text, preferred_titles=None):
    candidates = [
        clean_pdf_title_candidate(title)
        for title in (preferred_titles or [])
        if plausible_pdf_title(title)
    ]
    candidates.extend(pdf_title_candidates(original_filename, extracted_text))
    unique_candidates = []
    seen = set()
    for candidate in candidates:
        key = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", candidate.lower())
        if key and key not in seen:
            seen.add(key)
            unique_candidates.append(candidate)

    for candidate in unique_candidates:
        normalized = clean_pdf_title_candidate(candidate)
        terms = [
            term.lower()
            for term in re.findall(r"[A-Za-z0-9]{4,}", normalized)
            if term.lower() not in {"with", "from", "using", "based", "paper", "study", "analysis"}
        ][:8]
        term_filters = ""
        term_params = []
        if terms:
            term_filters = " AND " + " AND ".join(["lower(title) LIKE %s"] * min(3, len(terms)))
            term_params = [f"%{term}%" for term in terms[:3]]
        rows = query(
            f"""
            WITH candidates AS (
                SELECT id, title, dblp_key, pub_year, pub_url, doi_url
                FROM papers
                WHERE dblp_key NOT LIKE 'upload/%%'
                  AND (
                    lower(title) = lower(%s)
                    OR title ILIKE %s
                    {term_filters}
                  )
                LIMIT 50
            )
            SELECT id, title, dblp_key, pub_year, pub_url, doi_url,
                   similarity(lower(title), lower(%s)) AS score
            FROM candidates
            WHERE lower(title) = lower(%s)
               OR similarity(lower(title), lower(%s)) >= 0.42
            ORDER BY (lower(title) = lower(%s)) DESC, score DESC, id DESC
            LIMIT 1
            """,
            tuple([candidate, f"%{candidate[:120]}%"] + term_params + [candidate, candidate, candidate, candidate]),
        )
        if rows:
            match = normalize_row(rows[0])
            match["matched_candidate"] = candidate
            return match
    return None


def create_uploaded_paper(original_filename, title):
    return execute(
        """
        INSERT INTO papers (dblp_key, title, authors, paper_details)
        VALUES (%s, %s, %s, %s)
        RETURNING id
        """,
        (
            f"upload/{uuid4().hex}",
            title,
            [],
            {"source": "pdf_upload", "original_filename": original_filename},
        ),
    )


def safe_extract_pdf_text(path, original_filename="paper.pdf"):
    try:
        return extract_pdf_text(path), ""
    except Exception as exc:
        message = str(exc) or exc.__class__.__name__
        current_app.logger.warning("Failed to extract PDF text from %s: %s", original_filename, message)
        return "", message


def safe_extract_pdf_bibliography(path, original_filename="paper.pdf"):
    try:
        return extract_pdf_bibliography(path), ""
    except Exception as exc:
        message = str(exc) or exc.__class__.__name__
        current_app.logger.warning("Failed to extract PDF bibliography from %s: %s", original_filename, message)
        return {}, message


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def remove_local_file(path):
    if not path:
        return False
    try:
        upload_root = Path(current_app.config["UPLOAD_FOLDER"]).resolve()
        target = Path(path).resolve()
        if upload_root not in target.parents and target != upload_root:
            return False
        if target.exists():
            target.unlink()
            return True
    except Exception as exc:
        current_app.logger.warning("Failed to remove local upload %s: %s", path, exc)
    return False


def find_duplicate_pdf_upload(file_hash, library_id=None, paper_id=None):
    if not file_hash:
        return None
    conditions = ["pu.file_hash=%s"]
    params = [file_hash]
    if library_id:
        conditions.append("pu.library_id=%s")
        params.append(library_id)
    if paper_id:
        conditions.append("pu.paper_id=%s")
        params.append(paper_id)
    return normalize_row(query(
        f"""
        SELECT pu.id, pu.paper_id, pu.library_id, pu.filename, pu.original_filename, pu.file_path, pu.extracted_text,
               p.title AS paper_title
        FROM paper_uploads pu
        LEFT JOIN papers p ON p.id = pu.paper_id
        WHERE {" AND ".join(conditions)}
        ORDER BY pu.created_at DESC
        LIMIT 1
        """,
        tuple(params),
        one=True,
    ))


def persist_pdf_upload(file_storage, library_id=None, paper_id=None, create_paper=False, progress=None):
    progress = progress or (lambda *_args, **_kwargs: None)
    original_filename = file_storage.filename or "paper.pdf"
    title = Path(original_filename).stem.replace("_", " ").replace("-", " ").strip() or "Uploaded PDF"
    progress("storing", "保存 PDF")
    filename, path = save_pdf(file_storage, current_app.config["UPLOAD_FOLDER"])
    file_hash = file_sha256(path)
    duplicate = find_duplicate_pdf_upload(file_hash, library_id=library_id, paper_id=paper_id)
    if not duplicate and library_id:
        duplicate = find_duplicate_pdf_upload(file_hash, library_id=library_id)
    if duplicate:
        progress("done", "已存在，跳过重复 PDF")
        remove_local_file(path)
        if library_id and duplicate.get("paper_id"):
            add_papers_to_library(library_id, [duplicate["paper_id"]])
        return {
            "paper_id": duplicate.get("paper_id") or paper_id,
            "title": duplicate.get("paper_title") or title,
            "filename": duplicate.get("filename") or filename,
            "original_filename": duplicate.get("original_filename") or original_filename,
            "pdf_url": duplicate.get("file_path") or "",
            "object_key": None,
            "association_mode": "duplicate",
            "matched_paper": None,
            "text_preview": (duplicate.get("extracted_text") or "")[:1200],
            "parse_error": "",
            "bibliography_error": "",
            "duplicate": True,
            "local_retained": False,
        }
    progress("parsing", "解析 PDF")
    text, text_error = safe_extract_pdf_text(path, original_filename)
    pdf_bibliography, bibliography_error = safe_extract_pdf_bibliography(path, original_filename)
    pdf_metadata = extract_pdf_metadata(path)
    identifier_metadata = fetch_pdf_identifier_title(original_filename, text, pdf_bibliography, pdf_metadata)
    extracted_title = best_pdf_title(original_filename, text, pdf_bibliography, pdf_metadata, identifier_metadata)
    matched_paper = None
    association_mode = "attached"
    if create_paper and not paper_id:
        started = perf_counter()
        progress("matching", "匹配论文")
        matched_paper = find_matching_paper_for_pdf(
            original_filename,
            text,
            [
                extracted_title,
                identifier_metadata.get("title"),
                pdf_bibliography.get("title"),
                pdf_metadata.get("title"),
            ],
        )
        progress("matching", f"匹配完成 {int((perf_counter() - started) * 1000)}ms")
        if matched_paper:
            paper_id = matched_paper["id"]
            title = matched_paper.get("title") or title
            association_mode = "matched"
        else:
            title = extracted_title
            paper_id = create_uploaded_paper(original_filename, title)
            association_mode = "created"

    try:
        progress("storing", "保存到对象存储")
        object_url, object_key = upload_pdf_to_object_store(path, filename)
    except Exception:
        current_app.logger.exception("Failed to upload PDF to object storage; serving the local copy instead.")
        object_url, object_key = None, None
    pdf_url = object_url or f"/api/uploads/{filename}"
    stored_path = object_url or path
    if object_url:
        remove_local_file(path)

    if paper_id:
        progress("associating", "关联论文")
        upload_id = execute(
            """
            INSERT INTO paper_uploads (paper_id, library_id, filename, original_filename, file_path, extracted_text, file_hash)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (paper_id, library_id, filename, original_filename, stored_path, text, file_hash),
        )
        store_pdf_chunks(paper_id, upload_id, text)
        execute(
            """
            INSERT INTO paper_detail (paper_id, pdf_text_preview, bib, pdf_url, metadata_json)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (paper_id) DO UPDATE
            SET pdf_text_preview=COALESCE(NULLIF(EXCLUDED.pdf_text_preview, ''), paper_detail.pdf_text_preview),
                bib=COALESCE(NULLIF(EXCLUDED.bib, ''), paper_detail.bib),
                pdf_url=EXCLUDED.pdf_url,
                metadata_json=COALESCE(paper_detail.metadata_json, '{}'::jsonb) || EXCLUDED.metadata_json,
                updated_at=CURRENT_TIMESTAMP
            """,
            (
                paper_id,
                text[:12000],
                pdf_bibliography.get("bibtex") or "",
                pdf_url,
                {
                    "uploaded_pdf": filename,
                    "object_key": object_key,
                    "file_hash": file_hash,
                    "original_filename": original_filename,
                    "extracted_title": extracted_title,
                    "pdf_metadata": pdf_metadata,
                    "identifier_metadata": identifier_metadata,
                    "source": "pdf_upload",
                    "association_mode": association_mode,
                    "matched_paper_id": matched_paper.get("id") if matched_paper else None,
                    "matched_candidate": matched_paper.get("matched_candidate") if matched_paper else None,
                    "pdf_bibliography": pdf_bibliography,
                    "pdf_parse_error": text_error or None,
                    "pdf_bibliography_error": bibliography_error or None,
                },
            ),
        )
        if library_id:
            add_papers_to_library(library_id, [paper_id])

    progress("done", "处理完成")
    return {
        "paper_id": paper_id,
        "title": title,
        "filename": filename,
        "original_filename": original_filename,
        "extracted_title": extracted_title,
        "pdf_url": pdf_url,
        "object_key": object_key,
        "association_mode": association_mode,
        "matched_paper": matched_paper,
        "text_preview": text[:1200],
        "parse_error": text_error,
        "bibliography_error": bibliography_error,
        "duplicate": False,
        "local_retained": not bool(object_url),
    }


def sync_dynamic_library(library_id):
    lib = get_library_or_404(library_id)
    if not lib:
        return 0
    filters = lib.get("filters_json") or {}
    where, params = apply_paper_filters(filters)
    rows = query(f"SELECT DISTINCT p.id FROM papers p LEFT JOIN venues v ON p.ref_venue=v.id LEFT JOIN category_venue_rankings cvr ON cvr.venue_id=COALESCE(v.main_venue_id, v.id) {where} LIMIT 5000", tuple(params))
    added = add_papers_to_library(library_id, [row["id"] for row in rows])
    execute("UPDATE paper_libraries SET last_synced_at=CURRENT_TIMESTAMP WHERE id=%s", (library_id,))
    return added


def process_pdf_task_item(app, task_id, index, file_storage, library_id):
    with app.app_context():
        def progress(stage, detail=""):
            update_pdf_task_item(task_id, index, stage=stage, detail=detail, status="running")

        update_pdf_task_item(task_id, index, status="running", stage="uploading", detail="接收上传")
        try:
            upload = persist_pdf_upload(
                file_storage,
                library_id=library_id,
                create_paper=True,
                progress=progress,
            )
            update_pdf_task_item(
                task_id,
                index,
                status="done",
                stage="done",
                detail="处理完成",
                paper_id=upload.get("paper_id"),
                title=upload.get("title") or file_storage.filename,
                pdf_url=upload.get("pdf_url"),
                parse_error=upload.get("parse_error") or "",
            )
            return upload
        except Exception as exc:
            message = str(exc) or exc.__class__.__name__
            current_app.logger.exception("Failed to process PDF %s", file_storage.filename)
            update_pdf_task_item(task_id, index, status="error", stage="error", detail=message, error=message)
            return {"error": message, "original_filename": file_storage.filename}


def run_pdf_task(app, task_id, library_id, file_storages):
    uploads = []
    with app.app_context():
        try:
            futures = [
                pdf_file_executor.submit(process_pdf_task_item, app, task_id, index, file_storage, library_id)
                for index, file_storage in enumerate(file_storages)
            ]
            for future in futures:
                uploads.append(future.result())
            library = get_library_or_404(library_id)
            status = "done" if not any(upload.get("error") for upload in uploads) else "partial"
            update_pdf_task(task_id, status=status, library_id=library_id, result={
                "library": library,
                "uploads": uploads,
                "added": sum(1 for upload in uploads if not upload.get("error")),
            })
        except Exception as exc:
            message = str(exc) or exc.__class__.__name__
            current_app.logger.exception("PDF task failed: %s", task_id)
            update_pdf_task(task_id, status="error", error=message)


@api.get("/tasks/<task_id>")
def get_task(task_id):
    task = pdf_task_snapshot(task_id)
    if not task:
        return ok({"error": "task not found"}, 404)
    return ok({"task": task})


PAPER_EXPORT_FIELDNAMES = ["Title", "Authors", "Year", "Venue", "Rank", "Category", "URL", "Abstract"]


def paper_export_row_dicts(rows):
    export_rows = []
    for paper in rows:
        authors = paper.get("authors") or []
        if isinstance(authors, list):
            authors = "; ".join(str(author) for author in authors)
        export_rows.append({
            "Title": paper.get("title") or "",
            "Authors": authors,
            "Year": paper.get("pub_year") or "",
            "Venue": paper.get("venue_abbr") or paper.get("venue_name") or "",
            "Rank": paper.get("rank") or "",
            "Category": paper.get("category_name") or "",
            "URL": paper.get("doi_url") or paper.get("pub_url") or paper.get("dblp_url") or "",
            "Abstract": paper.get("abstract") or "",
        })
    return export_rows


def paper_export_response(library_id, rows, export_format):
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    export_rows = paper_export_row_dicts(rows)
    if export_format in {"xlsx", "excel"}:
        output = BytesIO()
        with pd.ExcelWriter(output, engine="openpyxl") as writer:
            pd.DataFrame(export_rows, columns=PAPER_EXPORT_FIELDNAMES).to_excel(writer, index=False, sheet_name="Papers")
        output.seek(0)
        return send_file(
            output,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            as_attachment=True,
            download_name=f"easyref-papers-{library_id}-{timestamp}.xlsx",
        )

    output = StringIO()
    writer = csv.DictWriter(output, fieldnames=PAPER_EXPORT_FIELDNAMES)
    writer.writeheader()
    writer.writerows(export_rows)
    return Response(
        "\ufeff" + output.getvalue(),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=easyref-papers-{library_id}-{timestamp}.csv"},
    )


def paper_export_rows(library_id, filters):
    tag = (filters.get("tag") or "").strip()
    status = (filters.get("status") or "").strip()
    folder = (filters.get("folder") or "").strip()
    sort_items = parse_table_sorts(filters)
    where, params = apply_paper_filters(filters, prefix="AND")
    if tag:
        where += " AND COALESCE(lp.tags_json, '[]'::jsonb) ? %s"
        params.append(tag)
    if status:
        where += " AND lp.status=%s"
        params.append(status)
    else:
        where += " AND lp.status IS DISTINCT FROM 'trashed'"
    folder_clause, folder_params = folder_where_clause(folder)
    where += folder_clause
    params.extend(folder_params)

    rows = normalize_paper_rows(
        query(
            paper_select_sql(
                """
                JOIN library_papers lp ON lp.paper_id = p.id
                WHERE lp.library_id = %s
                """ + where,
                include_library=True,
            ) + table_order_clause(sort_items),
            tuple([library_id] + params),
        )
    )
    return rows


@api.errorhandler(Exception)
def handle_error(exc):
    code = getattr(exc, "code", 500)
    return jsonify({"error": str(exc)}), code


@api.get("/stats")
def stats():
    paper_estimate = query(
        "SELECT GREATEST(reltuples::bigint, 0) AS count FROM pg_class WHERE oid='public.papers'::regclass",
        one=True,
    )
    metadata = normalize_row(query("SELECT value_json, updated_at FROM app_metadata WHERE key='dblp_last_inserted_at'", one=True)) or {}
    value_json = metadata.get("value_json") or {}
    dblp_inserted_at = value_json.get("inserted_at") or metadata.get("updated_at")
    if not dblp_inserted_at:
        dblp_inserted_at = query(
            "SELECT MAX(created_at) AS inserted_at FROM papers WHERE dblp_key NOT LIKE 'upload/%%'",
            one=True,
        )["inserted_at"]
    result = {
        "papers": paper_estimate["count"] if paper_estimate else 0,
        "libraries": query("SELECT COUNT(*) AS count FROM paper_libraries", one=True)["count"],
        "venues": query("SELECT COUNT(*) AS count FROM venues", one=True)["count"],
        "dblp_inserted_at": dblp_inserted_at,
    }
    return ok(result)


@api.get("/venues/suggest")
def suggest_venues():
    term = (request.args.get("q") or "").strip()
    if len(term) < 1:
        return ok({"venues": []})
    like = f"%{term}%"
    prefix = f"{term}%"
    rows = query(
        """
        SELECT id, venue_abbr, venue_name, dblp_key, dblp_detail_key, rank
        FROM (
            SELECT
                v.id,
                NULLIF(v.venue_abbr, '') AS venue_abbr,
                NULLIF(v.venue_name, '') AS venue_name,
                NULLIF(v.dblp_key, '') AS dblp_key,
                NULLIF(v.dblp_detail_key, '') AS dblp_detail_key,
                best.rank,
                CASE
                    WHEN v.venue_abbr ILIKE %s THEN 0
                    WHEN v.venue_name ILIKE %s THEN 1
                    WHEN v.dblp_key ILIKE %s OR v.dblp_detail_key ILIKE %s THEN 2
                    ELSE 3
                END AS match_order
            FROM venues v
            LEFT JOIN LATERAL (
                SELECT rank
                FROM category_venue_rankings cvr
                WHERE cvr.venue_id = v.id
                ORDER BY rank
                LIMIT 1
            ) best ON true
            WHERE v.main_venue_id IS NULL
              AND NULLIF(TRIM(v.venue_name), '') IS NOT NULL
              AND (
                   v.venue_abbr ILIKE %s
                OR v.venue_name ILIKE %s
                OR v.dblp_key ILIKE %s
                OR v.dblp_detail_key ILIKE %s
              )
        ) matched
        ORDER BY match_order, COALESCE(venue_abbr, venue_name, dblp_detail_key)
        LIMIT 24
        """,
        (prefix, prefix, prefix, prefix, like, like, like, like),
    )
    venues = normalize_rows(rows)
    venues.sort(key=lambda item: (
        0 if (item.get("venue_abbr") or "").lower().startswith(term.lower()) else 1,
        item.get("venue_abbr") or item.get("venue_name") or "",
    ))
    return ok({"venues": venues[:12]})


@api.get("/auth/email-status")
def auth_email_status():
    email = (request.args.get("email") or "").strip().lower()
    if not email:
        return ok({"error": "missing email"}, 400)
    row = query(
        """
        SELECT id, email_confirmed_at
        FROM auth.users
        WHERE lower(email)=%s
        LIMIT 1
        """,
        (email,),
        one=True,
    )
    return ok({
        "exists": bool(row),
        "confirmed": bool(row and row.get("email_confirmed_at")),
    })


@api.get("/users/suggest")
def suggest_users():
    term = (request.args.get("q") or "").strip().lower()
    if not term:
        return ok({"users": []})
    like = f"{term}%"
    try:
        rows = query(
            """
            SELECT id::text AS id, email, email_confirmed_at IS NOT NULL AS confirmed
            FROM auth.users
            WHERE lower(email) LIKE %s
            ORDER BY email
            LIMIT 12
            """,
            (like,),
        )
    except Exception:
        rows = []
    return ok({"users": normalize_rows(rows)})


@api.post("/libraries/intent/parse")
def parse_library_intent():
    text = (body().get("text") or "").strip()
    if not text:
        return ok({"error": "missing text"}, 400)
    fallback = re.sub(r"[，。,.!?！？]", " ", text).strip()[:120]
    messages = [
        {
            "role": "system",
            "content": (
                "你是 EasyRef 的论文库创建助手。"
                "从用户自然语言需求中提取适合 DBLP 论文标题检索的英文关键词或短语。"
                "只返回 JSON，格式：{\"keyword\":\"...\"}。"
                "不要返回解释，不要返回 markdown。"
            ),
        },
        {"role": "user", "content": text},
    ]
    try:
        result = chat_completion(messages, temperature=0.1)
        content = (result.get("content") or "").strip()
        match = re.search(r"\{.*\}", content, flags=re.S)
        parsed = json.loads(match.group(0) if match else content)
        keyword = str(parsed.get("keyword") or "").strip()
    except Exception:
        keyword = fallback
    return ok({"keyword": keyword or fallback})


@api.get("/libraries")
def list_libraries():
    owner = (request.args.get("owner") or "").strip()
    select_sql = """
        SELECT pl.*, COUNT(lp.paper_id) FILTER (WHERE lp.status IS DISTINCT FROM 'trashed') AS paper_count
        FROM paper_libraries pl
        LEFT JOIN library_papers lp ON lp.library_id = pl.id
    """
    if owner:
        rows = query(
            select_sql + """
            WHERE pl.owner_name=%s OR COALESCE(pl.filters_json->'shared_with', '[]'::jsonb) ? %s
            GROUP BY pl.id
            ORDER BY pl.updated_at DESC, pl.id DESC
            """,
            (owner, owner),
        )
    else:
        rows = query(select_sql + " GROUP BY pl.id ORDER BY pl.updated_at DESC, pl.id DESC")
    return ok({"libraries": normalize_library_rows(rows)})


@api.post("/libraries")
def create_library():
    payload = body()
    filters = parse_filters(payload)
    mode = payload.get("mode") or "static"
    shared_with = payload.get("shared_with") or []
    filters["shared_with"] = shared_with
    filters["tag_definitions"] = payload.get("tag_definitions") or []
    library_id = execute(
        """
        INSERT INTO paper_libraries (name, description, mode, is_shared, owner_name, filters_json)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            payload.get("name") or filters["keyword"] or "新论文库",
            payload.get("description") or "",
            mode,
            bool(shared_with),
            payload.get("owner_name") or "local",
            filters,
        ),
    )
    if mode == "dynamic" or payload.get("seed", True):
        sync_dynamic_library(library_id)
    return ok({"library": get_library_or_404(library_id)}, 201)


@api.post("/libraries/from-pdfs")
def create_library_from_pdfs():
    uploaded_files = materialize_pdf_uploads(iter_pdf_uploads(request.files.getlist("files")))
    if not uploaded_files:
        return ok({"error": "missing pdf files"}, 400)
    library_name = request.form.get("name") or "PDF 论文库"
    library_id = execute(
        """
        INSERT INTO paper_libraries (name, description, mode, is_shared, owner_name, filters_json)
        VALUES (%s, %s, 'static', false, %s, %s)
        RETURNING id
        """,
        (
            library_name,
            request.form.get("description") or "",
            request.form.get("owner_name") or "local",
            {"source": "pdf_upload", "uploaded_count": len(uploaded_files), "shared_with": [], "tag_definitions": [], "folders": []},
        ),
    )
    if request.args.get("async") in {"1", "true", "yes"}:
        task_id = create_pdf_task("create_library_from_pdfs", len(uploaded_files), library_id=library_id, library_name=library_name)
        with pdf_tasks_lock:
            pdf_tasks[task_id]["items"] = [
                {"index": index, "filename": file_storage.filename, "status": "queued", "stage": "queued", "detail": "等待处理"}
                for index, file_storage in enumerate(uploaded_files)
            ]
        persist_pdf_task_by_id(task_id)
        pdf_task_executor.submit(run_pdf_task, current_app._get_current_object(), task_id, library_id, uploaded_files)
        return ok({"task": pdf_task_snapshot(task_id), "task_id": task_id, "library": get_library_or_404(library_id)}, 202)
    uploads = [persist_pdf_upload(file_storage, library_id=library_id, create_paper=True) for file_storage in uploaded_files]
    return ok({"library": get_library_or_404(library_id), "uploads": uploads, "added": len(uploads)}, 201)


@api.patch("/libraries/<int:library_id>")
def update_library(library_id):
    payload = body()
    allowed = {
        "name": payload.get("name"),
        "description": payload.get("description"),
        "mode": payload.get("mode"),
        "is_shared": payload.get("is_shared"),
        "filters_json": payload["filters"] if "filters" in payload else None,
    }
    if "filters" in payload and "is_shared" not in payload:
        allowed["is_shared"] = bool((payload["filters"] or {}).get("shared_with"))
    fields = {key: value for key, value in allowed.items() if value is not None}
    if fields:
        set_clause = ", ".join(f"{key}=%s" for key in fields)
        execute(f"UPDATE paper_libraries SET {set_clause}, updated_at=CURRENT_TIMESTAMP WHERE id=%s", tuple(fields.values()) + (library_id,))
    if "filters" in payload:
        apply_auto_tag_folders(library_id, payload["filters"] or {})
    return ok({"library": get_library_or_404(library_id)})


@api.delete("/libraries/<int:library_id>")
def delete_library(library_id):
    execute("DELETE FROM paper_libraries WHERE id=%s", (library_id,))
    return ok({"deleted": True})


@api.post("/libraries/<int:library_id>/sync")
def sync_library(library_id):
    added = sync_dynamic_library(library_id)
    return ok({"added": added, "library": get_library_or_404(library_id)})


@api.get("/papers/search")
def search_papers():
    filters = parse_filters(request.args)
    page = max(int(request.args.get("page", 1)), 1)
    page_size = min(max(int(request.args.get("page_size", 30)), 1), 100)
    where, params = apply_paper_filters(filters)
    offset = (page - 1) * page_size
    sql = paper_select_sql(where) + " ORDER BY p.pub_year DESC, p.id DESC LIMIT %s OFFSET %s"
    rows = query(sql, tuple(params + [page_size, offset]))
    total = query(
        f"""
        SELECT COUNT(DISTINCT p.id) AS count
        FROM papers p
        LEFT JOIN venues v ON p.ref_venue = v.id
        LEFT JOIN category_venue_rankings cvr ON cvr.venue_id = COALESCE(v.main_venue_id, v.id)
        {where}
        """,
        tuple(params),
        one=True,
    )["count"]
    return ok({"papers": normalize_paper_rows(rows), "total": total, "page": page, "page_size": page_size})


@api.get("/libraries/<int:library_id>/papers")
def library_papers(library_id):
    filters = parse_filters(request.args)
    tag = (request.args.get("tag") or "").strip()
    status = (request.args.get("status") or "").strip()
    folder = (request.args.get("folder") or "").strip()
    page = max(int(request.args.get("page", 1)), 1)
    page_size = min(max(int(request.args.get("page_size", 25)), 1), 100)
    sort_items = parse_table_sorts(request.args)
    where, params = apply_paper_filters(filters, prefix="AND")
    if tag:
        where += " AND COALESCE(lp.tags_json, '[]'::jsonb) ? %s"
        params.append(tag)
    if status:
        where += " AND lp.status=%s"
        params.append(status)
    else:
        where += " AND lp.status IS DISTINCT FROM 'trashed'"
    folder_clause, folder_params = folder_where_clause(folder)
    where += folder_clause
    params.extend(folder_params)
    base_join = """
        JOIN library_papers lp ON lp.paper_id = p.id
        WHERE lp.library_id = %s
        """ + where
    sql = paper_select_sql(
        """
        JOIN library_papers lp ON lp.paper_id = p.id
        WHERE lp.library_id = %s
        """ + where,
        include_library=True,
    )
    query_params = tuple([library_id] + params)
    total = query(
        f"""
        SELECT COUNT(DISTINCT p.id) AS count
        FROM papers p
        LEFT JOIN venues v ON p.ref_venue = v.id
        LEFT JOIN category_venue_rankings cvr ON cvr.venue_id = COALESCE(v.main_venue_id, v.id)
        {base_join}
        """,
        query_params,
        one=True,
    )["count"]
    offset = (page - 1) * page_size
    rows = query(
        sql + table_order_clause(sort_items) + " LIMIT %s OFFSET %s",
        query_params + (page_size, offset),
    )
    return ok({
        "papers": normalize_paper_rows(rows),
        "library": get_library_or_404(library_id),
        "total": total,
        "page": page,
        "page_size": page_size,
        "sort": serialize_table_sorts(sort_items),
        "sort_by": sort_items[0][0] if sort_items else "",
        "sort_dir": sort_items[0][1] if sort_items else "",
    })


@api.get("/libraries/<int:library_id>/papers/export")
def export_library_papers(library_id):
    export_format = (request.args.get("format") or "csv").lower()
    rows = paper_export_rows(library_id, parse_filters(request.args) | {
        "tag": request.args.get("tag") or "",
        "status": request.args.get("status") or "",
        "folder": request.args.get("folder") or "",
        "sort": request.args.get("sort") or "",
        "sort_by": request.args.get("sort_by") or "",
        "sort_dir": request.args.get("sort_dir") or "",
    })
    return paper_export_response(library_id, rows, export_format)


@api.post("/libraries/<int:library_id>/papers/export")
def export_selected_library_papers(library_id):
    payload = body()
    export_format = (payload.get("format") or "csv").lower()
    rows = selected_library_papers(library_id, payload, sort=True)
    return paper_export_response(library_id, rows, export_format)


def selected_library_papers(library_id, payload, sort=False):
    excluded_ids = [int(paper_id) for paper_id in payload.get("excluded_ids") or []]
    paper_ids = [int(paper_id) for paper_id in payload.get("paper_ids") or []]
    params = [library_id]
    where = "lp.library_id=%s"
    if payload.get("all"):
        filters = parse_filters(payload)
        tag = (payload.get("tag") or "").strip()
        status = (payload.get("status") or "").strip()
        folder = (payload.get("folder") or "").strip()
        filter_where, filter_params = apply_paper_filters(filters, prefix="AND")
        where += filter_where
        params.extend(filter_params)
        if tag:
            where += " AND COALESCE(lp.tags_json, '[]'::jsonb) ? %s"
            params.append(tag)
        if status:
            where += " AND lp.status=%s"
            params.append(status)
        else:
            where += " AND lp.status IS DISTINCT FROM 'trashed'"
        folder_clause, folder_params = folder_where_clause(folder)
        where += folder_clause
        params.extend(folder_params)
        if excluded_ids:
            placeholders = ",".join(["%s"] * len(excluded_ids))
            where += f" AND p.id NOT IN ({placeholders})"
            params.extend(excluded_ids)
    elif paper_ids:
        where += " AND lp.status IS DISTINCT FROM 'trashed'"
        placeholders = ",".join(["%s"] * len(paper_ids))
        where += f" AND p.id IN ({placeholders})"
        params.extend(paper_ids)
    else:
        return []
    order_clause = table_order_clause(parse_table_sorts(payload)) if sort else ""
    return normalize_paper_rows(query(
        paper_select_sql(f"JOIN library_papers lp ON lp.paper_id=p.id WHERE {where}", include_library=True) + order_clause,
        tuple(params),
    ))


def persist_paper_citations(papers):
    rows = []
    for paper in papers:
        formats = citation_formats_from_paper(paper)
        rows.append((paper["id"], formats["bib"], {"citations": formats}))
    if rows:
        executemany(
            """
            INSERT INTO paper_detail (paper_id, bib, metadata_json)
            VALUES (%s, %s, %s)
            ON CONFLICT (paper_id) DO UPDATE
            SET bib=COALESCE(NULLIF(EXCLUDED.bib, ''), paper_detail.bib),
                metadata_json=COALESCE(paper_detail.metadata_json, '{}'::jsonb) || EXCLUDED.metadata_json,
                updated_at=CURRENT_TIMESTAMP
            """,
            rows,
        )


@api.post("/libraries/<int:library_id>/papers/citations/status")
def library_paper_citation_status(library_id):
    papers = selected_library_papers(library_id, body())
    scheduled = schedule_unfinished_citations(papers)
    return ok({**citation_status_summary(papers), "scheduled": scheduled})


@api.post("/libraries/<int:library_id>/papers/citations/retry")
def retry_library_paper_citations(library_id):
    payload = body()
    papers = selected_library_papers(library_id, payload)
    retry_count = 0
    for paper in papers:
        if citation_status_from_paper(paper) == CITATION_READY and not payload.get("force"):
            continue
        mark_citation_status(paper["id"], "pending", {"citation_retry_requested_at": datetime.utcnow().isoformat()})
        if submit_citation_fetch(paper, True):
            retry_count += 1
    return ok({"retrying": retry_count, "citation_status": citation_status_summary(papers)})


@api.post("/libraries/<int:library_id>/papers/citations/export")
def export_library_paper_citations(library_id):
    payload = body()
    style = (payload.get("format") or "bib").lower()
    if style not in {"bib", "apa", "mla", "gbt"}:
        return ok({"error": "unsupported citation format"}, 400)
    papers = selected_library_papers(library_id, payload)
    scheduled = schedule_unfinished_citations(papers)
    status = citation_status_summary(papers)
    if not status["exportable"]:
        return ok({"error": "citations are still being fetched", "citation_status": {**status, "scheduled": scheduled}}, 409)
    content = citation_export_text(papers, style)
    extension = "bib" if style == "bib" else "txt"
    mimetype = "text/x-bibtex; charset=utf-8" if style == "bib" else "text/plain; charset=utf-8"
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    return Response(
        "\ufeff" + content if style != "bib" else content,
        mimetype=mimetype,
        headers={"Content-Disposition": f"attachment; filename=easyref-citations-{library_id}-{timestamp}.{extension}"},
    )


@api.post("/libraries/<int:library_id>/papers")
def add_library_papers(library_id):
    payload = body()
    added = add_papers_to_library(library_id, payload.get("paper_ids") or [])
    return ok({"added": added})


@api.post("/libraries/<int:library_id>/papers/move")
def move_library_papers(library_id):
    payload = body()
    folder = normalize_folder_path(payload.get("folder"))
    current_folder = payload.get("current_folder") if "current_folder" in payload else None
    if current_folder is not None and current_folder != "__all__":
        current_folder = normalize_folder_path(current_folder)
    action = "copy" if payload.get("action") == "copy" else "move"
    excluded_ids = [int(paper_id) for paper_id in payload.get("excluded_ids") or []]
    paper_ids = [int(paper_id) for paper_id in payload.get("paper_ids") or []]
    params = [library_id]
    where = "library_id=%s AND status IS DISTINCT FROM 'trashed'"
    if payload.get("all"):
        if excluded_ids:
            placeholders = ",".join(["%s"] * len(excluded_ids))
            where += f" AND paper_id NOT IN ({placeholders})"
            params.extend(excluded_ids)
    elif paper_ids:
        placeholders = ",".join(["%s"] * len(paper_ids))
        where += f" AND paper_id IN ({placeholders})"
        params.extend(paper_ids)
    else:
        return ok({"moved": 0, "copied": 0})
    rows = normalize_rows(query(
        f"""
        SELECT paper_id, user_columns_json
        FROM library_papers
        WHERE {where}
        """,
        tuple(params),
    ))
    updates = []
    for row in rows:
        current_columns = row.get("user_columns_json") or {}
        next_columns = apply_folder_operation(current_columns, folder, action, current_folder)
        if next_columns != current_columns:
            updates.append((next_columns, library_id, row["paper_id"]))
    changed = executemany(
        """
        UPDATE library_papers
        SET user_columns_json=%s
        WHERE library_id=%s AND paper_id=%s
        """,
        updates,
    ) if updates else 0
    return ok({"moved": changed if action == "move" else 0, "copied": changed if action == "copy" else 0})


@api.delete("/libraries/<int:library_id>/folders")
def delete_library_folder(library_id):
    payload = body()
    folder = normalize_folder_path(payload.get("folder"))
    if not folder:
        return ok({"error": "missing folder"}, 400)
    library = get_library_or_404(library_id)
    if not library:
        return ok({"error": "library not found"}, 404)
    parent = "/".join(folder.split("/")[:-1])
    filters = library.get("filters_json") or {}
    prefix = f"{folder}/"
    filters["folders"] = [
        item for item in (filters.get("folders") or [])
        if normalize_folder_path(item) != folder and not normalize_folder_path(item).startswith(prefix)
    ]
    definitions = filters.get("tag_definitions") or filters.get("tags") or []
    for definition in definitions:
        if definition.get("auto_folder") and normalize_folder_path(definition.get("name")) == folder:
            definition["auto_folder"] = False
    moved = execute(
        """
        UPDATE library_papers
        SET user_columns_json=COALESCE(user_columns_json, '{}'::jsonb) || %s
        WHERE library_id=%s
          AND (
            COALESCE(user_columns_json->>'folder', '')=%s
            OR COALESCE(user_columns_json->>'folder', '') LIKE %s
          )
        """,
        ({"folder": parent}, library_id, folder, f"{prefix}%"),
    )
    execute(
        "UPDATE paper_libraries SET filters_json=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s",
        (filters, library_id),
    )
    return ok({"deleted": True, "moved": moved, "library": get_library_or_404(library_id)})


@api.post("/libraries/<int:library_id>/uploads/pdf")
def upload_pdfs_to_library(library_id):
    if not get_library_or_404(library_id):
        return ok({"error": "library not found"}, 404)
    uploaded_files = materialize_pdf_uploads(iter_pdf_uploads(request.files.getlist("files")))
    if not uploaded_files:
        return ok({"error": "missing pdf files"}, 400)
    if request.args.get("async") in {"1", "true", "yes"}:
        library = get_library_or_404(library_id)
        task_id = create_pdf_task("upload_pdfs_to_library", len(uploaded_files), library_id=library_id, library_name=library.get("name") or "")
        with pdf_tasks_lock:
            pdf_tasks[task_id]["items"] = [
                {"index": index, "filename": file_storage.filename, "status": "queued", "stage": "queued", "detail": "等待处理"}
                for index, file_storage in enumerate(uploaded_files)
            ]
        persist_pdf_task_by_id(task_id)
        pdf_task_executor.submit(run_pdf_task, current_app._get_current_object(), task_id, library_id, uploaded_files)
        return ok({"task": pdf_task_snapshot(task_id), "task_id": task_id}, 202)
    uploads = [persist_pdf_upload(file_storage, library_id=library_id, create_paper=True) for file_storage in uploaded_files]
    return ok({"uploads": uploads, "added": len(uploads)})


@api.post("/libraries/<int:library_id>/papers/<int:paper_id>/pdf/check")
def check_pdf_for_library_paper(library_id, paper_id):
    if "file" not in request.files:
        return ok({"error": "missing file"}, 400)
    paper = normalize_row(query(
        paper_select_sql("JOIN library_papers lp ON lp.paper_id=p.id WHERE lp.library_id=%s AND p.id=%s"),
        (library_id, paper_id),
        one=True,
    ))
    if not paper:
        return ok({"error": "paper not found in library"}, 404)

    file_storage = request.files["file"]
    suffix = Path(file_storage.filename or "paper.pdf").suffix or ".pdf"
    with NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
        temp_path = temp_file.name
    try:
        file_storage.save(temp_path)
        text, text_error = safe_extract_pdf_text(temp_path, file_storage.filename or "paper.pdf")
        bibliography, bibliography_error = safe_extract_pdf_bibliography(temp_path, file_storage.filename or "paper.pdf")
        pdf_metadata = extract_pdf_metadata(temp_path)
        identifier_metadata = fetch_pdf_identifier_title(file_storage.filename, text, bibliography, pdf_metadata)
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass

    candidates = []
    if identifier_metadata.get("title"):
        candidates.append(identifier_metadata["title"])
    for value in (bibliography.get("title"), pdf_metadata.get("title")):
        if plausible_pdf_title(value):
            candidates.append(value)
    candidates.extend(pdf_title_candidates(file_storage.filename, text))
    best = best_title_match(paper.get("title"), candidates)
    return ok({
        "matched": best["score"] >= 0.62,
        "score": best["score"],
        "paper": {
            "id": paper.get("id"),
            "title": paper.get("title"),
            "authors": paper.get("authors") or [],
            "pub_year": paper.get("pub_year"),
            "venue": paper.get("venue_abbr") or paper.get("venue_name"),
        },
        "pdf": {
            "title": best.get("title") or (candidates[0] if candidates else ""),
            "candidates": candidates[:6],
            "authors": bibliography.get("authors"),
            "pub_year": bibliography.get("pub_year"),
            "url": bibliography.get("url"),
            "identifier_metadata": identifier_metadata,
            "has_bibtex": bool(bibliography.get("bibtex")),
            "text_preview": text[:1200],
            "parse_error": text_error,
            "bibliography_error": bibliography_error,
        },
    })


@api.post("/libraries/<int:library_id>/papers/<int:paper_id>/pdf")
def upload_pdf_for_library_paper(library_id, paper_id):
    if "file" not in request.files:
        return ok({"error": "missing file"}, 400)
    upload = persist_pdf_upload(request.files["file"], library_id=library_id, paper_id=paper_id)
    return ok(upload)


@api.post("/libraries/<int:library_id>/papers/<int:paper_id>/associate")
def associate_library_paper(library_id, paper_id):
    payload = body()
    target_id = payload.get("target_paper_id")
    if not target_id:
        return ok({"error": "missing target_paper_id"}, 400)
    source = normalize_row(
        query("SELECT id FROM papers WHERE id=%s", (paper_id,), one=True)
    )
    if not source:
        return ok({"error": "source paper not found"}, 404)
    target = normalize_row(
        query("SELECT id FROM papers WHERE id=%s AND dblp_key NOT LIKE 'upload/%%'", (target_id,), one=True)
    )
    if not target:
        return ok({"error": "target paper not found"}, 404)
    uploads = normalize_rows(
        query(
            "SELECT id, filename, original_filename, file_path, extracted_text, file_hash FROM paper_uploads WHERE paper_id=%s ORDER BY created_at DESC",
            (paper_id,),
        )
    )
    if not uploads:
        return ok({"error": "source paper has no uploaded PDF"}, 400)
    detail = normalize_row(query(
        "SELECT abstract, abstract_source, detail_snippet, pdf_text_preview, pdf_url, metadata_json FROM paper_detail WHERE paper_id=%s",
        (paper_id,),
        one=True,
    ))
    add_papers_to_library(library_id, [target_id])
    for upload in uploads:
        if upload.get("file_hash") and find_duplicate_pdf_upload(upload["file_hash"], library_id=library_id, paper_id=target_id):
            execute("DELETE FROM paper_uploads WHERE id=%s", (upload["id"],))
        else:
            execute("UPDATE paper_uploads SET paper_id=%s, library_id=%s WHERE id=%s", (target_id, library_id, upload["id"]))
    if detail and detail.get("pdf_url"):
        metadata = detail.get("metadata_json") or {}
        metadata["association_mode"] = "manual"
        metadata["associated_from_paper_id"] = paper_id
        execute(
            """
            INSERT INTO paper_detail (paper_id, abstract, abstract_source, detail_snippet, pdf_text_preview, pdf_url, metadata_json)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (paper_id) DO UPDATE
            SET abstract=COALESCE(NULLIF(EXCLUDED.abstract, ''), paper_detail.abstract),
                abstract_source=COALESCE(NULLIF(EXCLUDED.abstract_source, ''), paper_detail.abstract_source),
                detail_snippet=COALESCE(NULLIF(EXCLUDED.detail_snippet, ''), paper_detail.detail_snippet),
                pdf_text_preview=COALESCE(NULLIF(EXCLUDED.pdf_text_preview, ''), paper_detail.pdf_text_preview),
                pdf_url=EXCLUDED.pdf_url,
                metadata_json=COALESCE(paper_detail.metadata_json, '{}'::jsonb) || EXCLUDED.metadata_json,
                updated_at=CURRENT_TIMESTAMP
            """,
            (
                target_id,
                detail.get("abstract") or "",
                detail.get("abstract_source") or "",
                detail.get("detail_snippet") or "",
                detail.get("pdf_text_preview") or "",
                detail["pdf_url"],
                metadata,
            ),
        )
    if str(paper_id) != str(target_id):
        execute("DELETE FROM library_papers WHERE library_id=%s AND paper_id=%s", (library_id, paper_id))
        execute(
            """
            DELETE FROM papers p
            WHERE p.id=%s
              AND p.dblp_key LIKE 'upload/%%'
              AND NOT EXISTS (SELECT 1 FROM library_papers lp WHERE lp.paper_id=p.id)
              AND NOT EXISTS (SELECT 1 FROM paper_uploads pu WHERE pu.paper_id=p.id)
            """,
            (paper_id,),
        )
    return ok({"associated": True, "paper": normalize_row(query(paper_select_sql("WHERE p.id=%s"), (target_id,), one=True))})


@api.delete("/libraries/<int:library_id>/papers/<int:paper_id>")
def remove_library_paper(library_id, paper_id):
    execute(
        "UPDATE library_papers SET status='trashed', deleted_at=CURRENT_TIMESTAMP WHERE library_id=%s AND paper_id=%s",
        (library_id, paper_id),
    )
    return ok({"removed": True})


def cleanup_expired_trash():
    execute("DELETE FROM library_papers WHERE status='trashed' AND deleted_at < (CURRENT_TIMESTAMP - INTERVAL '30 days')")
    execute("DELETE FROM library_files WHERE status='trashed' AND deleted_at < (CURRENT_TIMESTAMP - INTERVAL '30 days')")


@api.get("/trash")
def trashed_library_papers():
    cleanup_expired_trash()
    owner = (request.args.get("owner") or "").strip()
    owner_where = ""
    params = []
    if owner:
        owner_where = " AND (pl.owner_name=%s OR COALESCE(pl.filters_json->'shared_with', '[]'::jsonb) ? %s)"
        params.extend([owner, owner])
    rows = query(
        paper_select_sql(
            """
            JOIN library_papers lp ON lp.paper_id = p.id
            JOIN paper_libraries pl ON pl.id = lp.library_id
            WHERE lp.status='trashed'
            """ + owner_where,
            include_library=True,
        ) + " ORDER BY lp.created_at DESC, p.id DESC",
        tuple(params),
    )
    papers = normalize_rows(rows)
    library_names = {
        row["id"]: row["name"]
        for row in query("SELECT id, name FROM paper_libraries")
    }
    for paper in papers:
        paper["library_name"] = library_names.get(paper.get("library_id"), "")
    file_params = []
    file_owner_where = ""
    if owner:
        file_owner_where = " AND (pl.owner_name=%s OR COALESCE(pl.filters_json->'shared_with', '[]'::jsonb) ? %s)"
        file_params.extend([owner, owner])
    file_rows = normalize_rows(query(
        """
        SELECT lf.id, lf.library_id, lf.parent_id, lf.name, lf.type, lf.metadata_json, lf.deleted_at,
               pl.name AS library_name
        FROM library_files lf
        JOIN paper_libraries pl ON pl.id=lf.library_id
        WHERE lf.status='trashed'
        """ + file_owner_where + """
        ORDER BY lf.deleted_at DESC NULLS LAST, lf.id DESC
        """,
        tuple(file_params),
    ))
    for file_row in file_rows:
        original_name = (file_row.get("metadata_json") or {}).get("original_name")
        if original_name:
            file_row["name"] = original_name
    return ok({"papers": papers, "files": file_rows})


@api.post("/libraries/<int:library_id>/papers/<int:paper_id>/restore")
def restore_library_paper(library_id, paper_id):
    execute(
        "UPDATE library_papers SET status='active', deleted_at=NULL WHERE library_id=%s AND paper_id=%s",
        (library_id, paper_id),
    )
    return ok({"restored": True})


@api.post("/libraries/<int:library_id>/files/<int:file_id>/restore")
def restore_library_file(library_id, file_id):
    rows = normalize_rows(query(
        """
        WITH RECURSIVE subtree AS (
            SELECT id, parent_id, name, type, metadata_json
            FROM library_files
            WHERE library_id=%s AND id=%s AND status='trashed'
            UNION ALL
            SELECT child.id, child.parent_id, child.name, child.type, child.metadata_json
            FROM library_files child
            JOIN subtree parent ON child.parent_id=parent.id
            WHERE child.library_id=%s AND child.status='trashed'
        )
        SELECT id, parent_id, name, type, metadata_json FROM subtree
        ORDER BY parent_id NULLS FIRST, id
        """,
        (library_id, file_id, library_id),
    ))
    if not rows:
        return ok({"error": "file not found"}, 404)
    restored_ids = {row["id"] for row in rows}
    updates = []
    for row in rows:
        metadata = row.get("metadata_json") or {}
        original_name = safe_file_name(metadata.get("original_name") or row.get("name"))
        conflict = normalize_row(query(
            """
            SELECT id
            FROM library_files
            WHERE library_id=%s
              AND parent_id IS NOT DISTINCT FROM %s
              AND name=%s
              AND status IS DISTINCT FROM 'trashed'
              AND id<>%s
            LIMIT 1
            """,
            (library_id, row.get("parent_id"), original_name, row["id"]),
            one=True,
        ))
        restore_name = original_name if not conflict else safe_file_name(f"{original_name} restored {row['id']}")
        updates.append((restore_name, library_id, row["id"]))
    executemany(
        """
        UPDATE library_files
        SET status='active',
            deleted_at=NULL,
            name=%s,
            updated_at=CURRENT_TIMESTAMP
        WHERE library_id=%s AND id=%s
        """,
        updates,
    )
    restored = normalize_rows(query(
        """
        SELECT id, library_id, parent_id, name, type, content_text, storage_url, metadata_json, status, deleted_at, created_at, updated_at
        FROM library_files
        WHERE library_id=%s AND id=%s
        """,
        (library_id, file_id),
    ))
    return ok({"restored": True, "restored_ids": sorted(restored_ids), "file": restored[0] if restored else None})


@api.patch("/libraries/<int:library_id>/papers/<int:paper_id>")
def update_library_paper(library_id, paper_id):
    payload = body()
    paper_in_library = None
    updates = {}
    if "tags" in payload:
        updates["tags_json"] = payload["tags"]
    if "notes" in payload:
        updates["notes"] = payload["notes"]
    if "status" in payload:
        updates["status"] = payload["status"]
    if "columns" in payload:
        updates["user_columns_json"] = payload["columns"]
    title_updated = False
    next_title = clean_pdf_title_candidate(payload.get("title")) if "title" in payload else ""
    if "title" in payload:
        paper_in_library = normalize_row(query(
            """
            SELECT p.id, p.dblp_key
            FROM papers p
            JOIN library_papers lp ON lp.paper_id=p.id
            WHERE lp.library_id=%s AND p.id=%s
            """,
            (library_id, paper_id),
            one=True,
        ))
        if not paper_in_library:
            return ok({"error": "paper not found in library"}, 404)
        if not str(paper_in_library.get("dblp_key") or "").startswith("upload/"):
            return ok({"error": "only uploaded unmatched papers can be renamed"}, 400)
        if not (2 <= len(next_title) <= 300):
            return ok({"error": "invalid title"}, 400)
        execute("UPDATE papers SET title=%s WHERE id=%s", (next_title, paper_id))
        execute(
            """
            INSERT INTO paper_detail (paper_id, metadata_json)
            VALUES (%s, %s)
            ON CONFLICT (paper_id) DO UPDATE
            SET metadata_json=COALESCE(paper_detail.metadata_json, '{}'::jsonb) || EXCLUDED.metadata_json,
                updated_at=CURRENT_TIMESTAMP
            """,
            (paper_id, {"manual_title": next_title, "manual_title_updated_at": datetime.utcnow().isoformat()}),
        )
        title_updated = True
    abstract_updated = False
    next_abstract = str(payload.get("abstract") or "").strip() if "abstract" in payload else ""
    if "abstract" in payload:
        if paper_in_library is None:
            paper_in_library = normalize_row(query(
                """
                SELECT p.id, p.dblp_key
                FROM papers p
                JOIN library_papers lp ON lp.paper_id=p.id
                WHERE lp.library_id=%s AND p.id=%s
                """,
                (library_id, paper_id),
                one=True,
            ))
        if not paper_in_library:
            return ok({"error": "paper not found in library"}, 404)
        execute(
            """
            INSERT INTO paper_detail (paper_id, abstract, abstract_source, metadata_json)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (paper_id) DO UPDATE
            SET abstract=EXCLUDED.abstract,
                abstract_source=EXCLUDED.abstract_source,
                metadata_json=COALESCE(paper_detail.metadata_json, '{}'::jsonb) || EXCLUDED.metadata_json,
                updated_at=CURRENT_TIMESTAMP
            """,
            (
                paper_id,
                next_abstract,
                "manual" if next_abstract else "",
                {"manual_abstract_updated_at": datetime.utcnow().isoformat()},
            ),
        )
        abstract_updated = True
    folder = payload.get("folder") if "folder" in payload else None
    if "tags" in payload and "folder" not in payload:
        folder = auto_folder_for_tags(library_id, payload["tags"])
    if "folder" in payload:
        folder = payload.get("folder") or ""
    if folder is not None and "user_columns_json" in updates:
        updates["user_columns_json"] = {**(updates["user_columns_json"] or {}), "folder": folder}
        folder = None
    if updates or folder is not None:
        assignments = [f"{key}=%s" for key in updates]
        values = list(updates.values())
        if folder is not None:
            assignments.append("user_columns_json=COALESCE(user_columns_json, '{}'::jsonb) || %s")
            values.append({"folder": folder})
        set_clause = ", ".join(assignments)
        execute(
            f"UPDATE library_papers SET {set_clause} WHERE library_id=%s AND paper_id=%s",
            tuple(values) + (library_id, paper_id),
        )
    return ok({
        "updated": True,
        "title": next_title if title_updated else None,
        "abstract": next_abstract if abstract_updated else None,
        "abstract_source": "manual" if abstract_updated and next_abstract else "",
    })


@api.post("/papers/<int:paper_id>/details")
def enrich_paper_details(paper_id):
    paper = normalize_row(query("SELECT id, title, pub_year FROM papers WHERE id=%s", (paper_id,), one=True))
    if not paper:
        return ok({"error": "paper not found"}, 404)
    detail = normalize_row(query("SELECT metadata_json FROM paper_detail WHERE paper_id=%s", (paper_id,), one=True))
    metadata = detail.get("metadata_json") if detail else {}
    metadata = metadata or {}
    cached_results = metadata.get("web_results") if isinstance(metadata, dict) else None
    if cached_results:
        return ok({"paper_id": paper_id, "results": cached_results, "cached": True})
    try:
        result_count = int(os.getenv("WEB_SEARCH_RESULT_COUNT", "10"))
    except ValueError:
        result_count = 10
    results = search_web(f'"{paper["title"]}" abstract pdf', max_results=result_count)
    snippet = "\n".join(f"- {item['title']}: {item['snippet']} {item['url']}" for item in results if item.get("snippet"))
    execute(
        """
        INSERT INTO paper_detail (paper_id, detail_snippet, metadata_json)
        VALUES (%s, %s, %s)
        ON CONFLICT (paper_id) DO UPDATE
        SET detail_snippet=EXCLUDED.detail_snippet,
            metadata_json=COALESCE(paper_detail.metadata_json, '{}'::jsonb) || EXCLUDED.metadata_json,
            updated_at=CURRENT_TIMESTAMP
        """,
        (paper_id, snippet[:12000], {"web_results": results, "web_results_cached_at": datetime.utcnow().isoformat()}),
    )
    return ok({"paper_id": paper_id, "results": results, "cached": False})


def extract_json_object(text):
    try:
        return json.loads(text or "")
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text or "", flags=re.S)
        if not match:
            return None
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None


def extract_json_array(text):
    try:
        data = json.loads(text or "")
        return data if isinstance(data, list) else None
    except json.JSONDecodeError:
        match = re.search(r"\[.*\]", text or "", flags=re.S)
        if not match:
            return None
        try:
            data = json.loads(match.group(0))
            return data if isinstance(data, list) else None
        except json.JSONDecodeError:
            return None


def ensure_paper_detail_snippet(paper):
    if paper.get("abstract") or paper.get("pdf_text_preview") or paper.get("detail_snippet"):
        return paper
    results = search_web(f'"{paper["title"]}" abstract pdf', max_results=5)
    snippet = "\n".join(
        f"- {item['title']}: {item['snippet']} {item['url']}"
        for item in results
        if item.get("snippet")
    )
    if snippet:
        execute(
            """
            INSERT INTO paper_detail (paper_id, detail_snippet, metadata_json)
            VALUES (%s, %s, %s)
            ON CONFLICT (paper_id) DO UPDATE
            SET detail_snippet=COALESCE(NULLIF(EXCLUDED.detail_snippet, ''), paper_detail.detail_snippet),
                metadata_json=COALESCE(paper_detail.metadata_json, '{}'::jsonb) || EXCLUDED.metadata_json,
                updated_at=CURRENT_TIMESTAMP
            """,
            (
                paper["id"],
                snippet[:12000],
                {"web_results": results, "web_results_cached_at": datetime.utcnow().isoformat()},
            ),
        )
        paper["detail_snippet"] = snippet[:12000]
    return paper


def paper_classification_text(paper):
    source = "none"
    content = ""
    if paper.get("abstract"):
        source = f"abstract:{paper.get('abstract_source') or 'metadata'}"
        content = paper.get("abstract") or ""
    elif paper.get("pdf_text_preview"):
        source = "pdf_text_preview"
        content = paper.get("pdf_text_preview") or ""
    elif paper.get("detail_snippet"):
        source = "detail_snippet"
        content = paper.get("detail_snippet") or ""
    return {
        "id": paper.get("id"),
        "title": paper.get("title"),
        "year": paper.get("pub_year"),
        "venue": paper.get("venue_abbr") or paper.get("venue_name"),
        "source": source,
        "content": content[:5000],
    }


def load_library_papers_for_tools(library_id, folder="", tag="", limit=None):
    where = "lp.library_id=%s AND lp.status IS DISTINCT FROM 'trashed'"
    params = [library_id]
    if folder:
        where += " AND COALESCE(lp.user_columns_json->>'folder', '') = %s"
        params.append(folder)
    if tag:
        where += " AND COALESCE(lp.tags_json, '[]'::jsonb) ? %s"
        params.append(tag)
    sql = paper_select_sql(f"JOIN library_papers lp ON lp.paper_id=p.id WHERE {where}", include_library=True)
    sql += " ORDER BY lp.created_at DESC, p.id DESC"
    if limit:
        sql += " LIMIT %s"
        params.append(int(limit))
    return normalize_paper_rows(query(sql, tuple(params)))


def ensure_library_tag(library_id, label):
    library = get_library_or_404(library_id)
    filters = library.get("filters_json") or {}
    definitions = filters.get("tag_definitions") or filters.get("tags") or []
    if not any(item.get("name") == label for item in definitions):
        definitions = [*definitions, {"name": label, "color": "#6d5dfc", "auto_folder": False}]
        filters = {**filters, "tag_definitions": definitions}
        execute("UPDATE paper_libraries SET filters_json=%s WHERE id=%s", (filters, library_id))
    return filters


def apply_tag_to_papers(library_id, paper_ids, label):
    if not paper_ids:
        return 0
    placeholders = ",".join(["%s"] * len(paper_ids))
    rows = normalize_rows(query(
        f"""
        SELECT paper_id, tags_json
        FROM library_papers
        WHERE library_id=%s AND paper_id IN ({placeholders})
        """,
        tuple([library_id, *paper_ids]),
    ))
    updates = []
    for row in rows:
        tags = row.get("tags_json") or []
        if label not in tags:
            tags = [*tags, label]
        updates.append((tags, library_id, row["paper_id"]))
    executemany("UPDATE library_papers SET tags_json=%s WHERE library_id=%s AND paper_id=%s", updates)
    return len(updates)


def classify_papers_for_library(library_id, label, criteria="", folder="", limit=None, llm_settings=None):
    label = (label or "").strip()
    if not label:
        raise ValueError("missing label")
    papers = load_library_papers_for_tools(library_id, folder=folder, limit=limit)
    task_id = execute(
        """
        INSERT INTO paper_tasks (library_id, type, status, input_json)
        VALUES (%s, 'classification', 'running', %s)
        RETURNING id
        """,
        (library_id, {"label": label, "criteria": criteria, "folder": folder, "paper_count": len(papers)}),
    )
    settings = llm_settings or {}
    results = []
    matched_ids = []
    try:
        for start in range(0, len(papers), 8):
            batch = [ensure_paper_detail_snippet(paper) for paper in papers[start:start + 8]]
            payload = [paper_classification_text(paper) for paper in batch]
            prompt = f"""请判断下面每篇论文是否应该归入标签“{label}”。
分类标准：{criteria or f"论文主题、方法或实验明显与 {label} 相关。"}

要求：
- 必须基于 title 和提供的摘要/正文片段/网页片段判断。
- 不要只因为出现一个词就判定相关，要判断论文核心内容是否相关。
- 输出严格 JSON 数组，不要 Markdown。
- 每个元素格式：
{{"paper_id": 123, "matched": true, "confidence": 0.0到1.0, "reason": "一句话理由", "evidence": "最关键证据", "source_used": "abstract/pdf_text_preview/detail_snippet/none"}}

论文：
{json.dumps(payload, ensure_ascii=False)}
"""
            response = chat_completion(
                [{"role": "system", "content": "你是严谨的论文主题分类器，只输出 JSON。"}, {"role": "user", "content": prompt}],
                model=settings.get("model"),
                base_url=settings.get("base_url"),
                api_key=settings.get("api_key"),
                protocol=settings.get("protocol"),
                temperature=0.1,
            )
            parsed = extract_json_array(response.get("content") or "")
            if parsed is None:
                raise ValueError("LLM classification did not return a JSON array")
            by_id = {str(item.get("paper_id")): item for item in parsed if isinstance(item, dict)}
            for paper in batch:
                item = by_id.get(str(paper["id"])) or {
                    "paper_id": paper["id"],
                    "matched": False,
                    "confidence": 0,
                    "reason": "LLM 未返回该论文判断",
                    "evidence": "",
                    "source_used": paper_classification_text(paper)["source"],
                }
                item["paper_id"] = paper["id"]
                results.append(item)
                if item.get("matched") and float(item.get("confidence") or 0) >= 0.55:
                    matched_ids.append(paper["id"])
        ensure_library_tag(library_id, label)
        tagged = apply_tag_to_papers(library_id, matched_ids, label)
        result_json = {
            "label": label,
            "criteria": criteria,
            "total": len(papers),
            "matched": len(matched_ids),
            "tagged": tagged,
            "paper_ids": matched_ids,
            "items": results,
        }
        execute(
            "UPDATE paper_tasks SET status='completed', result_json=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s",
            (result_json, task_id),
        )
        return {"task_id": task_id, **result_json}
    except Exception as exc:
        execute(
            "UPDATE paper_tasks SET status='failed', error=%s, result_json=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s",
            (str(exc), {"label": label, "items": results}, task_id),
        )
        raise


def copy_tagged_papers_to_folder(library_id, tag, folder):
    tag = (tag or "").strip()
    folder = normalize_folder_path(folder or tag)
    if not tag or not folder:
        raise ValueError("missing tag or folder")
    papers = load_library_papers_for_tools(library_id, tag=tag)
    paper_ids = [paper["id"] for paper in papers]
    if not paper_ids:
        return {"copied": 0, "folder": folder, "paper_ids": []}
    library = get_library_or_404(library_id)
    filters = library.get("filters_json") or {}
    folders = [normalize_folder_path(item) for item in (filters.get("folders") or []) if normalize_folder_path(item)]
    if folder not in folders:
        filters = {**filters, "folders": [*folders, folder]}
        execute("UPDATE paper_libraries SET filters_json=%s WHERE id=%s", (filters, library_id))
    updates = []
    for paper in papers:
        columns = paper.get("user_columns_json") or {}
        markers = set(columns.get("folders") or [])
        markers.add(folder)
        updates.append(({**columns, "folders": sorted(markers)}, library_id, paper["id"]))
    executemany("UPDATE library_papers SET user_columns_json=%s WHERE library_id=%s AND paper_id=%s", updates)
    return {"copied": len(updates), "folder": folder, "paper_ids": paper_ids}


def safe_file_name(value, fallback="draft.md"):
    name = re.sub(r"[\\/:*?\"<>|]+", "-", str(value or "").strip())
    name = re.sub(r"\s+", " ", name).strip(". ")
    return name[:180] or fallback


def load_library_files(library_id):
    return normalize_rows(query(
        """
        SELECT id, library_id, parent_id, name, type, content_text, storage_url, metadata_json,
               status, deleted_at, created_at, updated_at
        FROM library_files
        WHERE library_id=%s
          AND status IS DISTINCT FROM 'trashed'
        ORDER BY parent_id NULLS FIRST, type, name, id
        """,
        (library_id,),
    ))


def upsert_library_file(library_id, name, file_type="markdown", content="", parent_id=None, metadata=None):
    file_name = safe_file_name(name)
    existing = normalize_row(query(
        """
        SELECT id
        FROM library_files
        WHERE library_id=%s
          AND parent_id IS NOT DISTINCT FROM %s
          AND name=%s
          AND status IS DISTINCT FROM 'trashed'
        """,
        (library_id, parent_id, file_name),
        one=True,
    ))
    if existing:
        row = normalize_row(query(
            """
            UPDATE library_files
            SET type=%s,
                content_text=%s,
                metadata_json=COALESCE(metadata_json, '{}'::jsonb) || %s,
                updated_at=CURRENT_TIMESTAMP
            WHERE id=%s AND library_id=%s
            RETURNING id, library_id, parent_id, name, type, content_text, storage_url, metadata_json, status, deleted_at, created_at, updated_at
            """,
            (file_type, content, metadata or {}, existing["id"], library_id),
            one=True,
        ))
    else:
        row = normalize_row(query(
            """
            INSERT INTO library_files (library_id, parent_id, name, type, content_text, metadata_json)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, library_id, parent_id, name, type, content_text, storage_url, metadata_json, status, deleted_at, created_at, updated_at
            """,
            (library_id, parent_id, file_name, file_type, content, metadata or {}),
            one=True,
        ))
    return row


def load_file_descendants(library_id, root_id=None):
    if root_id:
        return normalize_rows(query(
            """
            WITH RECURSIVE subtree AS (
                SELECT *
                FROM library_files
                WHERE library_id=%s AND id=%s AND status IS DISTINCT FROM 'trashed'
                UNION ALL
                SELECT child.*
                FROM library_files child
                JOIN subtree parent ON child.parent_id=parent.id
                WHERE child.library_id=%s AND child.status IS DISTINCT FROM 'trashed'
            )
            SELECT id, library_id, parent_id, name, type, content_text, storage_url, metadata_json,
                   status, deleted_at, created_at, updated_at
            FROM subtree
            ORDER BY parent_id NULLS FIRST, type, name, id
            """,
            (library_id, root_id, library_id),
        ))
    return load_library_files(library_id)


def file_export_path(file_row, by_id):
    parts = [safe_file_name(file_row.get("name") or f"file-{file_row.get('id')}")]
    parent_id = file_row.get("parent_id")
    seen = set()
    while parent_id and parent_id in by_id and parent_id not in seen:
        seen.add(parent_id)
        parent = by_id[parent_id]
        parts.append(safe_file_name(parent.get("name") or f"folder-{parent_id}"))
        parent_id = parent.get("parent_id")
    return "/".join(reversed(parts))


def mark_file_tree_trashed(library_id, file_id):
    rows = normalize_rows(query(
        """
        WITH RECURSIVE subtree AS (
            SELECT id, name
            FROM library_files
            WHERE library_id=%s AND id=%s AND status IS DISTINCT FROM 'trashed'
            UNION ALL
            SELECT child.id, child.name
            FROM library_files child
            JOIN subtree parent ON child.parent_id=parent.id
            WHERE child.library_id=%s AND child.status IS DISTINCT FROM 'trashed'
        )
        SELECT id, name FROM subtree
        """,
        (library_id, file_id, library_id),
    ))
    if not rows:
        return 0
    executemany(
        """
        UPDATE library_files
        SET status='trashed',
            deleted_at=CURRENT_TIMESTAMP,
            metadata_json=COALESCE(metadata_json, '{}'::jsonb) || %s,
            name=%s
        WHERE library_id=%s AND id=%s
        """,
        [({"original_name": row["name"]}, f"{row['name']}.deleted-{row['id']}", library_id, row["id"]) for row in rows],
    )
    return len(rows)


def writing_preferences(user_key):
    if not user_key:
        return {}
    row = normalize_row(query(
        "SELECT style_rules_json, citation_style FROM user_writing_preferences WHERE user_key=%s",
        (user_key,),
        one=True,
    ))
    return row or {}


def build_review_markdown(library_id, topic, papers, user_key="", llm_settings=None):
    preferences = writing_preferences(user_key)
    paper_payload = [
        {
            "id": paper["id"],
            "title": paper.get("title"),
            "year": paper.get("pub_year"),
            "venue": paper.get("venue_abbr") or paper.get("venue_name"),
            "abstract": (paper.get("abstract") or paper.get("pdf_text_preview") or paper.get("detail_snippet") or "")[:1800],
            "bib": paper.get("bib") or "",
        }
        for paper in papers[:40]
    ]
    style_rules = preferences.get("style_rules_json") or {}
    if not isinstance(style_rules, dict):
        style_rules = {"memory_text": str(style_rules)}
    preference_text = (style_rules.get("memory_text") or "").strip()
    if not preference_text and isinstance(style_rules.get("memories"), list):
        preference_text = "\n".join(str(item).strip() for item in style_rules.get("memories") if str(item).strip())
    if not preference_text and style_rules:
        preference_text = json.dumps(style_rules, ensure_ascii=False)
    if not preference_text:
        preference_text = "无"
    prompt = f"""请基于给定论文写一篇 Markdown 格式综述草稿。
主题：{topic}
用户写作偏好：{preference_text}

强制要求：
- 输出 Markdown 正文，不要包裹代码块。
- 如果用户写作偏好为空，不要自行发明额外风格禁忌。
- 每个关键论断尽量用 [P论文id] 标注证据来源。
- 如果证据不足，要明确写“证据不足”。
- 结构至少包含：引言、主题分类、代表性方法、比较分析、局限与未来方向。

论文材料：
{json.dumps(paper_payload, ensure_ascii=False)}
"""
    result = chat_completion(
        [{"role": "system", "content": "你是 EasyRef 学术写作智能体，严格遵守用户写作偏好。"}, {"role": "user", "content": prompt}],
        model=(llm_settings or {}).get("model"),
        base_url=(llm_settings or {}).get("base_url"),
        api_key=(llm_settings or {}).get("api_key"),
        protocol=(llm_settings or {}).get("protocol"),
        temperature=0.2,
    )
    return result.get("content") or ""


def create_review_document(library_id, topic, source_folder="", source_tag="", user_key="", llm_settings=None):
    papers = load_library_papers_for_tools(library_id, folder=source_folder, tag=source_tag, limit=80)
    markdown = build_review_markdown(library_id, topic, papers, user_key=user_key, llm_settings=llm_settings)
    base_name = safe_file_name(f"{topic or source_folder or source_tag or 'review'} 综述.md")
    file_row = upsert_library_file(
        library_id,
        base_name,
        "markdown",
        markdown,
        metadata={
            "source_folder": source_folder,
            "source_tag": source_tag,
            "paper_ids": [paper["id"] for paper in papers],
            "generated_at": datetime.utcnow().isoformat(),
        },
    )
    bib_lines = []
    for paper in papers:
        if paper.get("bib"):
            bib_lines.append(paper["bib"])
    bib_file = None
    if bib_lines:
        bib_file = upsert_library_file(
            library_id,
            safe_file_name(f"{topic or source_folder or source_tag or 'references'}.bib"),
            "bib",
            "\n\n".join(bib_lines),
            metadata={"source_document_id": file_row["id"]},
        )
    return {"file": file_row, "bib_file": bib_file, "paper_count": len(papers)}


def classification_intent(message):
    text = str(message or "").strip()
    match = re.search(r"(?:哪些|哪几篇|找出|筛选).{0,12}?论文.{0,8}?是?(.+?)(?:相关|有关|方向|主题)", text)
    if not match:
        return None
    label = re.sub(r"[“”\"'？?。,.，\s]+", " ", match.group(1)).strip()
    label = label.split()[0] if label else ""
    return label or None


def review_intent(message):
    text = str(message or "").strip()
    match = re.search(r"(?:写|生成|编写).{0,8}?(?:一篇|一个)?(.+?)(?:综述|survey|review)", text, flags=re.I)
    if not match:
        return None
    topic = re.sub(r"[“”\"'？?。,.，]+", " ", match.group(1)).strip()
    return topic or "论文"


@api.post("/libraries/<int:library_id>/classify")
def classify_library_papers_route(library_id):
    payload = body()
    try:
        result = classify_papers_for_library(
            library_id,
            payload.get("label") or "",
            criteria=payload.get("criteria") or "",
            folder=payload.get("folder") or "",
            limit=payload.get("limit") or int(os.getenv("CLASSIFY_MAX_PAPERS", "120")),
            llm_settings=payload.get("llm") or {},
        )
    except Exception as exc:
        return ok({"error": str(exc)}, 500)
    return ok(result)


@api.post("/libraries/<int:library_id>/folders/copy-tag")
def copy_tag_to_folder_route(library_id):
    payload = body()
    try:
        return ok(copy_tagged_papers_to_folder(library_id, payload.get("tag"), payload.get("folder") or payload.get("tag")))
    except Exception as exc:
        return ok({"error": str(exc)}, 400)


@api.get("/libraries/<int:library_id>/files")
def library_files_route(library_id):
    return ok({"files": load_library_files(library_id)})


@api.post("/libraries/<int:library_id>/files")
def create_library_file_route(library_id):
    payload = body()
    file_type = payload.get("type") or "markdown"
    default_name = "untitled" if file_type == "folder" else "untitled.md"
    return ok({"file": upsert_library_file(
        library_id,
        payload.get("name") or default_name,
        file_type,
        payload.get("content") or "",
        payload.get("parent_id"),
        payload.get("metadata") or {},
    )})


@api.patch("/libraries/<int:library_id>/files/<int:file_id>")
def update_library_file_route(library_id, file_id):
    payload = body()
    assignments = []
    values = []
    for source, column in (("name", "name"), ("type", "type"), ("content", "content_text"), ("metadata", "metadata_json"), ("parent_id", "parent_id")):
        if source in payload:
            assignments.append(f"{column}=%s")
            values.append(safe_file_name(payload[source]) if source == "name" else payload[source])
    if not assignments:
        return ok({"updated": False})
    assignments.append("updated_at=CURRENT_TIMESTAMP")
    row = normalize_row(query(
        f"""
        UPDATE library_files
        SET {", ".join(assignments)}
        WHERE library_id=%s AND id=%s AND status IS DISTINCT FROM 'trashed'
        RETURNING id, library_id, parent_id, name, type, content_text, storage_url, metadata_json, status, deleted_at, created_at, updated_at
        """,
        tuple(values + [library_id, file_id]),
        one=True,
    ))
    return ok({"file": row})


@api.delete("/libraries/<int:library_id>/files/<int:file_id>")
def delete_library_file_route(library_id, file_id):
    deleted = mark_file_tree_trashed(library_id, file_id)
    return ok({"deleted": bool(deleted), "count": deleted, "id": file_id})


@api.get("/libraries/<int:library_id>/files/export")
def export_library_files_zip_route(library_id):
    folder_id = request.args.get("folder_id")
    folder_id = int(folder_id) if str(folder_id or "").isdigit() else None
    files = load_file_descendants(library_id, folder_id)
    by_id = {file_row["id"]: file_row for file_row in files}
    stream = BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        added = False
        for file_row in files:
            if file_row.get("type") == "folder":
                continue
            archive.writestr(file_export_path(file_row, by_id), file_row.get("content_text") or "")
            added = True
        if not added:
            archive.writestr("empty.txt", "")
    stream.seek(0)
    name = "easyref-files.zip"
    if folder_id and folder_id in by_id:
        name = f"{safe_file_name(by_id[folder_id].get('name'))}.zip"
    return send_file(stream, mimetype="application/zip", as_attachment=True, download_name=name)


@api.get("/libraries/<int:library_id>/files/<int:file_id>/export")
def export_library_file_route(library_id, file_id):
    row = normalize_row(query(
        "SELECT name, type, content_text FROM library_files WHERE library_id=%s AND id=%s AND status IS DISTINCT FROM 'trashed'",
        (library_id, file_id),
        one=True,
    ))
    if not row:
        return ok({"error": "file not found"}, 404)
    mimetype = "text/markdown; charset=utf-8" if row.get("type") == "markdown" else "text/plain; charset=utf-8"
    return Response(
        row.get("content_text") or "",
        mimetype=mimetype,
        headers={"Content-Disposition": f"attachment; filename=\"{safe_file_name(row.get('name'))}\""},
    )


@api.post("/libraries/<int:library_id>/write-review")
def write_review_route(library_id):
    payload = body()
    try:
        result = create_review_document(
            library_id,
            payload.get("topic") or payload.get("title") or "论文",
            source_folder=payload.get("folder") or "",
            source_tag=payload.get("tag") or "",
            user_key=payload.get("user_key") or "",
            llm_settings=payload.get("llm") or {},
        )
    except Exception as exc:
        return ok({"error": str(exc)}, 500)
    return ok(result)


@api.get("/writing-preferences")
def get_writing_preferences_route():
    user_key = (request.args.get("user_key") or "").strip()
    if not user_key:
        return ok({"preferences": {"style_rules_json": {}, "citation_style": ""}})
    return ok({"preferences": writing_preferences(user_key)})


@api.put("/writing-preferences")
def update_writing_preferences_route():
    payload = body()
    user_key = (payload.get("user_key") or "").strip()
    if not user_key:
        return ok({"error": "missing user_key"}, 400)
    style_rules = payload.get("style_rules_json") or {}
    citation_style = payload.get("citation_style") or ""
    row = normalize_row(query(
        """
        INSERT INTO user_writing_preferences (user_key, style_rules_json, citation_style)
        VALUES (%s, %s, %s)
        ON CONFLICT (user_key) DO UPDATE
        SET style_rules_json=EXCLUDED.style_rules_json,
            citation_style=EXCLUDED.citation_style,
            updated_at=CURRENT_TIMESTAMP
        RETURNING style_rules_json, citation_style, created_at, updated_at
        """,
        (user_key, style_rules, citation_style),
        one=True,
    ))
    return ok({"preferences": row})


@api.post("/uploads/pdf")
def upload_pdf():
    if "file" not in request.files:
        return ok({"error": "missing file"}, 400)
    library_id = request.form.get("library_id")
    paper_id = request.form.get("paper_id")
    upload = persist_pdf_upload(request.files["file"], library_id=library_id, paper_id=paper_id)
    return ok(upload)


@api.get("/uploads/<path:filename>")
def download_uploaded_pdf(filename):
    return send_from_directory(
        current_app.config["UPLOAD_FOLDER"],
        filename,
        mimetype="application/pdf",
        as_attachment=False,
    )


@api.get("/pdf/proxy")
def proxy_pdf():
    source_url = (request.args.get("url") or "").strip()
    parsed = urlparse(source_url)
    public_base = urlparse(os.getenv("SUPABASE_PUBLIC_URL", ""))
    internal_base = urlparse(os.getenv("SUPABASE_URL", ""))
    allowed_hosts = {host for host in (public_base.netloc, internal_base.netloc, "localhost:8000", "127.0.0.1:8000") if host}
    if parsed.scheme not in {"http", "https"} or parsed.netloc not in allowed_hosts:
        return ok({"error": "unsupported pdf url"}, 400)
    fetch_url = source_url
    if public_base.netloc and internal_base.netloc and parsed.netloc == public_base.netloc:
        fetch_url = urlunparse((internal_base.scheme or parsed.scheme, internal_base.netloc, parsed.path, parsed.params, parsed.query, parsed.fragment))
    upstream = requests.get(fetch_url, stream=True, timeout=60)
    upstream.raise_for_status()
    return Response(
        stream_with_context(upstream.iter_content(chunk_size=8192)),
        mimetype=upstream.headers.get("content-type") or "application/pdf",
        headers={"Cache-Control": "private, max-age=300"},
    )


def resolve_chat_inputs(payload):
    paper_ids = payload.get("paper_ids") or []
    library_id = payload.get("library_id")
    active_skills = resolve_installed_skills(payload.get("skill_ids") or [])
    papers = []

    if paper_ids:
        placeholders = ",".join(["%s"] * len(paper_ids))
        papers = normalize_rows(query(paper_select_sql(f"WHERE p.id IN ({placeholders})"), tuple(paper_ids)))
        upload_rows = normalize_rows(
            query(
                f"""
                SELECT pu.id AS upload_id, pu.paper_id, p.title, pu.extracted_text
                FROM paper_uploads pu
                JOIN papers p ON p.id = pu.paper_id
                WHERE pu.paper_id IN ({placeholders})
                ORDER BY pu.created_at DESC
                """,
                tuple(paper_ids),
            )
        )
    elif library_id:
        papers = normalize_rows(
            query(
                paper_select_sql("JOIN library_papers lp ON lp.paper_id=p.id WHERE lp.library_id=%s", include_library=True)
                + " AND lp.status IS DISTINCT FROM 'trashed' ORDER BY lp.created_at DESC LIMIT 20",
                (library_id,),
            )
        )
        upload_rows = normalize_rows(
            query(
                """
                SELECT pu.id AS upload_id, pu.paper_id, p.title, pu.extracted_text
                FROM paper_uploads pu
                JOIN library_papers lp ON lp.paper_id = pu.paper_id
                JOIN papers p ON p.id = pu.paper_id
                WHERE lp.library_id=%s
                  AND lp.status IS DISTINCT FROM 'trashed'
                ORDER BY pu.created_at DESC
                LIMIT 20
                """,
                (library_id,),
            )
        )
    else:
        upload_rows = []
    return paper_ids, library_id, active_skills, papers, upload_rows


def persist_chat_exchange(library_id, message, answer, paper_ids, active_skills, result, evidence_context):
    execute(
        """
        INSERT INTO chat_messages (library_id, role, content, metadata_json)
        VALUES (%s, 'user', %s, %s), (%s, 'assistant', %s, %s)
        """,
        (
            library_id,
            message,
            {
                "paper_ids": paper_ids,
                "skills": [skill.get("id") for skill in active_skills],
                "paper_refs": evidence_context.get("paper_refs") or [],
                "pdf_evidence": evidence_context.get("chunks") or [],
                "retrieval_plan": evidence_context.get("plan") or {},
                "qa_route": evidence_context.get("qa_route") or {},
                "trace": evidence_context.get("trace") or [],
            },
            library_id,
            answer,
            {
                "provider": result.get("provider"),
                "protocol": result.get("protocol"),
                "model": result.get("model"),
                "paper_refs": evidence_context.get("paper_refs") or [],
                "pdf_evidence": evidence_context.get("chunks") or [],
                "qa_route": evidence_context.get("qa_route") or {},
                "trace": evidence_context.get("trace") or [],
            },
        ),
    )


@api.post("/chat")
def chat():
    payload = body()
    paper_ids, library_id, active_skills, papers, upload_rows = resolve_chat_inputs(payload)

    result = answer_paper_question(
        payload.get("message") or "",
        papers=papers,
        upload_rows=upload_rows,
        llm_settings=payload.get("llm") or {},
        skills=active_skills,
    )
    evidence_context = result.get("evidence_context") or {}
    persist_chat_exchange(library_id, payload.get("message") or "", result["content"], paper_ids, active_skills, result, evidence_context)
    return ok(
        {
            "answer": result["content"],
            "provider": result.get("provider"),
            "protocol": result.get("protocol"),
            "model": result.get("model"),
            "paper_refs": evidence_context.get("paper_refs") or [],
            "pdf_evidence": evidence_context.get("chunks") or [],
            "retrieval_plan": evidence_context.get("plan") or {},
            "qa_route": evidence_context.get("qa_route") or {},
            "trace": evidence_context.get("trace") or [],
        }
    )


def sse_event(event, data):
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@api.post("/translate/stream")
def translate_stream():
    payload = body()

    @stream_with_context
    def generate():
        try:
            llm_settings = payload.get("llm") or {}
            yield sse_event("start", {"provider": llm_metadata(
                model=llm_settings.get("model"),
                protocol=llm_settings.get("protocol"),
            )})
            for delta in translate_text_stream(
                payload.get("text") or "",
                target_language=payload.get("target_language") or "中文",
                context=payload.get("context") or {},
                llm_settings=payload.get("llm") or {},
            ):
                yield sse_event("delta", {"content": delta})
            yield sse_event("done", {"done": True})
        except Exception as exc:
            yield sse_event("error", {"error": str(exc)})

    return Response(generate(), content_type="text/event-stream; charset=utf-8")


@api.post("/chat/stream")
def chat_stream():
    payload = body()

    @stream_with_context
    def generate():
        message = payload.get("message") or ""
        llm_settings = payload.get("llm") or {}
        metadata = llm_metadata(
            model=llm_settings.get("model"),
            protocol=llm_settings.get("protocol"),
        )
        try:
            yield sse_event("trace", {"stage": "start", "title": "开始", "detail": "已收到问题，正在准备上下文"})
            paper_ids, library_id, active_skills, papers, upload_rows = resolve_chat_inputs(payload)
            classify_label = classification_intent(message)
            if library_id and classify_label:
                yield sse_event("trace", {"stage": "classification", "title": "自动分类", "detail": f"正在判断哪些论文与 {classify_label} 相关"})
                result = classify_papers_for_library(
                    library_id,
                    classify_label,
                    criteria=f"判断论文是否与 {classify_label} 主题、方法、任务或实验明显相关",
                    limit=int(os.getenv("CLASSIFY_MAX_PAPERS", "120")),
                    llm_settings=llm_settings,
                )
                answer = (
                    f"已完成“{classify_label}”相关论文筛选。\n\n"
                    f"- 检查论文：{result['total']} 篇\n"
                    f"- 命中论文：{result['matched']} 篇\n"
                    f"- 已自动打上 tag：`{classify_label}`\n\n"
                    f"要把这些论文复制到 `{classify_label}` 子目录吗？"
                )
                tool_actions = [{
                    "id": f"copy-tag-{classify_label}",
                    "type": "copy_tag_to_folder",
                    "label": f"复制到 {classify_label}",
                    "library_id": library_id,
                    "tag": classify_label,
                    "folder": classify_label,
                }]
                result_meta = {**metadata, "content": answer}
                persist_chat_exchange(library_id, message, answer, paper_ids, active_skills, result_meta, {
                    "trace": [{"stage": "classification", "title": "自动分类", "detail": f"命中 {result['matched']} / {result['total']} 篇"}],
                })
                yield sse_event("tool_actions", {"tool_actions": tool_actions})
                yield sse_event("done", {
                    "answer": answer,
                    **metadata,
                    "paper_refs": [],
                    "pdf_evidence": [],
                    "retrieval_plan": {"type": "classification", "label": classify_label},
                    "trace": [{"stage": "classification", "title": "自动分类", "detail": f"命中 {result['matched']} / {result['total']} 篇"}],
                    "tool_actions": tool_actions,
                })
                return

            review_topic = review_intent(message)
            direct_review_requested = bool(re.search(r"(?:直接|立即|马上).{0,8}(?:写|生成|编写)", message))
            if library_id and review_topic and direct_review_requested:
                source_tag = review_topic
                yield sse_event("trace", {"stage": "writing", "title": "创建文档", "detail": f"正在读取 {source_tag} 相关论文并生成 Markdown 综述"})
                result = create_review_document(
                    library_id,
                    review_topic,
                    source_tag=source_tag,
                    user_key=payload.get("user_key") or "",
                    llm_settings=llm_settings,
                )
                file_row = result.get("file") or {}
                answer = (
                    f"已创建 Markdown 综述草稿：`{file_row.get('name')}`。\n\n"
                    f"- 使用论文：{result.get('paper_count', 0)} 篇\n"
                    f"- 文件已加入当前论文库的文件库，可以在中间编辑区继续修改。"
                )
                tool_actions = [{
                    "id": f"open-file-{file_row.get('id')}",
                    "type": "open_file",
                    "label": "打开文档",
                    "library_id": library_id,
                    "file_id": file_row.get("id"),
                }]
                result_meta = {**metadata, "content": answer}
                persist_chat_exchange(library_id, message, answer, paper_ids, active_skills, result_meta, {
                    "trace": [{"stage": "writing", "title": "创建文档", "detail": file_row.get("name") or ""}],
                })
                yield sse_event("tool_actions", {"tool_actions": tool_actions})
                yield sse_event("done", {
                    "answer": answer,
                    **metadata,
                    "paper_refs": [],
                    "pdf_evidence": [],
                    "retrieval_plan": {"type": "writing", "topic": review_topic},
                    "trace": [{"stage": "writing", "title": "创建文档", "detail": file_row.get("name") or ""}],
                    "tool_actions": tool_actions,
                })
                return

            prepare_started = perf_counter()
            prepare_trace = {"stage": "prepare", "title": "准备上下文", "detail": "正在加载论文、PDF 与用户问题"}
            yield sse_event("trace", prepare_trace)
            trace_queue = Queue()
            evidence_holder = {}

            def run_retrieval_context():
                try:
                    evidence_holder["context"] = prepare_paper_qa_context(
                        message,
                        papers,
                        upload_rows,
                        {**llm_settings, "_trace_callback": lambda item: trace_queue.put(("trace", item))},
                        skills=active_skills,
                    )
                except Exception as exc:
                    evidence_holder["error"] = exc
                finally:
                    trace_queue.put(("done", None))

            Thread(target=run_retrieval_context, daemon=True).start()
            while True:
                try:
                    event_type, item = trace_queue.get(timeout=0.2)
                except Empty:
                    continue
                if event_type == "trace":
                    yield sse_event("trace", item)
                    continue
                break
            if evidence_holder.get("error"):
                raise evidence_holder["error"]
            evidence_context = evidence_holder.get("context") or {}
            evidence_context.setdefault("trace", [])
            prepare_ms = round((perf_counter() - prepare_started) * 1000, 1)
            prepare_done_trace = {
                "stage": "prepare_done",
                "title": "上下文准备完成",
                "detail": f"回答前准备阶段完成（耗时 {prepare_ms / 1000:.2f}s）",
                "duration_ms": prepare_ms,
            }
            evidence_context["trace"] = [prepare_trace, *(evidence_context.get("trace") or []), prepare_done_trace]
            yield sse_event("trace", prepare_done_trace)
            yield sse_event("refs", {"paper_refs": evidence_context.get("paper_refs") or []})
            yield sse_event("evidence", {"pdf_evidence": evidence_context.get("chunks") or []})
            yield sse_event("plan", {"retrieval_plan": evidence_context.get("plan") or {}})
            yield sse_event("trace", {"stage": "answer", "title": "生成回答", "detail": "正在流式输出回答"})

            parts = []
            answer_started = perf_counter()
            first_token_sent = False
            for delta in chat_completion_stream(
                build_answer_messages(message, papers, evidence_context, active_skills),
                model=llm_settings.get("model"),
                base_url=llm_settings.get("base_url"),
                api_key=llm_settings.get("api_key"),
                protocol=llm_settings.get("protocol"),
            ):
                parts.append(delta)
                if not first_token_sent:
                    first_token_ms = round((perf_counter() - answer_started) * 1000, 1)
                    first_token_trace = {
                        "stage": "first_token",
                        "title": "首 token",
                        "detail": f"模型开始输出（耗时 {first_token_ms / 1000:.2f}s）",
                        "duration_ms": first_token_ms,
                    }
                    evidence_context["trace"].append(first_token_trace)
                    yield sse_event("trace", first_token_trace)
                    first_token_sent = True
                yield sse_event("delta", {"content": delta})

            answer = "".join(parts)
            answer_ms = round((perf_counter() - answer_started) * 1000, 1)
            answer_done_trace = {
                "stage": "answer_done",
                "title": "回答完成",
                "detail": f"流式回答完成（耗时 {answer_ms / 1000:.2f}s）",
                "duration_ms": answer_ms,
            }
            evidence_context["trace"].append(answer_done_trace)
            yield sse_event("trace", answer_done_trace)
            result = {**metadata, "content": answer}
            persist_chat_exchange(library_id, message, answer, paper_ids, active_skills, result, evidence_context)
            yield sse_event(
                "done",
                {
                    "answer": answer,
                    **metadata,
                    "paper_refs": evidence_context.get("paper_refs") or [],
                    "pdf_evidence": evidence_context.get("chunks") or [],
                    "retrieval_plan": evidence_context.get("plan") or {},
                    "qa_route": evidence_context.get("qa_route") or {},
                    "trace": evidence_context.get("trace") or [],
                },
            )
        except Exception as exc:
            yield sse_event("error", {"error": str(exc)})

    return Response(generate(), content_type="text/event-stream; charset=utf-8")


@api.get("/skills")
def skills():
    return ok({"skills": list_skills()})


@api.post("/skills/<skill_id>/install")
def install_skill_route(skill_id):
    skill = install_skill(skill_id)
    if not skill:
        return ok({"error": "skill not found"}, 404)
    return ok({"skill": skill})


@api.post("/skills/<skill_id>/uninstall")
def uninstall_skill_route(skill_id):
    uninstall_skill(skill_id)
    return ok({"removed": True})


@api.post("/admin/data-init")
def run_data_init():
    payload = body()
    command = [sys.executable, "/app/scripts/init_data.py"]
    if payload.get("skip_download"):
        command.append("--skip-download")
    if payload.get("skip_dblp_insert"):
        command.append("--skip-dblp-insert")
    if payload.get("skip_ccf"):
        command.append("--skip-ccf")
    if payload.get("dblp_dir"):
        command.extend(["--dblp-dir", payload["dblp_dir"]])
    if payload.get("ccf_csv"):
        command.extend(["--ccf-csv", payload["ccf_csv"]])

    started = datetime.utcnow().isoformat()
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    return ok({"pid": proc.pid, "started_at": started, "command": command})

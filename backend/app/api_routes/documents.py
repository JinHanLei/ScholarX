import os
import re
import zipfile
from io import BytesIO
from urllib.parse import quote

from flask import Response, request, send_file

from .common import api, body, ok
from .common import normalize_paper_rows
from ..db import normalize_row, query
from ..services.citations import citation_formats_from_paper, citation_key, split_authors


CITATION_MARKER_RE = re.compile(r"\[\[ref:([^\]\s]+)\]\]")


def _core():
    # Imported lazily so the legacy helper module can finish initialization.
    from .. import routes
    return routes


def parse_citation_paper_id(ref_id):
    match = re.match(r"^p?(\d+)(?::?c(?:hunk)?\d+)?$", str(ref_id or ""), re.I)
    return int(match.group(1)) if match else None


def citation_author_label(paper):
    authors = split_authors(paper.get("authors"))
    if not authors:
        return "Unknown author"
    first = authors[0]
    if "," in first:
        first = first.split(",", 1)[0]
    tokens = [token for token in re.findall(r"[A-Za-z][A-Za-z'-]*", first) if token.lower() not in {"and", "et", "al"}]
    return tokens[-1] if tokens else first.strip() or "Unknown author"


def inline_citation_text(paper, style, index):
    year = paper.get("pub_year") or "n.d."
    author = citation_author_label(paper)
    if style == "latex":
        return f"\\cite{{{citation_key(paper)}}}"
    if style == "gbt":
        return f"[{index}]"
    if style == "mla":
        return f"({author} {year})"
    return f"({author}, {year})"


def load_citation_papers(library_id, content):
    paper_ids = []
    seen = set()
    for match in CITATION_MARKER_RE.finditer(content or ""):
        paper_id = parse_citation_paper_id(match.group(1))
        if paper_id and paper_id not in seen:
            seen.add(paper_id)
            paper_ids.append(paper_id)
    if not paper_ids:
        return [], {}
    placeholders = ",".join(["%s"] * len(paper_ids))
    sql = _core().paper_select_sql(
        f"JOIN library_papers lp ON lp.paper_id=p.id WHERE lp.library_id=%s AND p.id IN ({placeholders})",
        include_library=True,
    )
    papers = normalize_paper_rows(query(sql, tuple([library_id, *paper_ids])))
    by_id = {int(paper["id"]): paper for paper in papers}
    ordered = [by_id[paper_id] for paper_id in paper_ids if paper_id in by_id]
    return ordered, by_id


def render_reference_section(papers, style):
    if style not in {"apa", "mla", "gbt"} or not papers:
        return ""
    lines = []
    for index, paper in enumerate(papers, 1):
        formatted = citation_formats_from_paper(paper).get(style) or ""
        prefix = f"{index}. " if style != "gbt" else f"[{index}] "
        lines.append(f"{prefix}{formatted}".rstrip())
    return "\n\n# References\n\n" + "\n\n".join(lines)


def render_citation_export(library_id, content, style):
    style = (style or "").lower()
    if style not in {"apa", "mla", "gbt", "latex"} or not CITATION_MARKER_RE.search(content or ""):
        return content or "", []
    papers, by_id = load_citation_papers(library_id, content)
    index_by_id = {int(paper["id"]): index for index, paper in enumerate(papers, 1)}

    def replace_marker(match):
        paper_id = parse_citation_paper_id(match.group(1))
        paper = by_id.get(paper_id)
        if not paper:
            return match.group(0)
        return inline_citation_text(paper, style, index_by_id.get(paper_id, 1))

    rendered = CITATION_MARKER_RE.sub(replace_marker, content or "")
    if style != "latex":
        rendered += render_reference_section(papers, style)
    return rendered, papers


def attachment_header(filename):
    safe_name = _core().safe_file_name(filename)
    ascii_name = re.sub(r"[^A-Za-z0-9._-]+", "-", safe_name).strip("-") or "download.md"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(safe_name)}"


@api.post("/libraries/<int:library_id>/classify")
def classify_library_papers_route(library_id):
    payload = body()
    try:
        result = _core().classify_papers_for_library(
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
        return ok(_core().copy_tagged_papers_to_folder(library_id, payload.get("tag"), payload.get("folder") or payload.get("tag")))
    except Exception as exc:
        return ok({"error": str(exc)}, 400)


@api.get("/libraries/<int:library_id>/files")
def library_files_route(library_id):
    return ok({"files": _core().load_library_files(library_id)})


@api.post("/libraries/<int:library_id>/files")
def create_library_file_route(library_id):
    payload = body()
    file_type = payload.get("type") or "markdown"
    default_name = "untitled" if file_type == "folder" else "untitled.md"
    return ok({"file": _core().upsert_library_file(
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
            values.append(_core().safe_file_name(payload[source]) if source == "name" else payload[source])
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
    deleted = _core().mark_file_tree_trashed(library_id, file_id)
    return ok({"deleted": bool(deleted), "count": deleted, "id": file_id})


@api.get("/libraries/<int:library_id>/files/export")
def export_library_files_zip_route(library_id):
    folder_id = request.args.get("folder_id")
    folder_id = int(folder_id) if str(folder_id or "").isdigit() else None
    citation_format = (request.args.get("citation_format") or "").lower()
    core = _core()
    files = core.load_file_descendants(library_id, folder_id)
    by_id = {file_row["id"]: file_row for file_row in files}
    stream = BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        added = False
        bib_papers = {}
        for file_row in files:
            if file_row.get("type") == "folder":
                continue
            content, cited_papers = render_citation_export(library_id, file_row.get("content_text") or "", citation_format)
            if citation_format == "latex":
                for paper in cited_papers:
                    bib_papers[int(paper["id"])] = paper
            archive.writestr(core.file_export_path(file_row, by_id), content)
            added = True
        if citation_format == "latex" and bib_papers:
            archive.writestr(
                "references.bib",
                "\n\n".join(citation_formats_from_paper(paper).get("bib") or "" for paper in bib_papers.values()).strip() + "\n",
            )
        if not added:
            archive.writestr("empty.txt", "")
    stream.seek(0)
    name = "scholarx-files.zip"
    if folder_id and folder_id in by_id:
        name = f"{core.safe_file_name(by_id[folder_id].get('name'))}.zip"
    return send_file(stream, mimetype="application/zip", as_attachment=True, download_name=name)


@api.get("/libraries/<int:library_id>/files/<int:file_id>/export")
def export_library_file_route(library_id, file_id):
    citation_format = (request.args.get("citation_format") or "").lower()
    row = normalize_row(query(
        "SELECT name, type, content_text FROM library_files WHERE library_id=%s AND id=%s AND status IS DISTINCT FROM 'trashed'",
        (library_id, file_id),
        one=True,
    ))
    if not row:
        return ok({"error": "file not found"}, 404)
    mimetype = "text/markdown; charset=utf-8" if row.get("type") == "markdown" else "text/plain; charset=utf-8"
    content, _cited_papers = render_citation_export(library_id, row.get("content_text") or "", citation_format)
    return Response(
        content,
        mimetype=mimetype,
        headers={"Content-Disposition": attachment_header(row.get("name"))},
    )


@api.post("/libraries/<int:library_id>/write-review")
def write_review_route(library_id):
    payload = body()
    try:
        result = _core().create_review_document(
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
    return ok({"preferences": _core().writing_preferences(user_key)})


@api.put("/writing-preferences")
def update_writing_preferences_route():
    payload = body()
    user_key = (payload.get("user_key") or "").strip()
    if not user_key:
        return ok({"error": "missing user_key"}, 400)
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
        (user_key, payload.get("style_rules_json") or {}, payload.get("citation_style") or ""),
        one=True,
    ))
    return ok({"preferences": row})

import json
import re
import subprocess
import sys
from datetime import datetime
from difflib import SequenceMatcher
from html import unescape
from pathlib import Path
from urllib.parse import quote, unquote

import requests

from ..db import execute, executemany, normalize_rows, query


CROSSREF_TIMEOUT_SECONDS = 20
CITATION_PENDING = "pending"
CITATION_READY = "ready"
CITATION_FAILED = "failed"


def request_json(url, **kwargs):
    response = requests.get(url, timeout=CROSSREF_TIMEOUT_SECONDS, **kwargs)
    response.raise_for_status()
    return response.json()


def normalize_title(value):
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", " ", str(value or "").lower()).strip()


def title_similarity(left, right):
    left_norm = normalize_title(left)
    right_norm = normalize_title(right)
    if not left_norm or not right_norm:
        return 0.0
    if left_norm in right_norm or right_norm in left_norm:
        shorter = min(len(left_norm), len(right_norm))
        longer = max(len(left_norm), len(right_norm))
        return min(1.0, 0.78 + 0.22 * (shorter / max(longer, 1)))
    return SequenceMatcher(None, left_norm, right_norm).ratio()


def is_bad_cached_bibtex(value):
    return bool(re.search(r"author\s*=\s*\{\s*\[", value or "", re.IGNORECASE))


def best_title_match(expected_title, candidates):
    scored = [
        {"title": candidate, "score": title_similarity(expected_title, candidate)}
        for candidate in candidates
        if candidate
    ]
    scored.sort(key=lambda item: item["score"], reverse=True)
    return scored[0] if scored else {"title": "", "score": 0.0}


def extract_pdf_bibliography(pdf_path):
    script = Path(__file__).resolve().parents[2] / "scripts" / "pdf2bibtex.py"
    if not script.exists():
        return {}
    try:
        completed = subprocess.run(
            [sys.executable, str(script), str(pdf_path)],
            capture_output=True,
            text=True,
            timeout=45,
            check=False,
        )
    except Exception:
        return {}
    output = (completed.stdout or "").strip()
    if not output:
        return {}
    for line in reversed(output.splitlines()):
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue
        return data if isinstance(data, dict) else {}
    return {}


def extract_doi(value):
    text = unquote(str(value or "")).strip()
    if not text:
        return ""
    match = re.search(r"(10\.\d{4,9}/[^\s\"<>]+)", text, re.IGNORECASE)
    if not match:
        return ""
    return match.group(1).rstrip(").,;")


def clean_abstract(value):
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    text = unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) >= 40 else ""


def abstract_from_crossref_payload(payload):
    message = (payload or {}).get("message") or {}
    return clean_abstract(message.get("abstract"))


def abstract_from_datacite_payload(payload):
    attributes = ((payload or {}).get("data") or {}).get("attributes") or {}
    for item in attributes.get("descriptions") or []:
        if str(item.get("descriptionType") or "").lower() == "abstract":
            abstract = clean_abstract(item.get("description"))
            if abstract:
                return abstract
    return ""


def abstract_from_openalex_payload(payload):
    inverted = (payload or {}).get("abstract_inverted_index") or {}
    if not isinstance(inverted, dict):
        return ""
    positions = []
    for word, indexes in inverted.items():
        for index in indexes or []:
            positions.append((index, word))
    positions.sort(key=lambda item: item[0])
    return clean_abstract(" ".join(word for _index, word in positions))


def fetch_crossref_bibtex(doi):
    doi = extract_doi(doi)
    if not doi:
        return "", {"source": "crossref", "status": "skipped", "reason": "missing doi"}
    url = f"https://api.crossref.org/v1/works/{quote(doi, safe='')}/transform/application/x-bibtex"
    try:
        response = requests.get(
            url,
            headers={"Accept": "application/x-bibtex"},
            timeout=CROSSREF_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        return "", {"source": "crossref", "status": "failed", "reason": str(exc)[:240]}
    bibtex = response.text.strip()
    attempt = {"source": "crossref", "status": "success"}
    try:
        abstract = abstract_from_crossref_payload(request_json(f"https://api.crossref.org/v1/works/{quote(doi, safe='')}"))
        if abstract:
            attempt["abstract"] = abstract
    except (requests.RequestException, ValueError):
        pass
    if bibtex.startswith("@"):
        return bibtex, attempt
    return "", {"source": "crossref", "status": "failed", "reason": "empty bibtex"}


def fetch_datacite_bibtex(doi):
    doi = extract_doi(doi)
    if not doi:
        return "", {"source": "datacite", "status": "skipped", "reason": "missing doi"}
    try:
        response = requests.get(
            f"https://doi.org/{quote(doi, safe='')}",
            headers={"Accept": "application/x-bibtex"},
            timeout=CROSSREF_TIMEOUT_SECONDS,
            allow_redirects=True,
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        return "", {"source": "datacite", "status": "failed", "reason": str(exc)[:240]}
    bibtex = response.text.strip()
    attempt = {"source": "datacite", "status": "success"}
    try:
        abstract = abstract_from_datacite_payload(request_json(f"https://api.datacite.org/dois/{quote(doi, safe='')}"))
        if abstract:
            attempt["abstract"] = abstract
    except (requests.RequestException, ValueError):
        pass
    if bibtex.startswith("@"):
        return bibtex, attempt
    return "", {"source": "datacite", "status": "failed", "reason": "empty bibtex"}


def fetch_semantic_scholar_bibtex(doi):
    doi = extract_doi(doi)
    if not doi:
        return "", {"source": "semantic_scholar", "status": "skipped", "reason": "missing doi"}
    url = (
        "https://api.semanticscholar.org/graph/v1/paper/"
        f"DOI:{quote(doi, safe='')}"
        "?fields=title,abstract,authors,year,venue,url,externalIds,citationStyles"
    )
    try:
        data = request_json(url)
    except (requests.RequestException, ValueError) as exc:
        return "", {"source": "semantic_scholar", "status": "failed", "reason": str(exc)[:240]}
    bibtex = ((data.get("citationStyles") or {}).get("bibtex") or "").strip()
    attempt = {"source": "semantic_scholar", "status": "success"}
    abstract = clean_abstract(data.get("abstract"))
    if abstract:
        attempt["abstract"] = abstract
    if bibtex.startswith("@"):
        return bibtex, attempt
    paper = {
        "title": data.get("title"),
        "authors": [author.get("name") for author in data.get("authors") or [] if author.get("name")],
        "pub_year": data.get("year"),
        "venue_name": data.get("venue"),
        "doi_url": f"https://doi.org/{doi}",
        "pub_url": data.get("url"),
        "bib": "",
    }
    bibtex = bibtex_from_paper(paper)
    attempt["fallback"] = "metadata"
    return bibtex, attempt


def fetch_openalex_bibtex(doi):
    doi = extract_doi(doi)
    if not doi:
        return "", {"source": "openalex", "status": "skipped", "reason": "missing doi"}
    try:
        data = request_json(f"https://api.openalex.org/works/https://doi.org/{quote(doi, safe='')}")
    except (requests.RequestException, ValueError) as exc:
        return "", {"source": "openalex", "status": "failed", "reason": str(exc)[:240]}
    attempt = {"source": "openalex", "status": "success", "fallback": "metadata"}
    abstract = abstract_from_openalex_payload(data)
    if abstract:
        attempt["abstract"] = abstract
    authorships = data.get("authorships") or []
    authors = [
        ((item.get("author") or {}).get("display_name") or "").strip()
        for item in authorships
        if ((item.get("author") or {}).get("display_name") or "").strip()
    ]
    primary_location = data.get("primary_location") or {}
    source = primary_location.get("source") or {}
    paper = {
        "title": data.get("title") or data.get("display_name"),
        "authors": authors,
        "pub_year": data.get("publication_year"),
        "venue_name": source.get("display_name") or data.get("host_venue", {}).get("display_name"),
        "doi_url": data.get("doi") or f"https://doi.org/{doi}",
        "pub_url": data.get("id"),
        "bib": "",
    }
    bibtex = bibtex_from_paper(paper)
    return bibtex, attempt


def fetch_best_bibtex(paper):
    doi = extract_doi(paper.get("doi_url") or paper.get("pub_url"))
    attempts = []
    best_bibtex = ""
    best_source = ""
    best_abstract = ""
    best_abstract_source = ""
    for fetcher in (fetch_crossref_bibtex, fetch_datacite_bibtex, fetch_semantic_scholar_bibtex, fetch_openalex_bibtex):
        bibtex, attempt = fetcher(doi)
        abstract = clean_abstract(attempt.get("abstract"))
        if abstract:
            attempt = {**attempt, "abstract_found": True}
            attempt.pop("abstract", None)
        attempts.append(attempt)
        if abstract and not best_abstract:
            best_abstract = abstract
            best_abstract_source = attempt.get("source") or ""
        if bibtex and not best_bibtex:
            best_bibtex = bibtex
            best_source = attempt.get("source") or ""
        if best_bibtex and best_abstract:
            return best_bibtex, best_source, attempts, best_abstract, best_abstract_source
    if best_bibtex:
        return best_bibtex, best_source, attempts, best_abstract, best_abstract_source
    bibtex = bibtex_from_paper({**paper, "bib": ""})
    attempts.append({
        "source": "local",
        "status": "success" if bibtex else "failed",
        "reason": "" if bibtex else "insufficient local metadata",
    })
    return bibtex, "local" if bibtex else "", attempts, best_abstract, best_abstract_source


def split_authors(authors):
    if isinstance(authors, str):
        try:
            parsed = json.loads(authors)
            if isinstance(parsed, list):
                authors = parsed
        except json.JSONDecodeError:
            pass
    if isinstance(authors, list):
        names = []
        for author in authors:
            if isinstance(author, dict):
                name = " ".join(str(author.get(part) or "").strip() for part in ("given", "family")).strip()
            else:
                name = str(author).strip()
            if name:
                names.append(name)
        return names
    if not authors:
        return []
    return [item.strip() for item in re.split(r"\s*;\s*|\s+and\s+|\s*,\s*(?=[A-Z][a-z])", str(authors)) if item.strip()]


def citation_key(paper):
    authors = split_authors(paper.get("authors"))
    first_author = authors[0].split()[-1] if authors else "paper"
    first_author = re.sub(r"[^A-Za-z0-9]+", "", first_author) or "paper"
    year = paper.get("pub_year") or "nd"
    title_word = next((word for word in re.findall(r"[A-Za-z0-9]+", paper.get("title") or "") if len(word) > 3), "")
    return f"{first_author}{year}{title_word}".lower()


def venue_name(paper):
    return paper.get("venue_abbr") or paper.get("venue_name") or ""


def paper_details(paper):
    details = paper.get("paper_details") or {}
    if isinstance(details, str):
        try:
            details = json.loads(details)
        except json.JSONDecodeError:
            details = {}
    return details if isinstance(details, dict) else {}


def author_list(paper):
    return split_authors(paper.get("authors"))


def format_authors_apa(authors):
    if not authors:
        return "Unknown author"
    return ", ".join(authors)


def format_authors_mla(authors):
    if not authors:
        return "Unknown author"
    if len(authors) == 1:
        return authors[0]
    if len(authors) == 2:
        return f"{authors[0]}, and {authors[1]}"
    return f"{authors[0]}, et al."


def format_authors_gbt(authors):
    return ", ".join(authors) if authors else "佚名"


def bibtex_from_paper(paper):
    existing = (paper.get("bib") or "").strip()
    if existing and not is_bad_cached_bibtex(existing):
        return existing
    entry_type = "article" if paper_details(paper).get("journal") else "inproceedings"
    fields = {
        "title": paper.get("title") or "",
        "author": " and ".join(author_list(paper)),
        "year": str(paper.get("pub_year") or ""),
        "url": paper.get("doi_url") or paper.get("pub_url") or paper.get("dblp_url") or "",
    }
    venue_field = "journal" if entry_type == "article" else "booktitle"
    fields[venue_field] = venue_name(paper)
    body = "\n".join(
        f"  {key} = {{{value}}},"
        for key, value in fields.items()
        if value
    )
    return f"@{entry_type}{{{citation_key(paper)},\n{body}\n}}"


def citation_formats_from_paper(paper):
    authors = author_list(paper)
    year = paper.get("pub_year") or "n.d."
    title = paper.get("title") or "Untitled"
    venue = venue_name(paper)
    url = paper.get("doi_url") or paper.get("pub_url") or paper.get("dblp_url") or ""
    apa = f"{format_authors_apa(authors)}. ({year}). {title}. {venue}.".strip()
    mla = f'{format_authors_mla(authors)}. "{title}." {venue}, {year}.'.strip()
    gbt = f"{format_authors_gbt(authors)}. {title}[C]. {venue}, {year}.".strip()
    if url:
        apa = f"{apa} {url}"
        mla = f"{mla} {url}"
        gbt = f"{gbt} {url}"
    return {
        "bib": bibtex_from_paper(paper),
        "apa": apa,
        "mla": mla,
        "gbt": gbt,
    }


def citation_status_from_paper(paper):
    metadata = paper.get("metadata_json") or {}
    if not isinstance(metadata, dict):
        metadata = {}
    status = (metadata.get("citation_status") or "").lower()
    if (paper.get("bib") or "").strip() and not is_bad_cached_bibtex(paper.get("bib")):
        return CITATION_READY
    return status or CITATION_PENDING


def mark_citation_status(paper_id, status, extra=None):
    metadata = {
        "citation_status": status,
        "citation_checked_at": datetime.utcnow().isoformat(),
        **(extra or {}),
    }
    execute(
        """
        INSERT INTO paper_detail (paper_id, metadata_json)
        VALUES (%s, %s)
        ON CONFLICT (paper_id) DO UPDATE
        SET metadata_json=COALESCE(paper_detail.metadata_json, '{}'::jsonb) || EXCLUDED.metadata_json,
            updated_at=CURRENT_TIMESTAMP
        """,
        (paper_id, metadata),
    )


def fetch_and_persist_citation(paper, force=False):
    paper_id = paper.get("id")
    if not paper_id:
        return CITATION_FAILED
    if not force and citation_status_from_paper(paper) == CITATION_READY:
        return CITATION_READY
    mark_citation_status(paper_id, CITATION_PENDING)
    bibtex, source, attempts, abstract, abstract_source = fetch_best_bibtex(paper)
    if not bibtex:
        mark_citation_status(paper_id, CITATION_FAILED, {
            "citation_error": "no citation metadata",
            "citation_attempts": attempts,
        })
        return CITATION_FAILED
    formats = citation_formats_from_paper({**paper, "bib": bibtex})
    execute(
        """
        INSERT INTO paper_detail (paper_id, bib, abstract, abstract_source, metadata_json)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (paper_id) DO UPDATE
        SET bib=EXCLUDED.bib,
            abstract=COALESCE(NULLIF(EXCLUDED.abstract, ''), paper_detail.abstract),
            abstract_source=COALESCE(NULLIF(EXCLUDED.abstract_source, ''), paper_detail.abstract_source),
            metadata_json=COALESCE(paper_detail.metadata_json, '{}'::jsonb) || EXCLUDED.metadata_json,
            updated_at=CURRENT_TIMESTAMP
        """,
        (
            paper_id,
            bibtex,
            abstract or "",
            abstract_source or "",
            {
                "citation_status": CITATION_READY,
                "citation_source": source,
                "citation_checked_at": datetime.utcnow().isoformat(),
                "citation_attempts": attempts,
                "citations": formats,
            },
        ),
    )
    return CITATION_READY


def load_papers_for_citation(library_id, paper_ids=None):
    params = [library_id]
    where = "lp.library_id=%s AND lp.status IS DISTINCT FROM 'trashed'"
    if paper_ids:
        placeholders = ",".join(["%s"] * len(paper_ids))
        where += f" AND p.id IN ({placeholders})"
        params.extend([int(paper_id) for paper_id in paper_ids])
    return normalize_rows(
        query(
            f"""
            SELECT p.id, p.title, p.authors, p.pub_year, p.pub_url, p.doi_url, p.paper_details,
                   {''}
                   COALESCE(v.venue_abbr, v.venue_name) AS venue_name,
                   v.venue_abbr, v.dblp_url,
                   pd.bib, pd.metadata_json
            FROM papers p
            JOIN library_papers lp ON lp.paper_id=p.id
            LEFT JOIN venues v ON p.ref_venue=v.id
            LEFT JOIN paper_detail pd ON pd.paper_id=p.id
            WHERE {where}
            """,
            tuple(params),
        )
    )


def citation_status_summary(papers):
    ready = 0
    pending = 0
    failed = 0
    for paper in papers:
        status = citation_status_from_paper(paper)
        if status == CITATION_READY:
            ready += 1
        elif status == CITATION_FAILED:
            failed += 1
        else:
            pending += 1
    return {
        "total": len(papers),
        "ready": ready,
        "pending": pending,
        "failed": failed,
        "exportable": bool(papers) and ready == len(papers),
    }


def citation_export_text(papers, style):
    lines = []
    for paper in papers:
        formats = citation_formats_from_paper(paper)
        lines.append(formats["bib" if style == "bib" else style])
    separator = "\n\n" if style == "bib" else "\n"
    return separator.join(line for line in lines if line)

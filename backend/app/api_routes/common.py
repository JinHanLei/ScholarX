from decimal import Decimal

from flask import Blueprint, jsonify, request

from ..db import normalize_rows


api = Blueprint("api", __name__)


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


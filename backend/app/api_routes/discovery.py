from flask import request

from .common import api, ok
from ..db import normalize_row, normalize_rows, query


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
    return ok({
        "papers": paper_estimate["count"] if paper_estimate else 0,
        "libraries": query("SELECT COUNT(*) AS count FROM paper_libraries", one=True)["count"],
        "venues": query("SELECT COUNT(*) AS count FROM venues", one=True)["count"],
        "dblp_inserted_at": dblp_inserted_at,
    })


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
    try:
        rows = query(
            """
            SELECT id::text AS id, email, email_confirmed_at IS NOT NULL AS confirmed
            FROM auth.users
            WHERE lower(email) LIKE %s
            ORDER BY email
            LIMIT 12
            """,
            (f"{term}%",),
        )
    except Exception:
        rows = []
    return ok({"users": normalize_rows(rows)})


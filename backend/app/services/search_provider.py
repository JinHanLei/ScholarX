import os

import requests
from ddgs import DDGS
from requests.adapters import HTTPAdapter


def _env_int(name, default):
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


BOCHA_SEARCH_URL = os.getenv("BOCHA_SEARCH_URL", "https://api.bocha.cn/v1/web-search")
BOCHA_API_KEY = os.getenv("BOCHA_API_KEY", "")
BOCHA_FRESHNESS = os.getenv("BOCHA_FRESHNESS", "noLimit")
BOCHA_SUMMARY = os.getenv("BOCHA_SUMMARY", "true").lower() != "false"
BOCHA_TIMEOUT_SECONDS = _env_int("BOCHA_TIMEOUT_SECONDS", 20)
WEB_SEARCH_PROVIDER = os.getenv("WEB_SEARCH_PROVIDER", "bocha").lower()
WEB_SEARCH_CONCURRENCY = _env_int("WEB_SEARCH_CONCURRENCY", 10)

_bocha_session = requests.Session()
_bocha_adapter = HTTPAdapter(
    pool_connections=WEB_SEARCH_CONCURRENCY,
    pool_maxsize=WEB_SEARCH_CONCURRENCY,
)
_bocha_session.mount("https://", _bocha_adapter)
_bocha_session.mount("http://", _bocha_adapter)


def _normalize_bocha_item(item):
    return {
        "title": item.get("name") or item.get("title"),
        "url": item.get("url") or item.get("link"),
        "snippet": item.get("summary") or item.get("snippet") or item.get("description"),
        "source": "bocha",
    }


def _extract_bocha_results(payload):
    data = payload.get("data") or payload
    candidates = (
        data.get("webPages", {}).get("value")
        or data.get("webpages", {}).get("value")
        or data.get("results")
        or data.get("items")
        or []
    )
    return [_normalize_bocha_item(item) for item in candidates if isinstance(item, dict)]


def _search_bocha(query, max_results):
    if not BOCHA_API_KEY:
        return []

    try:
        count = min(max(int(max_results), 1), 50)
    except (TypeError, ValueError):
        count = 10
    response = _bocha_session.post(
        BOCHA_SEARCH_URL,
        headers={
            "Authorization": f"Bearer {BOCHA_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "query": query,
            "summary": BOCHA_SUMMARY,
            "freshness": BOCHA_FRESHNESS,
            "count": count,
        },
        timeout=BOCHA_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return _extract_bocha_results(response.json())


def _search_ddgs(query, max_results):
    results = []
    with DDGS() as ddgs:
        for item in ddgs.text(query, max_results=max_results):
            results.append(
                {
                    "title": item.get("title"),
                    "url": item.get("href") or item.get("url"),
                    "snippet": item.get("body") or item.get("snippet"),
                    "source": "ddgs",
                }
            )
    return results


def search_web(query, max_results=5):
    if not query:
        return []

    if WEB_SEARCH_PROVIDER == "ddgs":
        return _search_ddgs(query, max_results)

    try:
        results = _search_bocha(query, max_results)
        if results:
            return results
    except (requests.RequestException, ValueError):
        pass

    return _search_ddgs(query, max_results)

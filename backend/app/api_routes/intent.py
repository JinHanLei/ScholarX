import json
import os
import re

from .common import api, body, ok
from ..db import normalize_row, query
from ..services.llm import chat_completion


KNOWN_VENUE_ABBRS = {
    "TKDE", "TNNLS", "TOIS", "TIST", "TWEB", "VLDB", "SIGMOD", "ICDE",
    "KDD", "WWW", "WSDM", "SIGIR", "CIKM", "ACL", "EMNLP", "NAACL",
    "AAAI", "IJCAI", "ICML", "NIPS", "NEURIPS", "ICLR", "CVPR", "ICCV",
    "ECCV", "MM", "TMM", "TCSVT", "INFOCOM", "TON", "TPAMI", "JMLR",
}


def _list_strings(value):
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def _normalize_ranks(value):
    ranks = []
    for item in _list_strings(value):
        rank = re.sub(r"^CCF[\s_-]*", "", item, flags=re.I).upper()[:1]
        if rank in {"A", "B", "C"} and rank not in ranks:
            ranks.append(rank)
    return ranks


def _extract_explicit_ranks(text):
    compact = re.sub(r"\s+", "", text or "").lower()
    if "ccfabc" in compact or "ccfa/b/c" in compact or "ccfa、b、c" in compact:
        return ["A", "B", "C"]
    found = []
    for match in re.finditer(r"ccf[\s_-]*([abc])\b", text or "", flags=re.I):
        rank = match.group(1).upper()
        if rank not in found:
            found.append(rank)
    return found


def _venue_lookup(token):
    value = str(token or "").strip()
    if not value:
        return ""
    try:
        row = normalize_row(query(
            """
            SELECT COALESCE(NULLIF(venue_abbr, ''), NULLIF(venue_name, ''), NULLIF(dblp_detail_key, ''), NULLIF(dblp_key, '')) AS venue
            FROM venues
            WHERE lower(venue_abbr)=lower(%s)
               OR lower(venue_name)=lower(%s)
               OR lower(dblp_key)=lower(%s)
               OR lower(dblp_detail_key)=lower(%s)
            ORDER BY CASE WHEN lower(venue_abbr)=lower(%s) THEN 0 ELSE 1 END
            LIMIT 1
            """,
            (value, value, value, value, value),
            one=True,
        ))
        if row and row.get("venue"):
            return row["venue"]
    except Exception:
        pass
    upper = value.upper()
    return upper if upper in KNOWN_VENUE_ABBRS else ""


def _extract_venues(text, parsed_venues=None):
    candidates = _list_strings(parsed_venues)
    candidates.extend(re.findall(r"\b[A-Za-z][A-Za-z0-9&.-]{1,20}\b", text or ""))
    venues = []
    for candidate in candidates:
        if candidate.lower() in {"ccf", "abc", "and", "or", "not"}:
            continue
        venue = _venue_lookup(candidate)
        if venue and venue.lower() not in {item.lower() for item in venues}:
            venues.append(venue)
    return venues


def _fallback_library_name(keyword, venues, ranks, text):
    scope = venues[0] if venues else f"CCF {','.join(ranks)}" if ranks else ""
    base = keyword or scope
    if scope and scope.lower() not in base.lower():
        base = f"{base} {scope}".strip()
    return f"{base[:50]} papers" if base else "Smart paper library"


def _clean_library_name(value):
    name = re.sub(r"[_\s]+", " ", str(value or "")).strip(" -:：")
    return name[:80]


def _library_name_needs_llm(text, name):
    cleaned = _clean_library_name(name)
    if not cleaned:
        return True
    normalized_text = re.sub(r"\s+", "", text or "").lower()
    normalized_name = re.sub(r"\s+", "", cleaned).lower()
    return len(cleaned) > 60 or normalized_name == normalized_text or normalized_text.startswith(normalized_name)


def _optimize_library_name(text, keyword, venues, ranks, settings):
    scope = ", ".join(venues or []) or (f"CCF {','.join(ranks)}" if ranks else "")
    messages = [
        {
            "role": "system",
            "content": (
                "你只负责为论文库生成一个简洁库名。"
                "要求：概括研究主题和筛选范围；不要照抄用户原句；不要使用问句；"
                "中文用户优先中文，英文术语可保留；最多 18 个中文字符或 6 个英文词。"
                "只输出库名本身，不要解释。"
            ),
        },
        {
            "role": "user",
            "content": f"用户需求：{text}\n标题检索关键词：{keyword}\n范围：{scope or '未指定'}",
        },
    ]
    result = chat_completion(
        messages,
        model=settings.get("model"),
        base_url=settings.get("base_url"),
        api_key=settings.get("api_key"),
        protocol=settings.get("protocol"),
        temperature=0.2,
    )
    content = (result.get("content") or "").strip()
    return _clean_library_name(content.splitlines()[0] if content else "")


def _postprocess_title_keywords(text, keyword, broad_keyword):
    lowered = f"{text} {keyword}".lower()
    stock_terms = ("股价", "股票", "stock", "equity")
    prediction_terms = ("预测", "预报", "predict", "forecast")
    if any(term in lowered for term in stock_terms) and any(term in lowered for term in prediction_terms):
        return "stock", "(stock OR equity)"
    return keyword, broad_keyword


@api.post("/libraries/intent/parse")
def parse_library_intent():
    payload = body()
    text = (payload.get("text") or "").strip()
    if not text:
        return ok({"error": "missing text"}, 400)
    fallback = re.sub(r"[，。,.!?！？]", " ", text).strip()[:120]
    settings = payload.get("llm") or {}
    messages = [
        {
            "role": "system",
            "content": (
                "你是 ScholarX 的论文助手。"
                "负责把用户的自然语言研究需求转换成论文标题高召回检索的布尔检索式、筛选范围和简洁库名。"
                "如用户没指定语言，默认生成英文检索式。"
                "检索式支持双引号、AND、OR、NOT、括号、减号排除和 :* 前缀匹配。"
                "keyword 的目标是先召回可能相关的标题，不是完整翻译用户句子。只保留 1 到 2 个最可能原样出现在标题里的锚点词，"
                "不要用 AND 强制标题同时出现研究对象、任务、方法和影响因素。除专有名词外不要生成多词精确短语，"
                "优先使用能代表一个研究领域的单词、词干前缀和少量 OR，而非完整短语。"
                "细粒度条件不要强加到 keyword，而是保留在 relevance_criteria 中供后续判定。"
                "年份、CCF 等级、会议或期刊属于独立筛选条件，不要放入 keyword。"
                "如果用户明确指定 TKDE、KDD、SIGIR、WWW、ICDE 等会议/期刊，必须放入 venues，不要再默认选择 CCF A/B/C。"
                "只有用户明确说 CCF A、CCF B、CCF C、CCF ABC 或同义表达时，才返回 ranks；没有明确提 CCF 时 ranks 必须为空数组。"
                "library_name 要短、可读，概括研究主题和范围，不要直接复制用户整句。\n"
                "为避免搜索结果过少，你还应给出 broad_keyword，可增加研究对象的常见同义词，但仍保持标题高召回。"
                "只返回 JSON，格式：{\"keyword\":\"...\",\"broad_keyword\":\"...\","
                "\"relevance_criteria\":\"...\",\"library_name\":\"...\",\"venues\":[\"...\"],\"ranks\":[\"A\"],"
                "\"year_from\":\"2023\",\"year_to\":\"2026\"}。"
            ),
        },
        {"role": "user", "content": text},
    ]
    parsed = {}
    try:
        result = chat_completion(
            messages,
            model=settings.get("model"),
            base_url=settings.get("base_url"),
            api_key=settings.get("api_key"),
            protocol=settings.get("protocol"),
            temperature=0.1,
        )
        content = (result.get("content") or "").strip()
        match = re.search(r"\{.*\}", content, flags=re.S)
        parsed = json.loads(match.group(0) if match else content)
        keyword = str(parsed.get("keyword") or "").strip()
        broad_keyword = str(parsed.get("broad_keyword") or "").strip()
        relevance_criteria = str(parsed.get("relevance_criteria") or text).strip()
    except Exception:
        keyword = fallback
        broad_keyword = fallback
        relevance_criteria = text
    keyword, broad_keyword = _postprocess_title_keywords(text, keyword, broad_keyword)
    explicit_ranks = _extract_explicit_ranks(text)
    ranks = explicit_ranks or _normalize_ranks(parsed.get("ranks"))
    venues = _extract_venues(text, parsed.get("venues"))
    if venues and not explicit_ranks:
        ranks = []
    library_name = _clean_library_name(parsed.get("library_name"))
    if _library_name_needs_llm(text, library_name):
        try:
            library_name = _optimize_library_name(text, keyword or fallback, venues, ranks, settings)
        except Exception:
            library_name = ""
    if _library_name_needs_llm(text, library_name):
        library_name = _fallback_library_name(keyword, venues, ranks, text)
    return ok({
        "keyword": keyword or fallback,
        "broad_keyword": broad_keyword or keyword or fallback,
        "relevance_criteria": relevance_criteria,
        "library_name": library_name,
        "venues": venues,
        "ranks": ranks,
        "year_from": str(parsed.get("year_from") or "").strip(),
        "year_to": str(parsed.get("year_to") or "").strip(),
    })


@api.post("/libraries/intent/preview")
def preview_library_intent():
    from ..routes import paper_search_count, parse_filters

    payload = body()
    filters = parse_filters(payload)
    broad_keyword = str(payload.get("broad_keyword") or "").strip()
    threshold = max(1, int(os.getenv("SMART_SEARCH_MIN_RESULTS", "10")))
    strict_count = paper_search_count(filters)
    broad_count = strict_count
    if strict_count < threshold and broad_keyword:
        broad_count = paper_search_count({**filters, "keyword": broad_keyword})
    return ok({
        "strict_count": strict_count,
        "broad_count": broad_count,
        "threshold": threshold,
        "use_broad_search": strict_count < threshold and bool(broad_keyword),
    })

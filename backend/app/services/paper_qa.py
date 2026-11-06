from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from math import isfinite, log, sqrt
import json
import os
import re
from time import perf_counter

from ..db import execute, executemany, normalize_rows, query
from .citations import citation_formats_from_paper
from .llm import LLMRequestError, chat_completion, create_embeddings


QA_ROUTE_TYPES = {
    "in_paper_qa",
    "beyond_paper_reasoning",
    "generative_creation",
    "orchestrated_task",
}

ASCII_TERM_RE = re.compile(r"[a-z0-9][a-z0-9_.+-]*")
CJK_RUN_RE = re.compile(r"[\u4e00-\u9fff]+")
SPACE_RE = re.compile(r"\s+")
CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "how",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "this",
    "to",
    "what",
    "which",
    "with",
    "中",
    "了",
    "于",
    "什么",
    "介绍",
    "使用",
    "如何",
    "是",
    "本文",
    "的",
    "请",
    "这篇",
}

FAST_PATH_SIMPLE_MARKERS = (
    "总结",
    "概括",
    "介绍",
    "摘要",
    "创新点",
    "贡献",
    "方法",
    "实验",
    "数据集",
    "结论",
    "局限",
    "不足",
    "是什么",
    "讲了什么",
    "summarize",
    "summary",
    "abstract",
    "contribution",
    "method",
    "experiment",
    "dataset",
    "limitation",
    "what is",
)

FAST_PATH_COMPLEX_MARKERS = (
    "文献综述",
    "综述",
    "survey",
    "related work",
    "research proposal",
    "proposal",
    "写一篇",
    "写篇",
    "论文草稿",
    "ppt",
    "slides",
    "presentation",
    "画",
    "图片",
    "图像",
    "架构图",
    "流程图",
    "思维导图",
    "图表",
    "可视化",
)

def tokenize(text):
    lowered = (text or "").lower()
    terms = [
        term
        for term in ASCII_TERM_RE.findall(lowered)
        if len(term) > 1 and term not in STOP_WORDS
    ]
    for run in CJK_RUN_RE.findall(lowered):
        if len(run) == 1:
            if run not in STOP_WORDS:
                terms.append(run)
            continue
        terms.extend(
            run[index : index + 2]
            for index in range(len(run) - 1)
            if run[index : index + 2] not in STOP_WORDS
        )
    return terms


def detect_languages(text):
    value = text or ""
    cjk_count = len(CJK_RUN_RE.findall(value))
    ascii_count = len(ASCII_TERM_RE.findall(value.lower()))
    languages = []
    if ascii_count >= 2:
        languages.append("en")
    if cjk_count >= 2:
        languages.append("zh")
    return languages or ["en"]


def chunk_pdf_text(text, chunk_chars=1400, overlap_chars=180):
    normalized = SPACE_RE.sub(" ", CONTROL_RE.sub(" ", text or "")).strip()
    chunks = []
    start = 0
    while start < len(normalized):
        end = min(start + chunk_chars, len(normalized))
        if end < len(normalized):
            for marker in (". ", "。", "! ", "！", "? ", "？", "; ", "；"):
                boundary = normalized.rfind(marker, start + chunk_chars // 2, end)
                if boundary > start:
                    end = max(end if end - boundary < 40 else boundary + len(marker), start + 1)
                    break
        chunk = normalized[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(normalized):
            break
        start = max(end - overlap_chars, start + 1)
    return chunks


def _json_from_text(text):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text or "", flags=re.S)
        if match:
            return json.loads(match.group(0))
    return None


def build_paper_refs(papers):
    refs = []
    for index, paper in enumerate(papers or [], 1):
        language_text = " ".join(
            str(part or "")
            for part in (paper.get("title"), paper.get("abstract"), paper.get("detail_snippet"))
        )
        languages = detect_languages(language_text)
        refs.append(
            {
                "paper_id": paper.get("id"),
                "ref": f"P{index}",
                "ref_id": f"p{paper.get('id')}",
                "title": paper.get("title") or "未命名论文",
                "languages": languages,
                "primary_language": languages[0],
                "pdf_url": paper.get("pdf_url"),
            }
        )
    return refs


def build_citation_tool_payload(papers):
    """Hook for future review-writing/function-call flows."""
    return [
        {
            "paper_id": paper.get("id"),
            "title": paper.get("title"),
            "citations": citation_formats_from_paper(paper),
        }
        for paper in papers
    ]


def store_pdf_chunks(paper_id, upload_id, text):
    chunks = chunk_pdf_text(text)
    execute("DELETE FROM paper_chunks WHERE upload_id=%s", (upload_id,))
    rows = []
    for index, chunk in enumerate(chunks):
        rows.append(
            (
                paper_id,
                upload_id,
                index,
                ",".join(detect_languages(chunk)),
                chunk,
                max(1, len(chunk) // 4),
                {"source": "pdf_upload"},
            )
        )
    if rows:
        executemany(
            """
            INSERT INTO paper_chunks
                (paper_id, upload_id, chunk_no, language, text, token_count, metadata_json)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (upload_id, chunk_no) DO UPDATE
            SET text=EXCLUDED.text,
                language=EXCLUDED.language,
                token_count=EXCLUDED.token_count,
                metadata_json=EXCLUDED.metadata_json
            """,
            rows,
        )
    return len(rows)


def _load_chunks(upload_rows):
    upload_ids = [row.get("upload_id") or row.get("id") for row in upload_rows if row.get("upload_id") or row.get("id")]
    if not upload_ids:
        return []
    placeholders = ",".join(["%s"] * len(upload_ids))
    return normalize_rows(
        query(
            f"""
            SELECT pc.id, pc.paper_id, pc.upload_id, pc.chunk_no, pc.language, pc.text,
                   pc.embedding_model, pc.embedding_json, pc.embedding_dim,
                   (pc.embedding IS NOT NULL) AS has_embedding,
                   p.title
            FROM paper_chunks pc
            JOIN papers p ON p.id = pc.paper_id
            WHERE pc.upload_id IN ({placeholders})
            ORDER BY pc.paper_id, pc.chunk_no
            """,
            tuple(upload_ids),
        )
    )


def load_or_create_chunks(upload_rows):
    existing = _load_chunks(upload_rows)
    existing_uploads = {row.get("upload_id") for row in existing}
    for upload in upload_rows:
        upload_id = upload.get("upload_id") or upload.get("id")
        if upload_id and upload_id not in existing_uploads and upload.get("extracted_text"):
            store_pdf_chunks(upload.get("paper_id"), upload_id, upload.get("extracted_text"))
    return _load_chunks(upload_rows)


def _llm_configured(llm_settings=None):
    settings = llm_settings or {}
    return bool(
        (settings.get("base_url") or os.getenv("LLM_BASE_URL"))
        and (settings.get("api_key") or os.getenv("LLM_API_KEY"))
    )


def should_use_fast_path(question, paper_refs, skills=None):
    fast_path_mode = os.getenv("PAPER_QA_FAST_PATH", "true").lower()
    if fast_path_mode in {"0", "false", "no", "off"}:
        return False
    if skills:
        return False
    text = SPACE_RE.sub(" ", str(question or "").lower()).strip()
    if not text:
        return False
    if any(marker in text for marker in FAST_PATH_COMPLEX_MARKERS):
        return False
    if fast_path_mode in {"aggressive", "force"}:
        return len(text) <= int(os.getenv("PAPER_QA_FAST_PATH_MAX_CHARS", "260"))
    if len(paper_refs or []) <= 1 and len(text) <= int(os.getenv("PAPER_QA_FAST_PATH_SINGLE_MAX_CHARS", "220")):
        return True
    return len(text) <= int(os.getenv("PAPER_QA_FAST_PATH_SIMPLE_MAX_CHARS", "120")) and any(
        marker in text for marker in FAST_PATH_SIMPLE_MARKERS
    )


def _minimal_plan(question, paper_refs, reason="llm_unavailable"):
    languages = sorted({lang for ref in paper_refs for lang in ref.get("languages", [])})
    return {
        "task_type": "fact_lookup",
        "languages": languages or ["en"],
        "queries": [{"intent": "original user question", "zh": [question], "en": [question]}],
        "planner": "minimal",
        "planning_status": reason,
    }


def _heuristic_route(question, paper_refs, reason="llm_unavailable"):
    text = (question or "").lower()
    generative_markers = (
        "ppt",
        "slide",
        "slides",
        "presentation",
        "画",
        "图片",
        "图像",
        "架构图",
        "流程图",
        "思维导图",
        "图表",
        "可视化",
    )
    orchestrated_markers = (
        "文献综述",
        "综述",
        "survey",
        "写一篇",
        "写篇",
        "论文草稿",
        "research proposal",
        "proposal",
    )
    reasoning_markers = (
        "局限",
        "不足",
        "改进",
        "扩展",
        "批判",
        "评价",
        "启发",
        "为什么",
        "对比",
        "比较",
        "limitation",
        "improve",
        "critique",
        "compare",
        "future work",
        "idea",
    )
    if any(marker in text for marker in orchestrated_markers):
        qa_type = "orchestrated_task"
    elif any(marker in text for marker in generative_markers):
        qa_type = "generative_creation"
    elif any(marker in text for marker in reasoning_markers):
        qa_type = "beyond_paper_reasoning"
    else:
        qa_type = "in_paper_qa"
    return {
        "qa_type": qa_type,
        "document_mode": "multi_document" if len(paper_refs or []) > 1 else "single_document",
        "target_paper_refs": [ref.get("ref") for ref in paper_refs or []],
        "strategy": _route_strategy(qa_type),
        "reason": reason,
        "router": "heuristic",
        "routing_status": reason,
    }


def _route_strategy(qa_type):
    if qa_type == "in_paper_qa":
        return "RAG (Keyword+Embedding) + faithful answer grounded in PDF evidence"
    if qa_type == "beyond_paper_reasoning":
        return "retrieval-assisted answer + deeper LLM reasoning with evidence/inference separation"
    if qa_type == "generative_creation":
        return "retrieve source evidence, then use enabled generative skills or produce a tool-ready artifact specification"
    if qa_type == "orchestrated_task":
        return "three-step writing orchestration: choose exemplar papers, draft/edit paragraph outline, then write sections into library files"
    return "RAG"


def _normalize_route(parsed, question, paper_refs):
    if not isinstance(parsed, dict):
        return None
    qa_type = parsed.get("qa_type")
    if qa_type not in QA_ROUTE_TYPES:
        return None
    document_mode = parsed.get("document_mode")
    if document_mode not in {"single_document", "multi_document"}:
        document_mode = "multi_document" if len(paper_refs or []) > 1 else "single_document"
    known_refs = {ref.get("ref") for ref in paper_refs or []}
    target_refs = [
        ref
        for ref in _string_list(parsed.get("target_paper_refs"), limit=20)
        if not known_refs or ref in known_refs
    ]
    if not target_refs:
        target_refs = [ref.get("ref") for ref in paper_refs or []]
    return {
        "qa_type": qa_type,
        "document_mode": document_mode,
        "target_paper_refs": target_refs,
        "strategy": SPACE_RE.sub(" ", str(parsed.get("strategy") or _route_strategy(qa_type))).strip()[:300],
        "reason": SPACE_RE.sub(" ", str(parsed.get("reason") or "")).strip()[:300],
        "router": "llm",
        "routing_status": "ok",
    }


def classify_question_intent(question, paper_refs, llm_settings=None, skills=None):
    if not _llm_configured(llm_settings):
        return _heuristic_route(question, paper_refs)
    skill_summary = [
        {
            "id": skill.get("id"),
            "name": skill.get("name"),
            "description": skill.get("description"),
            "entrypoint": skill.get("entrypoint"),
        }
        for skill in skills or []
    ]
    prompt = f"""
你是 ScholarX 论文问答路由器，只输出 JSON。
任务：先识别用户问题意图，再选择问答路由。

可选路由：
1. in_paper_qa：原文检索型。答案存在于论文中，不需要额外推理，例如“创新点是什么”“实验用了什么数据集”。策略：RAG (Keyword+Embedding) + 忠实生成。
2. beyond_paper_reasoning：知识推理型。答案不存在于原文，需要基于原文进行推理、批判、扩展或提出新想法，例如“这个方法有什么局限性”“如何改进”。策略：检索辅助 + LLM 深层推理。
3. generative_creation：生成创作型。用户要求输出非纯文本实体或可制作实体的内容，例如图片、PPT、思维导图、图表。策略：调用或利用可用多模态生成工具、ppt-master 等 skill；若没有实际工具，输出可交给工具执行的结构化方案。
4. orchestrated_task：编排规划型。复杂写作任务，例如写论文、写综述、写 related work。策略分三步：先呈现可借鉴论文（库内 title/venue 相似论文 + arXiv 检索候选），用户选择参考哪些篇；再由 LLM 总结段落级大纲并允许用户修改；最后根据大纲逐段写入文件，用户可选中段落要求 AI 修改或用 Tab 自动补全。目前只启动编排入口，不直接生成全文。

判断文档范围：
- 如果有多篇论文且问题要求比较、综合、综述、跨论文归纳，document_mode=multi_document。
- 如果问题明显只针对一篇论文，document_mode=single_document。

用户问题：{question}
论文引用：{json.dumps(paper_refs, ensure_ascii=False)}
已启用 skills：{json.dumps(skill_summary, ensure_ascii=False)}

JSON schema:
{{
  "qa_type": "in_paper_qa|beyond_paper_reasoning|generative_creation|orchestrated_task",
  "document_mode": "single_document|multi_document",
  "target_paper_refs": ["P1"],
  "strategy": "一句话说明执行策略",
  "reason": "一句话说明为什么选择该路由"
}}
"""
    try:
        result = chat_completion(
            [{"role": "user", "content": prompt}],
            model=(llm_settings or {}).get("model"),
            base_url=(llm_settings or {}).get("base_url"),
            api_key=(llm_settings or {}).get("api_key"),
            protocol=(llm_settings or {}).get("protocol"),
            temperature=0.0,
        )
        parsed = _json_from_text(result.get("content") or "")
        normalized = _normalize_route(parsed, question, paper_refs)
        if normalized:
            return normalized
    except Exception:
        return _heuristic_route(question, paper_refs, reason="llm_failed")
    return _heuristic_route(question, paper_refs, reason="llm_invalid_json")


def _string_list(value, limit=8):
    if isinstance(value, str):
        values = [value]
    elif isinstance(value, list):
        values = [item for item in value if isinstance(item, str)]
    else:
        values = []
    cleaned = []
    seen = set()
    for item in values:
        text = SPACE_RE.sub(" ", item).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        cleaned.append(text[:160])
        if len(cleaned) >= limit:
            break
    return cleaned


def _normalize_plan(parsed, question, paper_refs):
    if not isinstance(parsed, dict):
        return None
    raw_queries = parsed.get("queries")
    if not isinstance(raw_queries, list) or not raw_queries:
        return None

    detected_languages = sorted({lang for ref in paper_refs for lang in ref.get("languages", [])}) or ["en"]
    requested_languages = _string_list(parsed.get("languages"), limit=4)
    languages = sorted(set(requested_languages or detected_languages))
    queries = []
    seen = set()
    for item in raw_queries:
        if not isinstance(item, dict):
            continue
        query = {
            "intent": SPACE_RE.sub(" ", str(item.get("intent") or item.get("question_rewrite") or "retrieval")).strip()[:160],
            "question_rewrite": SPACE_RE.sub(" ", str(item.get("question_rewrite") or "")).strip()[:220],
            "zh": _string_list(item.get("zh")),
            "en": _string_list(item.get("en")),
            "similar_terms": _string_list(item.get("similar_terms")),
            "related_terms": _string_list(item.get("related_terms")),
            "section_hints": _string_list(item.get("section_hints")),
        }
        if not any(query.get(key) for key in ("question_rewrite", "zh", "en", "similar_terms", "related_terms", "section_hints")):
            continue
        key = json.dumps(query, ensure_ascii=False, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        queries.append(query)
        if len(queries) >= 6:
            break
    if not queries:
        return None
    return {
        "task_type": parsed.get("task_type") if parsed.get("task_type") in {"fact_lookup", "comparison", "synthesis"} else "fact_lookup",
        "languages": languages,
        "queries": queries,
        "planner": "llm",
        "planning_status": "ok",
        "reasoning_brief": SPACE_RE.sub(" ", str(parsed.get("reasoning_brief") or "")).strip()[:240],
    }


def plan_question(question, paper_refs, llm_settings=None):
    if not _llm_configured(llm_settings):
        return _minimal_plan(question, paper_refs)
    prompt = f"""
你是论文问答检索规划器，只输出 JSON。
任务：根据用户问题和论文语言，生成用于 PDF 检索的查询计划。你必须生成语义相似表达和相关概念，用来解决中文问题检索英文论文的问题。
要求：
- 如果论文语言包含英文，即使用户用中文问，也必须给出英文 question_rewrite、similar_terms、related_terms、section_hints。
- 如果论文可能中英文混合，中文和英文都要给。
- 简单事实问题给 1-2 个 query；复杂综合任务给 3-5 个 query。
- related_terms 应覆盖论文里可能出现但用户没说出的同义词、上位词、章节名、实验表述。
- section_hints 写论文中可能承载答案的区域，例如 Experiments、Experimental setup、Results、Ablation、Method。
- 不要回答用户问题。

用户问题：{question}
论文：{json.dumps(paper_refs, ensure_ascii=False)}

JSON schema:
{{
  "task_type": "fact_lookup|comparison|synthesis",
  "languages": ["zh","en"],
  "reasoning_brief": "一句话说明为什么这样拆解",
  "queries": [{{
    "intent": "...",
    "question_rewrite": "...",
    "zh": ["..."],
    "en": ["..."],
    "similar_terms": ["..."],
    "related_terms": ["..."],
    "section_hints": ["..."]
  }}]
}}
"""
    try:
        result = chat_completion(
            [{"role": "user", "content": prompt}],
            model=(llm_settings or {}).get("model"),
            base_url=(llm_settings or {}).get("base_url"),
            api_key=(llm_settings or {}).get("api_key"),
            protocol=(llm_settings or {}).get("protocol"),
            temperature=0.1,
        )
        parsed = _json_from_text(result.get("content") or "")
        normalized = _normalize_plan(parsed, question, paper_refs)
        if normalized:
            return normalized
    except Exception:
        return _minimal_plan(question, paper_refs, reason="llm_failed")
    return _minimal_plan(question, paper_refs, reason="llm_invalid_json")


def _flatten_terms(value):
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        terms = []
        for item in value:
            terms.extend(_flatten_terms(item))
        return terms
    if isinstance(value, dict):
        terms = []
        for item in value.values():
            terms.extend(_flatten_terms(item))
        return terms
    return []


def _query_terms(plan):
    terms = []
    for item in plan.get("queries") or []:
        terms.extend(_flatten_terms(item))
    return " ".join(term for term in terms if term)


def _query_summary(plan, limit=3):
    rows = []
    for index, item in enumerate(plan.get("queries") or [], 1):
        terms = []
        for key in ("question_rewrite", "en", "zh", "similar_terms", "related_terms", "section_hints"):
            terms.extend(_flatten_terms(item.get(key)))
        cleaned = []
        seen = set()
        for term in terms:
            term = SPACE_RE.sub(" ", str(term or "")).strip()
            if not term or term in seen:
                continue
            seen.add(term)
            cleaned.append(term)
            if len(cleaned) >= 8:
                break
        rows.append(f"Q{index} {item.get('intent') or '检索'}：{'; '.join(cleaned) or item.get('question_rewrite') or '原问题'}")
        if len(rows) >= limit:
            break
    remaining = max(len(plan.get("queries") or []) - len(rows), 0)
    if remaining:
        rows.append(f"另有 {remaining} 个子查询")
    return "；".join(rows)


def _duration_ms(start):
    return round((perf_counter() - start) * 1000, 1)


def _format_duration(duration_ms):
    if duration_ms is None:
        return ""
    if duration_ms >= 1000:
        return f"{duration_ms / 1000:.2f}s"
    return f"{duration_ms:.0f}ms"


def _score_chunks(query_text, chunks):
    query_terms = Counter(tokenize(query_text))
    if not query_terms:
        return []
    chunk_terms = [Counter(tokenize(chunk.get("text"))) for chunk in chunks]
    document_frequency = Counter()
    for terms in chunk_terms:
        document_frequency.update(terms.keys())
    scored = []
    total_chunks = len(chunks)
    for chunk, terms in zip(chunks, chunk_terms):
        score = 0.0
        for term, query_frequency in query_terms.items():
            term_frequency = terms.get(term, 0)
            if not term_frequency:
                continue
            inverse_document_frequency = log((total_chunks + 1) / (document_frequency[term] + 1)) + 1
            score += (1 + log(term_frequency)) * inverse_document_frequency * (1 + log(query_frequency))
        if score:
            scored.append({**chunk, "score": score, "method": "keyword"})
    return sorted(scored, key=lambda item: item["score"], reverse=True)


def keyword_retrieve(plan, chunks, top_k=12, stats=None):
    started = perf_counter()
    results = _score_chunks(_query_terms(plan), chunks)[:top_k]
    if stats is not None:
        stats["keyword_ms"] = _duration_ms(started)
        stats["keyword_results"] = len(results)
    return results


def _cosine(left, right):
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = sqrt(sum(a * a for a in left))
    right_norm = sqrt(sum(b * b for b in right))
    return dot / (left_norm * right_norm) if left_norm and right_norm else 0.0


def _embed_texts(texts):
    return create_embeddings(texts)


def _vector_literal(values):
    cleaned = []
    for value in values or []:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return ""
        if not isfinite(number):
            return ""
        cleaned.append(f"{number:.8g}")
    return f"[{','.join(cleaned)}]" if cleaned else ""


def _same_embedding_model(left, right):
    return not left or not right or str(left) == str(right)


def _backfill_chunk_vectors(chunks, model, stats=None):
    updates = []
    for chunk in chunks:
        embedding = chunk.get("embedding_json")
        if not embedding or chunk.get("has_embedding") or not chunk.get("id"):
            continue
        if not _same_embedding_model(chunk.get("embedding_model"), model):
            continue
        literal = _vector_literal(embedding)
        if literal:
            updates.append((literal, len(embedding), chunk["id"]))
            chunk["has_embedding"] = True
            chunk["embedding_dim"] = len(embedding)
    if not updates:
        return 0
    executemany(
        "UPDATE paper_chunks SET embedding=%s::vector, embedding_dim=%s WHERE id=%s",
        updates,
    )
    if stats is not None:
        stats["embedding_vector_backfilled"] = len(updates)
    return len(updates)


def _pgvector_retrieve(query_embedding, model, chunks, top_k=12, stats=None):
    literal = _vector_literal(query_embedding)
    if not literal:
        return []
    candidate_ids = [
        int(chunk["id"])
        for chunk in chunks
        if chunk.get("id")
        and chunk.get("has_embedding")
        and int(chunk.get("embedding_dim") or 0) == len(query_embedding)
        and _same_embedding_model(chunk.get("embedding_model"), model)
    ]
    if not candidate_ids:
        return []
    placeholders = ",".join(["%s"] * len(candidate_ids))
    params = [literal, *candidate_ids, len(query_embedding), model, literal, top_k]
    rows = query(
        f"""
        SELECT id, 1 - (embedding <=> %s::vector) AS score
        FROM paper_chunks
        WHERE id IN ({placeholders})
          AND embedding IS NOT NULL
          AND embedding_dim=%s
          AND (embedding_model=%s OR embedding_model IS NULL)
        ORDER BY embedding <=> %s::vector
        LIMIT %s
        """,
        tuple(params),
    )
    by_id = {int(chunk["id"]): chunk for chunk in chunks if chunk.get("id")}
    results = []
    for row in rows:
        chunk = by_id.get(int(row.get("id")))
        if not chunk:
            continue
        score = float(row.get("score") or 0)
        if score > 0:
            results.append({**chunk, "score": score, "method": "embedding"})
    if stats is not None:
        stats["embedding_vector_candidates"] = len(candidate_ids)
        stats["embedding_vector_results"] = len(results)
    return results


def embedding_retrieve(question, plan, chunks, top_k=12, stats=None):
    started = perf_counter()
    if os.getenv("PAPER_QA_ENABLE_EMBEDDING", "true").lower() not in {"1", "true", "yes"}:
        if stats is not None:
            stats["embedding_enabled"] = False
            stats["embedding_ms"] = _duration_ms(started)
        return []
    max_chunks = int(os.getenv("PAPER_QA_EMBEDDING_MAX_CHUNKS", "160"))
    candidate_chunks = chunks[:max_chunks]
    if stats is not None:
        stats["embedding_enabled"] = True
        stats["embedding_candidates"] = len(candidate_chunks)
    if not candidate_chunks:
        if stats is not None:
            stats["embedding_ms"] = _duration_ms(started)
        return []
    query_text = f"{question}\n{_query_terms(plan)}"
    missing = [chunk for chunk in candidate_chunks if not chunk.get("embedding_json")]
    if stats is not None:
        stats["embedding_missing_chunks"] = len(missing)
    try:
        if missing:
            embed_chunks_started = perf_counter()
            batch = _embed_texts([chunk["text"][:1800] for chunk in missing])
            if stats is not None:
                stats["embedding_chunk_api_ms"] = _duration_ms(embed_chunks_started)
            updates = []
            for chunk, embedding in zip(missing, batch["embeddings"]):
                if embedding and chunk.get("id"):
                    literal = _vector_literal(embedding)
                    updates.append((
                        embedding,
                        literal or None,
                        literal or None,
                        len(embedding),
                        batch["model"],
                        chunk["id"],
                    ))
                    chunk["embedding_json"] = embedding
                    chunk["embedding_model"] = batch["model"]
                    chunk["embedding_dim"] = len(embedding)
                    chunk["has_embedding"] = bool(literal)
            if updates:
                db_started = perf_counter()
                executemany(
                    """
                    UPDATE paper_chunks
                    SET embedding_json=%s,
                        embedding=CASE WHEN %s IS NULL THEN embedding ELSE %s::vector END,
                        embedding_dim=%s,
                        embedding_model=%s
                    WHERE id=%s
                    """,
                    updates,
                )
                if stats is not None:
                    stats["embedding_db_ms"] = _duration_ms(db_started)
                    stats["embedding_saved_chunks"] = len(updates)
        query_started = perf_counter()
        query_batch = _embed_texts([query_text])
        query_embedding = query_batch["embeddings"][0]
        query_model = query_batch["model"]
        if stats is not None:
            stats["embedding_query_api_ms"] = _duration_ms(query_started)
    except LLMRequestError:
        if stats is not None:
            stats["embedding_error"] = "llm_request_error"
            stats["embedding_ms"] = _duration_ms(started)
        return []
    try:
        vector_db_started = perf_counter()
        _backfill_chunk_vectors(candidate_chunks, query_model, stats=stats)
        vector_results = _pgvector_retrieve(query_embedding, query_model, candidate_chunks, top_k=top_k, stats=stats)
        if vector_results:
            if stats is not None:
                stats["embedding_storage"] = "pgvector"
                stats["embedding_vector_ms"] = _duration_ms(vector_db_started)
                stats["embedding_results"] = len(vector_results)
                stats["embedding_ms"] = _duration_ms(started)
            return vector_results
    except Exception as exc:
        if stats is not None:
            stats["embedding_vector_error"] = str(exc)[:180]
    scored = []
    for chunk in candidate_chunks:
        score = _cosine(query_embedding, chunk.get("embedding_json") or [])
        if score > 0:
            scored.append({**chunk, "score": score, "method": "embedding"})
    results = sorted(scored, key=lambda item: item["score"], reverse=True)[:top_k]
    if stats is not None:
        stats["embedding_storage"] = "jsonb"
        stats["embedding_results"] = len(results)
        stats["embedding_ms"] = _duration_ms(started)
    return results


def retrieve_hybrid(question, plan, chunks, stats=None):
    started = perf_counter()
    stats = stats if stats is not None else {}
    with ThreadPoolExecutor(max_workers=2) as pool:
        keyword_future = pool.submit(keyword_retrieve, plan, chunks, stats=stats)
        embedding_future = pool.submit(embedding_retrieve, question, plan, chunks, stats=stats)
        keyword_results = keyword_future.result()
        embedding_results = embedding_future.result()

    def normalize(results):
        max_score = max((float(item.get("score") or 0) for item in results), default=0)
        if not max_score:
            return results
        return [
            {
                **item,
                "raw_score": float(item.get("score") or 0),
                "score": float(item.get("score") or 0) / max_score,
            }
            for item in results
        ]

    keyword_results = normalize(keyword_results)
    embedding_results = normalize(embedding_results)
    merged = {}
    for item in keyword_results + embedding_results:
        key = item.get("id") or (item.get("paper_id"), item.get("chunk_no"))
        current = merged.get(key)
        if not current:
            merged[key] = item
            continue
        current["score"] = current.get("score", 0) + item.get("score", 0)
        methods = set(str(current.get("method", "")).split("+")) | {item.get("method")}
        current["method"] = "+".join(sorted(method for method in methods if method))
    ranked = sorted(merged.values(), key=lambda item: item.get("score", 0), reverse=True)
    stats["hybrid_ms"] = _duration_ms(started)
    stats["hybrid_results"] = len(ranked)
    return ranked


def retrieve_multi_document(question, plan, chunks, paper_refs, stats=None):
    started = perf_counter()
    stats = stats if stats is not None else {}
    chunks_by_paper = {}
    for chunk in chunks:
        chunks_by_paper.setdefault(chunk.get("paper_id"), []).append(chunk)
    target_ids = [
        ref.get("paper_id")
        for ref in paper_refs or []
        if chunks_by_paper.get(ref.get("paper_id"))
    ]
    if not target_ids:
        stats["multi_doc_ms"] = _duration_ms(started)
        stats["documents"] = []
        return []

    max_workers = max(1, min(int(os.getenv("PAPER_QA_MULTI_DOC_WORKERS", "4")), len(target_ids)))
    per_doc_limit = max(1, int(os.getenv("PAPER_QA_PER_DOC_EVIDENCE", "4")))

    def retrieve_for_paper(paper_id):
        local_stats = {}
        ranked = retrieve_hybrid(question, plan, chunks_by_paper.get(paper_id) or [], stats=local_stats)
        selected = ranked[:per_doc_limit]
        return paper_id, selected, local_stats

    combined = []
    documents = []
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [pool.submit(retrieve_for_paper, paper_id) for paper_id in target_ids]
        for future in futures:
            paper_id, selected, local_stats = future.result()
            combined.extend(selected)
            documents.append(
                {
                    "paper_id": paper_id,
                    "candidate_chunks": len(chunks_by_paper.get(paper_id) or []),
                    "selected_chunks": len(selected),
                    "stats": local_stats,
                }
            )

    ranked = sorted(combined, key=lambda item: item.get("score", 0), reverse=True)
    stats["document_strategy"] = "parallel_per_document"
    stats["documents"] = documents
    stats["multi_doc_workers"] = max_workers
    stats["multi_doc_ms"] = _duration_ms(started)
    stats["hybrid_results"] = len(ranked)
    return ranked


def expand_neighbor_chunks(evidence, chunks, top_n=5):
    chunk_map = {(chunk.get("paper_id"), chunk.get("chunk_no")): chunk for chunk in chunks}
    expanded = []
    seen = set()
    for item in evidence[:top_n]:
        for offset in (0, 1, -1):
            neighbor = chunk_map.get((item.get("paper_id"), item.get("chunk_no") + offset))
            if not neighbor:
                continue
            key = neighbor.get("id") or (neighbor.get("paper_id"), neighbor.get("chunk_no"))
            if key in seen:
                continue
            seen.add(key)
            if offset == 0:
                expanded.append(item)
            else:
                expanded.append(
                    {
                        **neighbor,
                        "score": max(float(item.get("score") or 0) - 0.001, 0),
                        "method": f"{item.get('method') or 'retrieval'}+neighbor",
                    }
                )
    return expanded + [item for item in evidence if (item.get("id") or (item.get("paper_id"), item.get("chunk_no"))) not in seen]


def check_evidence(question, plan, evidence, llm_settings=None):
    if not _llm_configured(llm_settings):
        return {"sufficient": bool(evidence), "retry_queries": []}
    prompt = f"""
你是论文证据检查器，只输出 JSON。
判断检索片段是否足以回答用户问题；如果不足，继续生成语义相似表达和相关概念用于下一轮检索。

用户问题：{question}
检索计划：{json.dumps(plan, ensure_ascii=False)}
证据摘要：{json.dumps([{"title": item.get("title"), "text": item.get("text", "")[:500]} for item in evidence], ensure_ascii=False)}

JSON schema:
{{
  "sufficient": true,
  "reason": "...",
  "retry_queries": [{{
    "intent": "...",
    "question_rewrite": "...",
    "zh": ["..."],
    "en": ["..."],
    "similar_terms": ["..."],
    "related_terms": ["..."],
    "section_hints": ["..."]
  }}]
}}
"""
    try:
        result = chat_completion(
            [{"role": "user", "content": prompt}],
            model=(llm_settings or {}).get("model"),
            base_url=(llm_settings or {}).get("base_url"),
            api_key=(llm_settings or {}).get("api_key"),
            protocol=(llm_settings or {}).get("protocol"),
            temperature=0.1,
        )
        parsed = _json_from_text(result.get("content") or "")
        if parsed:
            retry_plan = _normalize_plan(
                {"queries": parsed.get("retry_queries") or [], "languages": plan.get("languages") or []},
                question,
                [],
            )
            return {
                "sufficient": bool(parsed.get("sufficient")),
                "reason": parsed.get("reason") or "",
                "retry_queries": retry_plan.get("queries") if retry_plan else [],
            }
    except Exception:
        pass
    return {"sufficient": bool(evidence), "retry_queries": []}


def _target_paper_refs(paper_refs, route_plan):
    target_refs = set((route_plan or {}).get("target_paper_refs") or [])
    if not target_refs:
        return paper_refs
    selected = [ref for ref in paper_refs if ref.get("ref") in target_refs]
    return selected or paper_refs


def _paper_ref_for(paper_refs, paper_id):
    for ref in paper_refs:
        if str(ref.get("paper_id")) == str(paper_id):
            return ref
    return {"ref": "P?", "title": "引用文献", "paper_id": paper_id}


def build_evidence_context(question, papers, upload_rows, llm_settings=None, route_plan=None, initial_trace=None, paper_refs=None, fast_path=False):
    total_started = perf_counter()
    emitted_trace = list(initial_trace or [])

    trace_callback = None
    if isinstance(llm_settings, dict):
        trace_callback = llm_settings.pop("_trace_callback", None)

    def emit_trace(stage, title, detail, duration_ms=None, **extra):
        if duration_ms is not None:
            detail = f"{detail}（耗时 {_format_duration(duration_ms)}）"
        item = {"stage": stage, "title": title, "detail": detail, **extra}
        if duration_ms is not None:
            item["duration_ms"] = duration_ms
        emitted_trace.append(item)
        if trace_callback:
            trace_callback(item)
        return item

    started = perf_counter()
    paper_refs = paper_refs or build_paper_refs(papers)
    language_detail = "；".join(
        f"{ref.get('ref')}: {','.join(ref.get('languages') or [])}"
        for ref in paper_refs
    ) or "未检测到论文语言"
    emit_trace("language", "语言识别", language_detail, duration_ms=_duration_ms(started))

    started = perf_counter()
    chunks = load_or_create_chunks(upload_rows)
    emit_trace("chunking", "读取 PDF", f"读取 {len(upload_rows)} 个 PDF，得到 {len(chunks)} 个文本块", duration_ms=_duration_ms(started))

    document_mode = (route_plan or {}).get("document_mode") or ("multi_document" if len(paper_refs) > 1 else "single_document")
    retrieval_paper_refs = _target_paper_refs(paper_refs, route_plan)
    if len(retrieval_paper_refs) != len(paper_refs):
        target_ids = {ref.get("paper_id") for ref in retrieval_paper_refs}
        chunks = [chunk for chunk in chunks if chunk.get("paper_id") in target_ids]
        emit_trace(
            "document_scope",
            "文档范围",
            f"路由器选中 {', '.join(ref.get('ref') for ref in retrieval_paper_refs)}，仅检索这些论文的 PDF 证据",
        )
    if document_mode == "multi_document" and len(retrieval_paper_refs) > 1:
        emit_trace("scheduler", "多文档调度", f"将 {len(retrieval_paper_refs)} 篇论文按文档分组，优先并行检索后再整合证据")

    started = perf_counter()
    if fast_path:
        emit_trace("query_planning", "快速查询", "跳过 LLM 查询规划，直接使用原问题检索")
        plan = _minimal_plan(question, retrieval_paper_refs, reason="fast_path")
    else:
        emit_trace("query_planning", "生成查询", "正在根据问题和论文语言生成检索查询")
        plan = plan_question(question, retrieval_paper_refs, llm_settings)
    if route_plan:
        plan = {**plan, "qa_route": route_plan}
    plan_ms = _duration_ms(started)
    emit_trace(
        "query_result",
        "返回查询" if not fast_path else "快速查询就绪",
        _query_summary(plan) or "未生成额外查询，使用原问题检索",
        duration_ms=plan_ms,
        task_type=plan.get("task_type"),
        query_count=len(plan.get("queries") or []),
        fast_path=bool(fast_path),
    )

    emit_trace("retrieval", "检索证据", "并行执行关键词匹配和 embedding 相似度检索")
    retrieval_stats = {}
    started = perf_counter()
    if document_mode == "multi_document" and len(retrieval_paper_refs) > 1:
        evidence = expand_neighbor_chunks(
            retrieve_multi_document(question, plan, chunks, retrieval_paper_refs, stats=retrieval_stats),
            chunks,
        )
        emit_trace(
            "integrator",
            "多文档整合",
            f"已汇总 {len(retrieval_stats.get('documents') or [])} 篇论文的候选证据，进入统一证据检查",
            stats={"documents": retrieval_stats.get("documents") or []},
        )
    else:
        evidence = expand_neighbor_chunks(retrieve_hybrid(question, plan, chunks, stats=retrieval_stats), chunks)
    retrieval_ms = _duration_ms(started)
    methods = sorted({method for chunk in evidence for method in str(chunk.get("method") or "").split("+") if method})
    if retrieval_stats.get("document_strategy") == "parallel_per_document":
        retrieval_detail = (
            f"按文档并行检索 {len(retrieval_stats.get('documents') or [])} 篇论文，"
            f"workers={retrieval_stats.get('multi_doc_workers', 1)}，候选证据 {len(evidence)} 个"
        )
    else:
        retrieval_detail = (
            f"使用 {', '.join(methods) or 'keyword'}，候选证据 {len(evidence)} 个；"
            f"keyword {_format_duration(retrieval_stats.get('keyword_ms'))} / {retrieval_stats.get('keyword_results', 0)} 条；"
            f"embedding {_format_duration(retrieval_stats.get('embedding_ms'))} / {retrieval_stats.get('embedding_results', 0)} 条，"
            f"缺失缓存 {retrieval_stats.get('embedding_missing_chunks', 0)} 个"
        )
        if retrieval_stats.get("embedding_chunk_api_ms") is not None:
            retrieval_detail += f"，chunk 向量 {_format_duration(retrieval_stats.get('embedding_chunk_api_ms'))}"
        if retrieval_stats.get("embedding_query_api_ms") is not None:
            retrieval_detail += f"，query 向量 {_format_duration(retrieval_stats.get('embedding_query_api_ms'))}"
        if retrieval_stats.get("embedding_db_ms") is not None:
            retrieval_detail += f"，写库 {_format_duration(retrieval_stats.get('embedding_db_ms'))}"
    emit_trace("retrieval_result", "返回证据", retrieval_detail, duration_ms=retrieval_ms, stats=retrieval_stats)

    if fast_path:
        emit_trace("evidence_check", "快速检查", "跳过 LLM 证据检查，使用首轮检索结果")
        checker = {
            "sufficient": bool(evidence),
            "reason": "fast_path_skipped_llm_check",
            "retry_queries": [],
        }
        emit_trace(
            "evidence_check_result",
            "快速检查完成",
            "已有候选证据" if evidence else "未检索到候选证据",
            sufficient=bool(evidence),
            fast_path=True,
        )
    else:
        emit_trace("evidence_check", "证据检查", "正在判断证据是否足以回答问题")
        started = perf_counter()
        checker = check_evidence(question, plan, evidence[:6], llm_settings)
        checker_ms = _duration_ms(started)
        emit_trace(
            "evidence_check_result",
            "检查结果",
            checker.get("reason") or ("证据足够" if checker.get("sufficient") else "证据不足"),
            duration_ms=checker_ms,
            sufficient=bool(checker.get("sufficient")),
        )
        retries = 0
        while not checker.get("sufficient") and checker.get("retry_queries") and retries < 2:
            retries += 1
            retry_plan = {**plan, "queries": checker["retry_queries"]}
            emit_trace("query_rewrite", f"重写查询 {retries}", _query_summary(retry_plan) or "根据证据缺口重写查询")
            plan = {**plan, "queries": (plan.get("queries") or []) + checker["retry_queries"]}
            emit_trace("retrieval_retry", f"再次检索 {retries}", "使用重写后的查询重新检索证据")
            retrieval_stats = {}
            started = perf_counter()
            evidence = expand_neighbor_chunks(retrieve_hybrid(question, plan, chunks, stats=retrieval_stats), chunks)
            retrieval_ms = _duration_ms(started)
            methods = sorted({method for chunk in evidence for method in str(chunk.get("method") or "").split("+") if method})
            emit_trace(
                "retrieval_retry_result",
                f"再次返回证据 {retries}",
                f"使用 {', '.join(methods) or 'keyword'}，候选证据 {len(evidence)} 个；keyword {_format_duration(retrieval_stats.get('keyword_ms'))}；embedding {_format_duration(retrieval_stats.get('embedding_ms'))}，缺失缓存 {retrieval_stats.get('embedding_missing_chunks', 0)} 个",
                duration_ms=retrieval_ms,
                stats=retrieval_stats,
            )
            emit_trace("evidence_recheck", f"重新检查 {retries}", "正在检查新证据是否足够")
            started = perf_counter()
            checker = check_evidence(question, plan, evidence[:6], llm_settings)
            checker_ms = _duration_ms(started)
            emit_trace(
                "evidence_recheck_result",
                f"复查结果 {retries}",
                checker.get("reason") or ("证据足够" if checker.get("sufficient") else "仍然不足"),
                duration_ms=checker_ms,
                sufficient=bool(checker.get("sufficient")),
            )

    started = perf_counter()
    selected = []
    parts = []
    used_chars = 0
    max_context_chars = int(os.getenv("PAPER_QA_MAX_CONTEXT_CHARS", "7200"))
    for index, item in enumerate(evidence[:8], 1):
        ref = _paper_ref_for(paper_refs, item.get("paper_id"))
        evidence_id = f"E{index}"
        citation_ref_id = f"p{item.get('paper_id')}:c{item.get('chunk_no', 0)}"
        citation = f"[[ref:{citation_ref_id}]]"
        header = f"{citation} {ref['title']} | chunk {item.get('chunk_no', 0) + 1} | {item.get('method')}\n"
        available = max_context_chars - used_chars - len(header)
        if available <= 0:
            break
        excerpt = item.get("text", "")[:available]
        parts.append(header + excerpt)
        used_chars += len(header) + len(excerpt)
        selected.append(
            {
                "evidence_id": evidence_id,
                "citation": citation,
                "ref_id": citation_ref_id,
                "paper_ref": ref["ref"],
                "paper_id": item.get("paper_id"),
                "title": ref["title"],
                "chunk_no": item.get("chunk_no"),
                "method": item.get("method"),
                "score": round(float(item.get("score") or 0), 4),
                "text": excerpt,
            }
        )
    emit_trace("evidence_selected", "选定证据", f"选入 {len(selected)} 个证据片段用于回答", duration_ms=_duration_ms(started))
    emit_trace("retrieval_total", "检索阶段完成", "完成回答前检索与证据检查", duration_ms=_duration_ms(total_started))

    return {
        "paper_refs": paper_refs,
        "qa_route": route_plan or {},
        "plan": plan,
        "checker": checker,
        "chunks": selected,
        "text": "\n\n".join(parts),
        "trace": emitted_trace,
    }


def build_retrieval_trace(paper_refs, plan, checker, chunks):
    languages = []
    for ref in paper_refs:
        languages.append(f"{ref.get('ref')}: {','.join(ref.get('languages') or [])}")
    methods = sorted({method for chunk in chunks for method in str(chunk.get("method") or "").split("+") if method})
    query_count = len(plan.get("queries") or [])
    return [
        {
            "stage": "language",
            "title": "语言识别",
            "detail": "；".join(languages) or "未检测到论文语言",
        },
        {
            "stage": "planning",
            "title": "Planning",
            "detail": f"{plan.get('task_type') or 'fact_lookup'}，{plan.get('planner') or 'llm'} 生成 {query_count} 个检索子查询",
        },
        {
            "stage": "retrieval",
            "title": "检索",
            "detail": f"使用 {', '.join(methods) or 'keyword'}，返回 {len(chunks)} 个证据片段",
        },
        {
            "stage": "check",
            "title": "检查",
            "detail": "证据足够" if checker.get("sufficient") else "证据不足，已尝试重写查询",
        },
    ]


def prepare_paper_qa_context(question, papers, upload_rows, llm_settings=None, skills=None):
    settings = dict(llm_settings or {})
    trace_callback = settings.get("_trace_callback")
    emitted_trace = []

    def emit_trace(stage, title, detail, duration_ms=None, **extra):
        if duration_ms is not None:
            detail = f"{detail}（耗时 {_format_duration(duration_ms)}）"
        item = {"stage": stage, "title": title, "detail": detail, **extra}
        if duration_ms is not None:
            item["duration_ms"] = duration_ms
        emitted_trace.append(item)
        if trace_callback:
            trace_callback(item)
        return item

    paper_refs = build_paper_refs(papers)
    emit_trace("intent", "意图识别", "正在判断问题类型与文档范围")
    started = perf_counter()
    fast_path = should_use_fast_path(question, paper_refs, skills=skills)
    route_plan = (
        _heuristic_route(question, paper_refs, reason="fast_path")
        if fast_path
        else classify_question_intent(question, paper_refs, settings, skills=skills)
    )
    emit_trace(
        "intent_result",
        "快速路由" if fast_path else "路由选择",
        f"{route_plan.get('qa_type')} / {route_plan.get('document_mode')}：{route_plan.get('reason') or route_plan.get('strategy')}",
        duration_ms=_duration_ms(started),
        qa_route=route_plan,
        fast_path=bool(fast_path),
    )

    if route_plan.get("qa_type") == "orchestrated_task":
        return {
            "paper_refs": paper_refs,
            "qa_route": route_plan,
            "plan": {
                "task_type": "orchestrated_task",
                "qa_route": route_plan,
                "planning_status": "workflow_entry",
                "steps": [
                    "候选参考论文：从当前库按 title/venue 相似度筛选，并补充 arXiv 检索候选，等待用户选择。",
                    "段落级大纲：LLM 总结参考论文写法，生成每段写什么，等待用户修改。",
                    "逐段写作：按大纲检索证据并写入文件，支持选中段落要求 AI 修改或自动补全。",
                ],
            },
            "checker": {"sufficient": False, "reason": "编排规划型需要用户先选择参考论文并确认大纲。"},
            "chunks": [],
            "text": "",
            "trace": emitted_trace,
        }

    return build_evidence_context(
        question,
        papers,
        upload_rows,
        settings,
        route_plan=route_plan,
        initial_trace=emitted_trace,
        paper_refs=paper_refs,
        fast_path=fast_path,
    )


def _answer_system_prompt(qa_route):
    qa_type = (qa_route or {}).get("qa_type") or "in_paper_qa"
    common = """你是 ScholarX 论文研究助手。
回答涉及具体论文内容时，只能复制 PDF 证据中提供的 [[ref:id]] 引用标记，不要使用 [P1] 或 [P1:E1]。
不要在面向用户的回答中呈现 paper_id、chunk_id、Paper id 等内部编号；引用只使用 [[ref:id]] 标记，论文称呼使用标题。
输出必须是合法 Markdown。数学公式必须使用 Markdown/LaTeX 数学分隔符：行内公式写 `$...$`，块级公式写 `$$...$$`；不要输出 `(J(\\theta))` 这种普通括号包裹的 LaTeX。
如果证据不足，直接说明缺口，并给出下一步检索建议。"""
    if qa_type == "in_paper_qa":
        return common + """
当前路由：原文检索型 (In-Paper QA)。
答案应严格忠实于给定 PDF 证据，不要补充证据外推断。"""
    if qa_type == "beyond_paper_reasoning":
        return common + """
当前路由：知识推理型 (Beyond-Paper Reasoning)。
先给出证据支持的结论，再明确标注“基于证据的推理/建议”。可以批判、比较和提出改进，但必须说明推理依据。"""
    if qa_type == "generative_creation":
        return common + """
当前路由：生成创作型 (Generative Creation)。
基于证据输出可直接交给生成工具或 skill 使用的结构化内容，例如 PPT 大纲、逐页讲稿、图片生成提示词、思维导图结构或图表规格。
如果启用了相关 skill，优先遵循 skill 指令；如果实际生成工具不可用，说明当前输出是 tool-ready 方案。"""
    if qa_type == "orchestrated_task":
        return common + """
当前路由：编排规划型 (Orchestrated Task)。
不要直接生成全文。请按三步输出下一步工作流：
1. 候选参考论文：说明需要先呈现多篇可借鉴论文，来源包括当前数据库中 title/venue 最相似的论文，以及 arXiv 检索候选；用户选择后进入下一步。
2. 段落级大纲：说明 LLM 会总结被选论文的写法，列出每段写什么，并允许用户手动修改大纲。
3. 逐段写作入文件：说明系统会按大纲逐段检索证据并写入文件，用户可选中段落要求 AI 修改，也可用自动补全继续写。
如果当前界面还未提供候选选择控件，明确说明现在先给出编排方案，不假装已经完成选择、写作或文件写入。"""
    return common


def build_answer_messages(question, papers, evidence_context, skills=None):
    paper_refs = evidence_context.get("paper_refs") or []
    paper_lines = []
    for ref in paper_refs:
        marker_id = ref.get("ref_id") or f"p{ref['paper_id']}"
        paper_lines.append(f"{ref['ref']}: {ref['title']} (marker=[[ref:{marker_id}]])")
    skill_lines = []
    for skill in skills or []:
        skill_lines.append(f"- {skill.get('name') or skill.get('id')}: {skill.get('prompt') or skill.get('description') or ''}")
    qa_route = evidence_context.get("qa_route") or (evidence_context.get("plan") or {}).get("qa_route") or {}
    system = _answer_system_prompt(qa_route)
    user = f"""
用户问题：
{question}

问答路由：
{json.dumps(qa_route, ensure_ascii=False)}

本轮参考论文：
{chr(10).join(paper_lines) or "无"}

检索计划：
{json.dumps(evidence_context.get("plan") or {}, ensure_ascii=False)}

PDF 证据：
{evidence_context.get("text") or "未检索到 PDF 证据。"}

额外 Skills：
{chr(10).join(skill_lines) if skill_lines else "无"}
"""
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def answer_paper_question(question, papers, upload_rows, llm_settings=None, skills=None):
    evidence_context = prepare_paper_qa_context(question, papers, upload_rows, llm_settings, skills=skills)
    result = chat_completion(
        build_answer_messages(question, papers, evidence_context, skills),
        model=(llm_settings or {}).get("model"),
        base_url=(llm_settings or {}).get("base_url"),
        api_key=(llm_settings or {}).get("api_key"),
        protocol=(llm_settings or {}).get("protocol"),
        temperature=0.2,
    )
    return {
        **result,
        "evidence_context": evidence_context,
    }


def select_pdf_evidence(question, uploads, max_chunks=5, max_context_chars=5200):
    papers = [
        {"id": upload.get("paper_id"), "title": upload.get("title")}
        for upload in uploads
        if upload.get("paper_id")
    ]
    context = build_evidence_context(question, papers, uploads)
    chunks = context["chunks"][:max_chunks]
    text = "\n\n".join(
        f"{chunk['citation']} {chunk['title']}\n{chunk['text'][:max_context_chars]}"
        for chunk in chunks
    )
    return {"text": text[:max_context_chars], "chunks": chunks}

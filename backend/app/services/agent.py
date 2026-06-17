from .llm import chat_completion


SYSTEM_PROMPT = """你是 ScholarX 论文研究助手。你可以帮助用户检索论文、整理论文库、基于 PDF 证据回答问题、生成综述。
回答时优先基于提供的论文上下文和 PDF 证据片段；不要假设未提供的 PDF 内容。如果信息不足，明确说明缺口并给出下一步建议。"""


def build_context(papers, pdf_text=None, web_details=None):
    lines = []
    for idx, paper in enumerate(papers[:20], 1):
        authors = paper.get("authors") or []
        if isinstance(authors, list):
            authors = ", ".join(str(author) for author in authors[:5])
        detail = paper.get("abstract") or paper.get("detail_snippet") or ""
        lines.append(
            f"{idx}. {paper.get('title')} ({paper.get('pub_year') or 'unknown'}) "
            f"{authors} venue={paper.get('venue_name') or paper.get('venue_abbr') or ''} "
            f"rank={paper.get('rank') or ''}\n{detail}"
        )
    if web_details:
        lines.append("\n联网检索详情:\n" + "\n".join(web_details[:10]))
    if pdf_text:
        lines.append("\n按问题检索出的 PDF 证据片段:\n" + pdf_text[:6000])
    return "\n\n".join(lines)


def build_skill_prompt(skills):
    if not skills:
        return ""
    lines = ["\n已启用 Skills:"]
    for skill in skills:
        lines.append(
            f"- {skill.get('name') or skill.get('id')}: "
            f"{skill.get('prompt') or skill.get('description') or ''}"
        )
    return "\n".join(lines)


def run_agent(user_message, papers=None, pdf_text=None, web_details=None, llm_settings=None, skills=None):
    context = build_context(papers or [], pdf_text, web_details)
    skill_prompt = build_skill_prompt(skills or [])
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT + skill_prompt},
        {"role": "user", "content": f"论文上下文:\n{context}\n\n用户需求:\n{user_message}"},
    ]
    llm_settings = llm_settings or {}
    return chat_completion(
        messages,
        model=llm_settings.get("model"),
        base_url=llm_settings.get("base_url"),
        api_key=llm_settings.get("api_key"),
        protocol=llm_settings.get("protocol"),
    )

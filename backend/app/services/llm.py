import os
import json
import requests


def _llm_protocol(protocol=None):
    return (protocol or os.getenv("LLM_PROTOCOL") or "").lower()


def _llm_model(model=None):
    return model or os.getenv("LLM_MODEL") or ""


def _embedding_model(model=None):
    return model or os.getenv("EMBEDDING_MODEL") or ""


class LLMRequestError(RuntimeError):
    code = 502


def _display_provider(protocol, model):
    return f"{protocol}:{model}" if model else protocol


def _raise_for_llm_status(response):
    if response.ok:
        return
    try:
        payload = response.json()
        error = payload.get("error", payload)
        message = error.get("message") if isinstance(error, dict) else str(error)
    except ValueError:
        message = response.text.strip()
    detail = message or response.reason or "unknown upstream error"
    raise LLMRequestError(f"LLM 接口调用失败（HTTP {response.status_code}）：{detail}")


def _embedding_endpoint(base_url):
    base = base_url.rstrip("/")
    if base.endswith("/embeddings"):
        return base
    if base.endswith("/v1"):
        return f"{base}/embeddings"
    return f"{base}/v1/embeddings"


def _models_endpoint(base_url):
    base = base_url.rstrip("/")
    if base.endswith("/models"):
        return base
    if base.endswith("/v1"):
        return f"{base}/models"
    return f"{base}/v1/models"


def _is_packyapi_base(base_url):
    return "packyapi" in (base_url or "").lower()


def _packyapi_models(default_model):
    response = requests.get(
        "https://www.packyapi.com/api/perf-metrics/summary",
        headers={"Accept": "application/json"},
        timeout=30,
    )
    _raise_for_llm_status(response)
    payload = response.json()
    items = (payload.get("data") or {}).get("models") or []
    models = []
    seen = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        model_id = item.get("model_name") or item.get("id") or item.get("name")
        if not model_id or model_id in seen:
            continue
        if "image" in str(model_id).lower():
            continue
        seen.add(model_id)
        models.append({
            "id": model_id,
            "name": model_id,
            "avg_latency_ms": item.get("avg_latency_ms"),
            "success_rate": item.get("success_rate"),
            "avg_tps": item.get("avg_tps"),
        })
    if default_model and default_model not in seen:
        models.insert(0, {"id": default_model, "name": default_model})
    elif default_model:
        models = [item for item in models if item["id"] != default_model]
        models.insert(0, {"id": default_model, "name": default_model})
    return models


def _as_anthropic_messages(messages):
    system_parts = []
    chat_messages = []
    for message in messages:
        role = message.get("role")
        content = message.get("content", "")
        if role == "system":
            system_parts.append(content)
        else:
            chat_messages.append({
                "role": "assistant" if role == "assistant" else "user",
                "content": content,
            })
    return "\n\n".join(system_parts), chat_messages


def _openai_completion(base_url, api_key, model, messages, temperature):
    response = requests.post(
        f"{base_url}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": model, "messages": messages, "temperature": temperature},
        timeout=60,
    )
    _raise_for_llm_status(response)
    data = response.json()
    return data["choices"][0]["message"]["content"]


def _anthropic_completion(base_url, api_key, model, messages, temperature):
    system, anthropic_messages = _as_anthropic_messages(messages)
    payload = {
        "model": model,
        "messages": anthropic_messages,
        "temperature": temperature,
        "max_tokens": int(os.getenv("LLM_MAX_TOKENS", "4096")),
    }
    if system:
        payload["system"] = system

    response = requests.post(
        f"{base_url}/messages",
        headers={
            "x-api-key": api_key,
            "anthropic-version": os.getenv("ANTHROPIC_VERSION", "2023-06-01"),
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=60,
    )
    _raise_for_llm_status(response)
    data = response.json()
    return "".join(part.get("text", "") for part in data.get("content", []) if part.get("type") == "text")


def _google_completion(base_url, api_key, model, messages, temperature):
    prompt = "\n\n".join(f"{message.get('role', 'user')}: {message.get('content', '')}" for message in messages)
    url = f"{base_url}/models/{model}:generateContent"
    response = requests.post(
        url,
        params={"key": api_key},
        headers={"Content-Type": "application/json"},
        json={
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": temperature},
        },
        timeout=60,
    )
    _raise_for_llm_status(response)
    data = response.json()
    candidates = data.get("candidates") or []
    parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
    return "".join(part.get("text", "") for part in parts)


def chat_completion(messages, model=None, temperature=0.2, base_url=None, api_key=None, protocol=None):
    api_key = api_key or os.getenv("LLM_API_KEY")
    protocol = _llm_protocol(protocol)
    base_url = (base_url or os.getenv("LLM_BASE_URL", "")).rstrip("/")
    model = _llm_model(model)

    if not base_url:
        return {
            "provider": _display_provider(protocol, model),
            "protocol": protocol,
            "model": model,
            "content": "还没有配置 LLM_BASE_URL。配置模型接口地址后即可调用模型。",
        }

    if not api_key:
        return {
            "provider": "local-placeholder",
            "protocol": protocol,
            "model": model,
            "content": "还没有配置 LLM_API_KEY。我已根据当前论文上下文整理了任务入口，配置后即可调用模型接口。",
        }
    if not protocol:
        raise ValueError("LLM_PROTOCOL is not configured.")
    if not model:
        raise ValueError("LLM_MODEL is not configured.")

    completions = {
        "openai": _openai_completion,
        "anthropic": _anthropic_completion,
        "google": _google_completion,
    }
    completion = completions.get(protocol)
    if not completion:
        raise ValueError(f"Unsupported LLM_PROTOCOL: {protocol}")

    content = completion(base_url, api_key, model, messages, temperature)
    return {"provider": _display_provider(protocol, model), "protocol": protocol, "model": model, "content": content}


def chat_completion_stream(messages, model=None, temperature=0.2, base_url=None, api_key=None, protocol=None):
    api_key = api_key or os.getenv("LLM_API_KEY")
    protocol = _llm_protocol(protocol)
    base_url = (base_url or os.getenv("LLM_BASE_URL", "")).rstrip("/")
    model = _llm_model(model)

    if not base_url:
        yield "还没有配置 LLM_BASE_URL。配置模型接口地址后即可调用模型。"
        return
    if not api_key:
        yield "还没有配置 LLM_API_KEY。我已根据当前论文上下文整理了任务入口，配置后即可调用模型接口。"
        return
    if not protocol:
        yield "还没有配置 LLM_PROTOCOL。"
        return
    if not model:
        yield "还没有配置 LLM_MODEL。"
        return
    if protocol != "openai":
        yield chat_completion(
            messages,
            model=model,
            temperature=temperature,
            base_url=base_url,
            api_key=api_key,
            protocol=protocol,
        )["content"]
        return

    response = requests.post(
        f"{base_url}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": model, "messages": messages, "temperature": temperature, "stream": True},
        timeout=120,
        stream=True,
    )
    _raise_for_llm_status(response)
    for raw_line in response.iter_lines(decode_unicode=False):
        if not raw_line:
            continue
        line = raw_line.decode("utf-8", errors="replace")
        if not line or not line.startswith("data:"):
            continue
        payload = line.removeprefix("data:").strip()
        if payload == "[DONE]":
            break
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            continue
        choices = data.get("choices") or []
        if not choices:
            continue
        delta = choices[0].get("delta") or {}
        content = delta.get("content")
        if content:
            yield content


def build_translation_messages(text, target_language="中文", context=None):
    context = context or {}
    paper_title = context.get("paper_title") or context.get("title") or ""
    paper_context = f"\n论文标题：{paper_title}" if paper_title else ""
    system = f"""你是 EasyRef 的论文划词翻译助手。
任务：把用户选中的论文片段翻译成{target_language}。
要求：
- 保持学术语气，忠实准确，不扩写原文没有的信息。
- 专有名词、方法名、数据集名、模型名和缩写保留英文；必要时在后面给出中文解释。
- 数学符号、公式、变量名、引用编号、表格编号保持原样。
- 如果片段不完整，直接翻译可理解部分，不要补全文意。
- 只输出译文；除非原文存在明显歧义，才在末尾用一句“注：...”说明。"""
    user = f"""请翻译下面的论文片段。{paper_context}

原文：
{text}
"""
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def translate_text_stream(text, target_language="中文", context=None, llm_settings=None):
    settings = llm_settings or {}
    clipped = str(text or "").strip()[:6000]
    if not clipped:
        yield "请选择或粘贴需要翻译的论文片段。"
        return
    yield from chat_completion_stream(
        build_translation_messages(clipped, target_language=target_language, context=context),
        model=settings.get("model"),
        base_url=settings.get("base_url"),
        api_key=settings.get("api_key"),
        protocol=settings.get("protocol"),
        temperature=0.1,
    )


def llm_metadata(model=None, protocol=None):
    protocol = _llm_protocol(protocol)
    model = _llm_model(model)
    return {"provider": _display_provider(protocol, model), "protocol": protocol, "model": model}


def list_available_models(base_url=None, api_key=None, protocol=None):
    protocol = _llm_protocol(protocol)
    base_url = (base_url or os.getenv("LLM_BASE_URL", "")).rstrip("/")
    api_key = api_key or os.getenv("LLM_API_KEY")
    default_model = _llm_model()
    if protocol != "openai":
        return {
            "protocol": protocol,
            "default_model": default_model,
            "models": [{"id": default_model, "name": default_model}],
            "error": "当前协议不支持自动拉取模型列表。",
        }
    if not base_url or not api_key:
        return {
            "protocol": protocol,
            "default_model": default_model,
            "models": [{"id": default_model, "name": default_model}],
            "error": "LLM_BASE_URL 或 LLM_API_KEY 未配置。",
        }
    if _is_packyapi_base(base_url):
        models = _packyapi_models(default_model)
        if not default_model:
            default_model = next(
                (item["id"] for item in models if item["id"].lower().startswith("deepseek")),
                models[0]["id"] if models else "",
            )
            if default_model:
                models = [item for item in models if item["id"] != default_model]
                models.insert(0, {"id": default_model, "name": default_model})
        return {"protocol": protocol, "default_model": default_model, "models": models, "source": "packyapi_perf_metrics"}
    response = requests.get(
        _models_endpoint(base_url),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        timeout=30,
    )
    _raise_for_llm_status(response)
    payload = response.json()
    models = []
    for item in payload.get("data") or []:
        model_id = item.get("id") if isinstance(item, dict) else str(item)
        if model_id:
            models.append({"id": model_id, "name": model_id})
    if not default_model:
        default_model = next(
            (item["id"] for item in models if item["id"].lower().startswith("deepseek")),
            models[0]["id"] if models else "",
        )
    models = [item for item in models if item["id"] != default_model]
    if default_model:
        models.insert(0, {"id": default_model, "name": default_model})
    return {"protocol": protocol, "default_model": default_model, "models": models}


def create_embeddings(inputs, base_url=None, api_key=None, model=None):
    if isinstance(inputs, str):
        inputs = [inputs]
    api_key = api_key or os.getenv("EMBEDDING_API_KEY") or os.getenv("LLM_API_KEY")
    base_url = (
        base_url
        or os.getenv("EMBEDDING_BASE_URL")
        or os.getenv("LLM_BASE_URL", "")
    )
    model = _embedding_model(model)
    if not api_key:
        raise LLMRequestError("Embedding API key is not configured.")
    if not base_url:
        raise LLMRequestError("Embedding base URL is not configured.")
    if not model:
        raise LLMRequestError("EMBEDDING_MODEL is not configured.")

    response = requests.post(
        _embedding_endpoint(base_url),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": model, "input": inputs},
        timeout=60,
    )
    _raise_for_llm_status(response)
    data = response.json()
    rows = sorted(data.get("data") or [], key=lambda item: item.get("index", 0))
    return {
        "provider": _display_provider("embedding", model),
        "model": model,
        "embeddings": [row.get("embedding") or [] for row in rows],
    }

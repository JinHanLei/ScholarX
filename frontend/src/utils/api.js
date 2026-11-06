const API = import.meta.env.VITE_API_URL || '/api';

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...options,
    body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
  });
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await response.json() : { error: await response.text() };
  if (!response.ok) {
    const fallback = response.status === 502
      ? '后端服务正在重启或暂时不可达，请稍后重试。'
      : response.status === 413
        ? '上传文件过大，请减小文件或调整上传限制。'
        : '请求失败';
    throw new Error(isJson ? (data.error || fallback) : fallback);
  }
  return data;
}

async function downloadApiFile(path, options = {}, fallbackName = 'scholarx-export.txt') {
  const response = await fetch(`${API}${path}`, {
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...options,
    body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    let message = '下载失败';
    try {
      const data = await response.json();
      message = data.error || message;
    } catch {
      // Keep fallback message.
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const filename = decodeURIComponent(disposition.match(/filename="?([^"]+)"?/)?.[1] || fallbackName);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function parseSseBlock(block) {
  const lines = block.split('\n');
  let event = 'message';
  const data = [];
  lines.forEach((line) => {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trim());
  });
  if (!data.length) return null;
  return { event, data: JSON.parse(data.join('\n')) };
}

async function streamApi(path, payload, onEvent, options = {}) {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : { error: await response.text() };
    throw new Error(data.error || '请求失败');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() || '';
    blocks.forEach((block) => {
      const parsed = parseSseBlock(block);
      if (parsed) onEvent(parsed.event, parsed.data);
    });
  }
}

export { API, api, downloadApiFile, parseSseBlock, streamApi };

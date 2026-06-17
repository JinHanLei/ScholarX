const DEFAULT_API_BASE = 'http://localhost:5000/api';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'easyref-save-page-pdf',
    title: '保存当前 PDF 到 EasyRef',
    contexts: ['page'],
  });
  chrome.contextMenus.create({
    id: 'easyref-save-link-pdf',
    title: '保存链接 PDF 到 EasyRef',
    contexts: ['link'],
    targetUrlPatterns: ['*://*/*.pdf*'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const sourceUrl = info.linkUrl || normalizePdfViewerUrl(tab?.url || '');
  try {
    const result = await uploadPdfFromUrl({ sourceUrl });
    notify('EasyRef', result.message || 'PDF 已提交到论文库');
  } catch (error) {
    notify('EasyRef 上传失败', error.message || String(error));
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function handleMessage(message) {
  if (message?.type === 'easyref-active-library') {
    const payload = sanitizeActiveLibrary(message.payload || {});
    await chrome.storage.local.set(payload);
    return payload;
  }
  if (message?.type === 'list-libraries') {
    return listLibraries(message.apiBase);
  }
  if (message?.type === 'upload-current-tab') {
    return uploadPdfFromUrl({
      sourceUrl: message.sourceUrl,
      libraryId: message.libraryId,
      apiBase: message.apiBase,
    });
  }
  if (message?.type === 'get-state') {
    return getState();
  }
  if (message?.type === 'save-settings') {
    const settings = {
      easyrefApiBase: normalizeApiBase(message.apiBase || DEFAULT_API_BASE),
      easyrefLibraryId: message.libraryId ? Number(message.libraryId) : null,
      easyrefLibraryName: message.libraryName || '',
    };
    await chrome.storage.local.set(settings);
    return settings;
  }
  throw new Error('Unsupported message');
}

async function getState() {
  const state = await chrome.storage.local.get([
    'easyrefApiBase',
    'easyrefOwner',
    'easyrefLibraryId',
    'easyrefLibraryName',
    'easyrefLastFrontendOrigin',
  ]);
  return {
    apiBase: normalizeApiBase(state.easyrefApiBase || DEFAULT_API_BASE),
    owner: state.easyrefOwner || '',
    libraryId: state.easyrefLibraryId || null,
    libraryName: state.easyrefLibraryName || '',
    frontendOrigin: state.easyrefLastFrontendOrigin || '',
  };
}

function sanitizeActiveLibrary(payload) {
  const apiBase = payload.apiBase ? normalizeApiBase(payload.apiBase) : undefined;
  const next = {
    easyrefOwner: payload.owner || '',
    easyrefLibraryId: payload.libraryId ? Number(payload.libraryId) : null,
    easyrefLibraryName: payload.libraryName || '',
    easyrefLastFrontendOrigin: payload.frontendOrigin || '',
  };
  if (apiBase) next.easyrefApiBase = apiBase;
  return next;
}

async function listLibraries(apiBaseInput) {
  const state = await getState();
  const apiBase = normalizeApiBase(apiBaseInput || state.apiBase);
  const owner = state.owner || '';
  const url = `${apiBase}/libraries${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`;
  const response = await fetch(url);
  const data = await parseJsonResponse(response, '读取论文库失败');
  return { libraries: data.libraries || [], apiBase, owner };
}

async function uploadPdfFromUrl({ sourceUrl, libraryId, apiBase }) {
  const state = await getState();
  const targetLibraryId = Number(libraryId || state.libraryId);
  if (!targetLibraryId) {
    throw new Error('请先在插件弹窗选择论文库，或在 EasyRef 中打开一个论文库。');
  }

  const targetApiBase = normalizeApiBase(apiBase || state.apiBase);
  const pdfUrl = normalizePdfViewerUrl(sourceUrl || '');
  if (!pdfUrl || !/^https?:\/\//i.test(pdfUrl)) {
    throw new Error('当前页面不是可直接读取的 HTTP/HTTPS PDF。');
  }

  const pdfResponse = await fetch(pdfUrl, {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!pdfResponse.ok) {
    throw new Error(`下载 PDF 失败：HTTP ${pdfResponse.status}`);
  }

  const contentType = pdfResponse.headers.get('content-type') || '';
  const blob = await pdfResponse.blob();
  if (!looksLikePdf(pdfUrl, contentType, blob)) {
    throw new Error('下载内容不像 PDF，请在 PDF 原文页面或 PDF 链接上重试。');
  }

  const filename = filenameFromResponse(pdfResponse, pdfUrl);
  const form = new FormData();
  form.append('files', blob, filename);

  const uploadResponse = await fetch(`${targetApiBase}/libraries/${targetLibraryId}/uploads/pdf?async=1`, {
    method: 'POST',
    body: form,
  });
  const upload = await parseJsonResponse(uploadResponse, '上传到 EasyRef 失败');
  const libraryName = state.libraryName || `#${targetLibraryId}`;
  return {
    upload,
    message: `已提交到 ${libraryName}`,
  };
}

function normalizeApiBase(value) {
  const trimmed = String(value || DEFAULT_API_BASE).trim().replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

function normalizePdfViewerUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const src = parsed.searchParams.get('src') || parsed.searchParams.get('file');
    if (src && /^https?:\/\//i.test(src)) return src;
  } catch {
    return url;
  }
  return url;
}

function looksLikePdf(url, contentType, blob) {
  return /application\/pdf/i.test(contentType)
    || /\.pdf(?:$|[?#])/i.test(url)
    || blob.type === 'application/pdf';
}

function filenameFromResponse(response, sourceUrl) {
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return safePdfName(decodeURIComponent(encoded));
  const plain = disposition.match(/filename="?([^"]+)"?/i)?.[1];
  if (plain) return safePdfName(plain);
  try {
    const pathname = new URL(sourceUrl).pathname;
    const name = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
    return safePdfName(name || 'paper.pdf');
  } catch {
    return 'paper.pdf';
  }
}

function safePdfName(value) {
  const base = String(value || 'paper.pdf').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'paper.pdf';
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

async function parseJsonResponse(response, fallback) {
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : { error: await response.text() };
  if (!response.ok) {
    throw new Error(data.error || `${fallback}：HTTP ${response.status}`);
  }
  return data;
}

function notify(title, message) {
  try {
    const maybePromise = chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.svg',
      title,
      message,
    });
    if (maybePromise?.catch) maybePromise.catch(() => {});
  } catch {
    // Notifications can be unavailable in some extension contexts.
  }
}

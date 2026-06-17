const apiBaseInput = document.getElementById('apiBase');
const librarySelect = document.getElementById('librarySelect');
const refreshButton = document.getElementById('refreshLibraries');
const saveButton = document.getElementById('savePdf');
const statusEl = document.getElementById('status');
const currentUrlEl = document.getElementById('currentUrl');

let activeTabUrl = '';
let libraries = [];

init();

async function init() {
  setBusy(true);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabUrl = normalizePdfViewerUrl(tab?.url || '');
    currentUrlEl.textContent = activeTabUrl || '无法读取当前页面地址';

    const state = await sendMessage({ type: 'get-state' });
    apiBaseInput.value = state.apiBase;
    await refreshLibraries(state.libraryId);
    setStatus(state.libraryName ? `当前论文库：${state.libraryName}` : '请选择论文库');
  } catch (error) {
    setStatus(error.message || String(error), 'error');
  } finally {
    setBusy(false);
  }
}

refreshButton.addEventListener('click', async () => {
  setBusy(true);
  try {
    await refreshLibraries(Number(librarySelect.value || 0));
    setStatus('论文库已刷新', 'success');
  } catch (error) {
    setStatus(error.message || String(error), 'error');
  } finally {
    setBusy(false);
  }
});

saveButton.addEventListener('click', async () => {
  const libraryId = Number(librarySelect.value || 0);
  const library = libraries.find((item) => Number(item.id) === libraryId);
  if (!libraryId) {
    setStatus('请先选择论文库', 'error');
    return;
  }
  setBusy(true);
  try {
    await sendMessage({
      type: 'save-settings',
      apiBase: apiBaseInput.value,
      libraryId,
      libraryName: library?.name || '',
    });
    await sendMessage({
      type: 'upload-current-tab',
      sourceUrl: activeTabUrl,
      apiBase: apiBaseInput.value,
      libraryId,
    });
    setStatus(`已提交到 ${library?.name || '论文库'}`, 'success');
  } catch (error) {
    setStatus(error.message || String(error), 'error');
  } finally {
    setBusy(false);
  }
});

apiBaseInput.addEventListener('change', async () => {
  try {
    await sendMessage({
      type: 'save-settings',
      apiBase: apiBaseInput.value,
      libraryId: Number(librarySelect.value || 0),
      libraryName: librarySelect.selectedOptions[0]?.textContent || '',
    });
    await refreshLibraries(Number(librarySelect.value || 0));
  } catch (error) {
    setStatus(error.message || String(error), 'error');
  }
});

async function refreshLibraries(preferredLibraryId) {
  const result = await sendMessage({ type: 'list-libraries', apiBase: apiBaseInput.value });
  libraries = result.libraries || [];
  librarySelect.replaceChildren();
  if (!libraries.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '没有可用论文库';
    librarySelect.append(option);
    return;
  }
  libraries.forEach((library) => {
    const option = document.createElement('option');
    option.value = library.id;
    option.textContent = `${library.name || `论文库 ${library.id}`} (${library.paper_count || 0})`;
    librarySelect.append(option);
  });
  const preferred = preferredLibraryId && libraries.some((library) => Number(library.id) === Number(preferredLibraryId))
    ? String(preferredLibraryId)
    : String(libraries[0].id);
  librarySelect.value = preferred;
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || '插件请求失败'));
        return;
      }
      resolve(response.result);
    });
  });
}

function normalizePdfViewerUrl(value) {
  const url = String(value || '').trim();
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('src') || parsed.searchParams.get('file') || url;
  } catch {
    return url;
  }
}

function setStatus(message, type = '') {
  statusEl.textContent = message || '';
  statusEl.className = type;
}

function setBusy(busy) {
  refreshButton.disabled = busy;
  saveButton.disabled = busy;
}

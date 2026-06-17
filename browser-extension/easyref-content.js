const STORAGE_KEY = 'easyref.activeLibrary';
let lastPayloadJson = '';

function inferApiBase() {
  const explicit = window.localStorage.getItem('easyref.apiBase');
  if (explicit) return explicit;
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return `${window.location.protocol}//${window.location.hostname}:5000/api`;
  }
  return `${window.location.origin}/api`;
}

function publishActiveLibrary() {
  let activeLibrary = null;
  try {
    activeLibrary = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    activeLibrary = null;
  }
  if (!activeLibrary?.id) return;

  const payload = {
    libraryId: activeLibrary.id,
    libraryName: activeLibrary.name || '',
    owner: window.localStorage.getItem('easyref.userEmail') || window.localStorage.getItem('easyref.localUser') || '',
    apiBase: inferApiBase(),
    frontendOrigin: window.location.origin,
  };
  const json = JSON.stringify(payload);
  if (json === lastPayloadJson) return;
  lastPayloadJson = json;
  chrome.runtime.sendMessage({ type: 'easyref-active-library', payload }).catch(() => {});
}

publishActiveLibrary();
window.addEventListener('storage', (event) => {
  if ([STORAGE_KEY, 'easyref.userEmail', 'easyref.localUser', 'easyref.apiBase'].includes(event.key)) {
    publishActiveLibrary();
  }
});
window.setInterval(publishActiveLibrary, 1500);

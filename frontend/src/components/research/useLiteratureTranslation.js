import { useEffect, useRef, useState } from 'react';
import { streamApi } from '../../utils/api.js';
import { request } from './shared.jsx';

export default function useLiteratureTranslation(paperId) {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [submittedText, setSubmittedText] = useState('');
  const [translation, setTranslation] = useState('');
  const [error, setError] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const pending = useRef(null);
  useEffect(() => {
    let live = true;
    const load = () => request('/settings/translation').then((r) => { if (live) { setSettings(r.settings); setSettingsError(''); } }).catch((e) => { if (live) setSettingsError(e.message); });
    load();
    window.addEventListener('easyref-translation-settings', load);
    return () => { live = false; window.removeEventListener('easyref-translation-settings', load); pending.current?.abort(); pending.current = null; };
  }, [paperId]);
  const start = async (text) => {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setSubmittedText(text); setTranslation(''); setError(''); setBusy(true);
    let finished = false;
    try {
      await streamApi(`/papers/${paperId}/translate`, { text }, (event, data) => {
        if (pending.current !== controller) return;
        if (event === 'delta') setTranslation((old) => old + data.text);
        if (event === 'done') finished = true;
        if (event === 'error') { finished = true; setError(data.error); }
      }, { signal: controller.signal });
      if (!finished && pending.current === controller) setError('翻译连接提前结束，请重试。');
    } catch (e) {
      if (pending.current === controller && e.name !== 'AbortError') setError(e.message);
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  };
  const stop = () => { pending.current?.abort(); pending.current = null; setBusy(false); setError('已停止，当前译文可能不完整。'); };
  return { settings, settingsError, busy, submittedText, translation, error, start, stop };
}

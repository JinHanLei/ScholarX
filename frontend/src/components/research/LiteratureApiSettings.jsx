import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, KeyRound, ShieldCheck, Play, LoaderCircle, Square } from 'lucide-react';
import ResearchModal from './ResearchModal.jsx';
import { Field, request } from './shared.jsx';
import { streamApi } from '../../utils/api.js';

export default function LiteratureApiSettings({ onClose }) {
  const [settings, setSettings] = useState(null);
  const [key, setKey] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const pendingTest = useRef(null);
  useEffect(() => {
    let live = true;
    request('/settings/translation').then((r) => { if (live) setSettings(r.settings); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; pendingTest.current?.abort(); pendingTest.current = null; };
  }, []);
  const change = (field, value) => { setSaved(false); setTestResult(null); setSettings((old) => ({ ...old, [field]: value })); };
  const payload = () => ({ base_url: settings.base_url, model: settings.model, ...(key.trim() ? { api_key: key.trim() } : {}) });
  const testConnection = async (event) => {
    if (!event.currentTarget.form.reportValidity()) return;
    const controller = new AbortController(); pendingTest.current = controller;
    const started = performance.now();
    let translation = '', firstMs = null, completed = false, failure = '';
    setTesting(true); setTestResult(null); setError('');
    try {
      await streamApi('/settings/translation/test', payload(), (kind, data) => {
        if (pendingTest.current !== controller) return;
        if (kind === 'delta' && data.text) {
          firstMs ??= performance.now() - started;
          translation += data.text;
        }
        if (kind === 'done') completed = true;
        if (kind === 'error') failure = data.error;
      }, { signal: controller.signal });
      if (!failure && (!completed || !translation.trim())) failure = '测试连接提前结束，未收到完整译文。';
    } catch (e) { failure = e.name === 'AbortError' ? '测试已停止。' : e.message; }
    finally {
      if (pendingTest.current === controller) {
        setTestResult({ ok: !failure, message: failure || '连接成功', translation, firstMs, totalMs: performance.now() - started });
        pendingTest.current = null; setTesting(false);
      }
    }
  };
  const save = async (event, remove = false) => {
    event.preventDefault(); setBusy(true); setError(''); setSaved(false);
    if (remove) setTestResult(null);
    try {
      const r = await request('/settings/translation', { method: 'PUT', body: { ...payload(), remove_key: remove } });
      setSettings(r.settings); setKey(''); setVisible(false); setSaved(true);
      window.dispatchEvent(new Event('easyref-translation-settings'));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const unavailable = busy || (!key.trim() && !settings?.has_key) || !settings?.model.trim() || !settings?.base_url.trim();
  return <ResearchModal title="OpenAI API" subtitle="用于 PDF 划词翻译" className="lit-api-settings" onClose={onClose}>
    {!settings && !error && <p className="rw-muted" role="status">正在读取配置…</p>}
    {settings && <form onSubmit={save}>
      <div className="lit-api-status"><KeyRound size={17} /><span>{settings.has_key ? '已保存 API Key' : '等待配置 API Key'}</span><small>流式翻译</small></div>
      <Field label="API Key" hint={settings.has_key ? '已保存的密钥不会回显；留空可继续使用，填入新值则替换。' : '保存到当前 EasyRef 本机实例，不随研究项目导出。'}>
        <div className="lit-api-secret"><input aria-label="API Key" autoComplete="off" spellCheck={false} disabled={busy || testing} type={visible ? 'text' : 'password'} value={key} onChange={(e) => { setKey(e.target.value); setSaved(false); setTestResult(null); }} placeholder={settings.has_key ? '已保存 · 输入以更换' : '粘贴你的 API Key'} /><button type="button" className="rw-icon" aria-label={visible ? '隐藏密钥' : '显示密钥'} title={visible ? '隐藏密钥' : '显示密钥'} onClick={() => setVisible((old) => !old)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
      </Field>
      <Field label="API 地址" hint="默认为 OpenAI 官方地址；自定义地址需支持 Responses API。"><input required disabled={busy || testing} type="url" value={settings.base_url} onChange={(e) => change('base_url', e.target.value)} placeholder="https://api.openai.com/v1" /></Field>
      <Field label="翻译模型"><input required disabled={busy || testing} value={settings.model} onChange={(e) => change('model', e.target.value)} placeholder="gpt-5.4-mini" spellCheck={false} /></Field>
      <p className="lit-api-hint"><ShieldCheck size={15} />测试使用当前填写的配置翻译一句示例，会产生少量 API 用量，不会自动保存。</p>
      {testing && <div className="lit-api-test-result" role="status"><LoaderCircle size={14} />正在测试，等待示例译文…</div>}
      {testResult && <div className={`lit-api-test-result ${testResult.ok ? 'is-success' : 'is-error'}`} role={testResult.ok ? 'status' : 'alert'}>
        <strong>{testResult.message}</strong>
        <small>{testResult.firstMs != null && `首字 ${(testResult.firstMs / 1000).toFixed(2)} 秒 · `}总耗时 {(testResult.totalMs / 1000).toFixed(2)} 秒</small>
        {testResult.translation && <p>{testResult.translation}</p>}
      </div>}
      {saved && <p className="rw-success" role="status">{settings.has_key ? '配置已保存。' : '已移除密钥，翻译已暂停。'}</p>}
      <footer className="lit-api-actions">
        {settings.has_key && <button type="button" className="lit-api-remove" disabled={busy || testing} onClick={(e) => save(e, true)}>移除密钥</button>}
        {testing ? <button type="button" onClick={() => pendingTest.current?.abort()}><Square size={13} />停止测试</button> : <button type="button" disabled={unavailable} onClick={testConnection}><Play size={13} />测试连接</button>}
        <button type="button" onClick={onClose}>关闭</button>
        <button className="rw-primary" type="submit" disabled={unavailable || testing}>{busy ? '正在保存…' : '保存配置'}</button>
      </footer>
    </form>}
    {error && <p className="rw-dialog-error" role="alert">{error}</p>}
  </ResearchModal>;
}

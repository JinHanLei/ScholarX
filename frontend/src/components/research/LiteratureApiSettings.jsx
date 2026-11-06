import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react';
import ResearchModal from './ResearchModal.jsx';
import { Field, request } from './shared.jsx';

export default function LiteratureApiSettings({ onClose }) {
  const [settings, setSettings] = useState(null);
  const [key, setKey] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let live = true;
    request('/settings/translation').then((r) => { if (live) setSettings(r.settings); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);
  const change = (field, value) => { setSaved(false); setSettings((old) => ({ ...old, [field]: value })); };
  const save = async (event, remove = false) => {
    event.preventDefault(); setBusy(true); setError(''); setSaved(false);
    try {
      const r = await request('/settings/translation', { method: 'PUT', body: {
        base_url: settings.base_url, model: settings.model, ...(key.trim() ? { api_key: key.trim() } : {}), remove_key: remove,
      } });
      setSettings(r.settings); setKey(''); setVisible(false); setSaved(true);
      window.dispatchEvent(new Event('easyref-translation-settings'));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <ResearchModal title="OpenAI API" subtitle="用于 PDF 划词翻译" className="lit-api-settings" onClose={onClose}>
    {!settings && !error && <p className="rw-muted" role="status">正在读取配置…</p>}
    {settings && <form onSubmit={save}>
      <div className="lit-api-status"><KeyRound size={17} /><span>{settings.has_key ? '已保存 API Key' : '等待配置 API Key'}</span><small>流式翻译</small></div>
      <Field label="API Key" hint={settings.has_key ? '已保存的密钥不会回显；留空可继续使用，填入新值则替换。' : '保存到当前 EasyRef 本机实例，不随研究项目导出。'}>
        <div className="lit-api-secret"><input aria-label="API Key" autoComplete="off" spellCheck={false} type={visible ? 'text' : 'password'} value={key} onChange={(e) => { setKey(e.target.value); setSaved(false); }} placeholder={settings.has_key ? '已保存 · 输入以更换' : '粘贴你的 API Key'} /><button type="button" className="rw-icon" aria-label={visible ? '隐藏密钥' : '显示密钥'} title={visible ? '隐藏密钥' : '显示密钥'} onClick={() => setVisible((old) => !old)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
      </Field>
      <Field label="API 地址" hint="默认为 OpenAI 官方地址；自定义地址需支持 Responses API。"><input required type="url" value={settings.base_url} onChange={(e) => change('base_url', e.target.value)} placeholder="https://api.openai.com/v1" /></Field>
      <Field label="翻译模型"><input required value={settings.model} onChange={(e) => change('model', e.target.value)} placeholder="gpt-5.4-mini" spellCheck={false} /></Field>
      <p className="lit-api-hint"><ShieldCheck size={15} />密钥仅用于你配置的 API 地址。点击翻译时，只发送选中文字。</p>
      {saved && <p className="rw-success" role="status">{settings.has_key ? '配置已保存，尚未发起连接测试。' : '已移除密钥，翻译已暂停。'}</p>}
      <footer className="lit-api-actions">
        {settings.has_key && <button type="button" className="lit-api-remove" disabled={busy} onClick={(e) => save(e, true)}>移除密钥</button>}
        <button type="button" onClick={onClose}>关闭</button>
        <button className="rw-primary" type="submit" disabled={busy || (!key.trim() && !settings.has_key) || !settings.model.trim() || !settings.base_url.trim()}>{busy ? '正在保存…' : '保存配置'}</button>
      </footer>
    </form>}
    {error && <p className="rw-dialog-error" role="alert">{error}</p>}
  </ResearchModal>;
}

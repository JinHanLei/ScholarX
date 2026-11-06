import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api.js';

export const request = (path, options = {}) => {
  if (['POST', 'PUT', 'PATCH'].includes(options.method) && /components|experiments|proposals/.test(path)) {
    const invalid = [...document.querySelectorAll('textarea[data-json-invalid="true"]')].find((field) => field.getClientRects().length);
    if (invalid) { invalid.focus(); return Promise.reject(new Error('JSON 字段尚未有效，请修正后保存；本次未写入任何修改。')); }
  }
  return api(path, options);
};
export const short = (id) => id?.slice(0, 8) || '—';
export const pretty = (value) => JSON.stringify(value, null, 2);
export const stamp = (value) => value ? new Date(value).toLocaleString() : '—';
export class ResearchErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <div className="rw-error-banner" role="alert"><div><strong>EasyRef 界面遇到错误</strong><p>{this.state.error.message}</p><button onClick={() => window.location.reload()}>重新载入已保存的数据</button></div></div>;
    return this.props.children;
  }
}
export function Badge({ children, tone = '' }) { return <span className={`rw-badge ${tone}`}>{children}</span>; }
export function Empty({ children }) { return <div className="rw-empty">{children}</div>; }
export function Field({ label, children, hint }) { return <label className="rw-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function JsonField({ label, value, onChange, rows = 5 }) {
  const [text, setText] = useState(pretty(value));
  const [error, setError] = useState('');
  useEffect(() => { setText(pretty(value)); setError(''); }, [JSON.stringify(value)]);
  return <Field label={label}><textarea rows={rows} className="rw-code" value={text} data-json-invalid={Boolean(error)} aria-invalid={Boolean(error)} onChange={(e) => { setText(e.target.value); try { const v = JSON.parse(e.target.value); if (v === null || typeof v !== 'object' || Array.isArray(v) !== Array.isArray(value)) throw new Error('type'); setError(''); onChange(v); } catch { setError('请提供有效的 JSON ' + (Array.isArray(value) ? '数组' : '对象') + '，保存前请修正'); } }} />{error && <small className="rw-error">{error}</small>}</Field>;
}
export function VersionHistory({ component, act, onRestore }) {
  const [history, setHistory] = useState([]); const [before, setBefore] = useState(''); const [diff, setDiff] = useState('');
  useEffect(() => { if (component?.id) act(async () => { const r = await request(`/components/${component.id}`); setHistory(r.revisions); setBefore(r.revisions[1]?.id || r.revisions[0]?.id || ''); }); }, [component?.revision_id]);
  if (!component) return null;
  return <details className="rw-details"><summary>修订历史 · {history.length} 个版本</summary><div className="rw-toolbar"><select aria-label="选择旧修订" value={before} onChange={(e) => setBefore(e.target.value)}>{history.map((v) => <option key={v.id} value={v.id}>{stamp(v.created_at)} · {short(v.id)} {v.purpose}</option>)}</select><button onClick={() => act(async () => setDiff((await request(`/components/${component.id}/diff?before=${before}&after=${component.revision_id}`)).diff))}>比较当前版本</button><button onClick={() => { if (window.confirm('将创建新的回退修订，当前版本仍保留。确认回退？')) act(async () => { const r = await request(`/components/${component.id}/restore`, { method: 'POST', body: { revision_id: before, confirmed: true } }); onRestore(r.component); }); }}>恢复为新修订</button></div>{diff && <pre className="rw-diff">{diff}</pre>}</details>;
}

import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import ResearchModal from '../ResearchModal.jsx';
import { request } from '../shared.jsx';

export default function ResultMapping({ projectId, run, onClose, onSaved }) {
  const [mapping, setMapping] = useState(() => structuredClone(run.mapping));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const update = (index, change) => setMapping((m) => ({ ...m, rows: m.rows.map((r, i) => i === index ? { ...r, ...change } : r) }));
  const metric = (row, index, change) => update(row, { metrics: mapping.rows[row].metrics.map((m, i) => i === index ? { ...m, ...change } : m) });
  const save = async () => {
    setBusy(true); setError('');
    try { await request(`/projects/${projectId}/experiments/${run.id}/report`, { method: 'POST', body: { id: crypto.randomUUID(), expected_revision: run.mapping_revision, mapping } }); await onSaved(); onClose(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <ResearchModal title="整理结果表" subtitle={run.name} onClose={onClose} wide className="experiment-mapping-dialog">
    <p className="experiment-muted">选择此运行中的指标，标注 Baseline / Ours。数值、数据集、参数和版本关联保持原始记录。</p>
    {mapping.rows.map((row, index) => <section className="experiment-mapping-row" key={index}>
      <div className="experiment-form-row"><label>方法名称<input aria-label={`方法名称 ${index + 1}`} value={row.method} onChange={(e) => update(index, { method: e.target.value })} /></label><label>类型<select aria-label={`方法类型 ${index + 1}`} value={row.role} onChange={(e) => update(index, { role: e.target.value })}><option value="baseline">Baseline</option><option value="ours">Ours</option><option value="unclassified">待归类</option></select></label><label>评估范围<input placeholder="例如 test / validation" value={row.scope} onChange={(e) => update(index, { scope: e.target.value })} /></label><button title="移除此方法" disabled={mapping.rows.length === 1} onClick={() => setMapping((m) => ({ ...m, rows: m.rows.filter((_, i) => i !== index) }))}><Trash2 size={14} /></button></div>
      {row.metrics.map((m, i) => <div className="experiment-metric-map" key={i}><select aria-label={`来源指标 ${index + 1}-${i + 1}`} value={m.source} onChange={(e) => metric(index, i, { source: e.target.value })}>{Object.keys(run.metrics).map((key) => <option key={key}>{key}</option>)}</select><input aria-label={`指标名称 ${index + 1}-${i + 1}`} value={m.label} onChange={(e) => metric(index, i, { label: e.target.value })} /><select aria-label="指标方向" value={m.direction} onChange={(e) => metric(index, i, { direction: e.target.value })}><option value="">不标方向</option><option value="higher">越高越好 ↑</option><option value="lower">越低越好 ↓</option></select><input aria-label="指标单位" placeholder="单位" value={m.unit} onChange={(e) => metric(index, i, { unit: e.target.value })} /><button title="移除此指标" onClick={() => update(index, { metrics: row.metrics.filter((_, j) => j !== i) })}><Trash2 size={13} /></button></div>)}
      <button onClick={() => { const key = Object.keys(run.metrics).find((k) => !row.metrics.some((m) => m.source === k)); if (key) update(index, { metrics: [...row.metrics, { source: key, label: key, direction: '', unit: '' }] }); }}><Plus size={13} />添加指标</button>
    </section>)}
    <button onClick={() => setMapping((m) => ({ ...m, rows: [...m.rows, { method: '', role: 'baseline', scope: '', metrics: [] }] }))}><Plus size={14} />添加对照方法</button>
    <label className="experiment-note-input">整理理由<textarea aria-label="整理理由" value={mapping.reason} onChange={(e) => setMapping({ ...mapping, reason: e.target.value })} placeholder="例如将同一运行中的 raw、weighted 结果整理为对照表" /></label>
    {error && <p role="alert" className="experiment-error">{error}</p>}<button className="experiment-primary" disabled={busy} onClick={save}>{busy ? '保存中…' : '保存结果表设置'}</button>
  </ResearchModal>;
}

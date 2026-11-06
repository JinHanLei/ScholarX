import React, { useEffect, useState } from 'react';
import { Play, Square, SlidersHorizontal, NotebookPen } from 'lucide-react';
import { request } from '../shared.jsx';
import { label, number, STATUS } from './resultTable.js';

export default function RunInspector({ projectId, run, versions, onMapping, onReload }) {
  const [detail, setDetail] = useState(null), [note, setNote] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true, timer;
    const load = async () => { try { const value = await request(`/experiments/${run.id}`); if (live) setDetail(value); } catch (e) { if (live) setError(e.message); } if (live && ['queued', 'running'].includes(run.status)) timer = setTimeout(load, 2000); };
    void load(); return () => { live = false; clearTimeout(timer); };
  }, [run.id, run.status]);
  const action = async (name) => { setBusy(true); setError(''); try { await request(`/experiments/${run.id}/${name}`, { method: 'POST', body: name === 'start' ? { authorized: true } : {} }); await onReload(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const addNote = async () => {
    setBusy(true); setError('');
    try { await request(`/projects/${projectId}/experiments/${run.id}/notes`, { method: 'POST', body: { id: crypto.randomUUID(), text: note } }); setNote(''); await onReload(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <section className="experiment-run-inspector" aria-label="运行详情">
    <header><div><span className="experiment-kicker">RUN DETAILS</span><h3>{run.name}</h3></div><button onClick={onMapping} disabled={!Object.keys(run.metrics).length}><SlidersHorizontal size={14} />整理结果表</button></header>
    <p className="experiment-purpose">{run.purpose || '尚未记录本轮修改目的。'}</p>
    <dl className="experiment-parameters">{[['版本', run.version_ids.map((id) => `V${versions.find((v) => v.id === id)?.number ?? '?'}`).join(' / ') || '历史 / 未绑定版本'], ['状态', STATUS[run.status] || run.status], ['Seed', run.config.seed], ['开始时间', run.started_at ? new Date(run.started_at).toLocaleString() : '未启动'], ...Object.entries(run.config.hyperparameters || {})].map(([key, value]) => <div key={key}><dt>{key}</dt><dd title={label(value)}>{label(value)}</dd></div>)}</dl>
    <details className="experiment-details"><summary>全部原始指标 · {Object.keys(run.metrics).length} 项</summary><div className="experiment-inline-results">{Object.entries(run.metrics).map(([key, value]) => <span key={key}><small>{key}</small><strong title={String(value)}>{number(value)}</strong></span>)}</div></details>
    {run.error && <p className="experiment-error">{run.error}</p>}
    <details className="experiment-details"><summary>运行命令与评估设置</summary><pre>{JSON.stringify({ command: run.command, cwd: run.cwd, config: run.config, git_commit: run.git_commit, finished_at: run.finished_at }, null, 2)}</pre>{run.status === 'registered' && !run.version_ids.length && <button className="experiment-primary" disabled={busy} onClick={() => action('start')}><Play size={13} />执行以上本地脚本</button>}{['queued', 'running'].includes(run.status) && <button disabled={busy} onClick={() => action('cancel')}><Square size={13} />停止运行</button>}</details>
    <details className="experiment-details"><summary>运行日志与产物</summary><pre>{detail?.log || '尚无运行输出'}</pre>{detail?.artifacts?.map((a) => <p key={a.id} className="experiment-artifact">{a.kind} · {a.path}<br /><small>{a.sha256}</small></p>)}</details>
    <div className="experiment-run-notes"><h4><NotebookPen size={15} />实验记录</h4><p className="experiment-muted">记录观察、参数选择和结论；保存时附上本次运行的参数与指标快照。</p>
      <textarea aria-label="新增实验记录" value={note} onChange={(e) => setNote(e.target.value)} placeholder="这次改变了什么，结果如何，下一步验证什么…" /><button className="experiment-primary" disabled={busy || !note.trim()} onClick={addNote}>{busy ? '保存中…' : '保存记录'}</button>
      {run.records.map((record) => <article key={record.id}><time>{new Date(record.created_at).toLocaleString()}</time><strong>{record.kind === 'mapping' ? '结果表整理' : record.source === 'idea' ? 'Idea 版本结论' : '实验观察'}</strong><p>{record.kind === 'mapping' ? record.data.reason : record.data.text}</p>{record.kind === 'note' && <details><summary>当时的参数与结果</summary><pre>{JSON.stringify({ status: record.data.status, config: record.data.config, metrics: record.data.metrics }, null, 2)}</pre></details>}</article>)}
    </div>{error && <p role="alert" className="experiment-error">{error}</p>}
  </section>;
}

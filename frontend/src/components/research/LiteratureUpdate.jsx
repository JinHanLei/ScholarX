import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import ResearchModal from './ResearchModal.jsx';
import { request, Field, Badge, short } from './shared.jsx';

export default function LiteratureUpdate({ onClose }) {
  const [update, setUpdate] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState('');
  const load = async () => { const [u, j] = await Promise.all([request('/dblp/update'), request('/imports')]); setUpdate(u.update); setJobs(j.jobs); };
  useEffect(() => { let live = true; const poll = async () => { try { const [u, j] = await Promise.all([request('/dblp/update'), request('/imports')]); if (live) { setUpdate(u.update); setJobs(j.jobs); } } catch (e) { if (live) setError(e.message); } }; poll(); const timer = setInterval(poll, 2000); return () => { live = false; clearInterval(timer); }; }, []);
  const run = async (fn) => { setBusy(true); setError(''); try { await fn(); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const active = ['downloading', 'importing'].includes(update?.status) || jobs.some((j) => ['running', 'pending'].includes(j.status));
  const labels = { idle: '尚未检查', downloading: '正在检查并下载快照', importing: '正在更新文献索引', completed: '更新完成', failed: '更新失败', paused: '导入已暂停', interrupted: '更新已中断' };
  return <ResearchModal title="更新 DBLP" subtitle="检查官方快照，更新本地文献索引。" onClose={onClose}>
    <div className="lit-update-callout"><RefreshCw size={27} /><div><h3>{labels[update?.status] || '检查 DBLP 更新'}</h3><p>{update?.message || '沿用已有的 MD5 检查与断点下载流程；快照未变化时跳过下载。'}</p></div></div>
    <button className="rw-primary" disabled={busy || active} onClick={() => run(() => request('/dblp/update', { method: 'POST', body: {} }))}><RefreshCw size={15} />{active ? '更新进行中' : '检查并更新 DBLP'}</button><p className="rw-muted">首次下载与索引可能需要较长时间，关闭弹窗后仍会在后台运行。</p>
    {(error || update?.error) && <p className="rw-dialog-error" role="alert">{error || update.error}</p>}
    {update?.job && <p className="lit-explanation">已扫描 {update.job.processed.toLocaleString()} · 收录 {update.job.imported.toLocaleString()} 条</p>}
    <details className="lit-update-details"><summary>使用本地快照 / 恢复导入</summary><Field label="DBLP XML 路径"><input value={path} onChange={(e) => setPath(e.target.value)} placeholder="本地 .xml 或 .xml.gz 的绝对路径" /></Field><button disabled={!path.trim() || busy || active} onClick={() => run(() => request('/imports', { method: 'POST', body: { source_path: path } }))}>导入本地快照</button>{jobs.slice(0, 8).map((job) => <div className="rw-import-job" key={job.id}><div><Badge>{job.status}</Badge><small>{short(job.id)} · 已扫描 {job.processed.toLocaleString()} · 收录 {job.imported.toLocaleString()}</small></div>{job.status !== 'completed' && <button disabled={busy || (active && job.status !== 'running')} onClick={() => run(() => request(`/imports/${job.id}/${job.status === 'running' ? 'pause' : 'resume'}`, { method: 'POST', body: {} }))}>{job.status === 'running' ? '暂停' : '恢复'}</button>}{job.errors?.length > 0 && <p className="rw-error">{job.errors.at(-1).error}</p>}</div>)}</details>
    <details className="lit-update-details"><summary onClick={() => request('/dblp/update/log').then((r) => setLog(r.log)).catch((e) => setError(e.message))}>更新日志</summary><pre className="rw-log">{log || '暂无更新日志'}</pre></details>
  </ResearchModal>;
}

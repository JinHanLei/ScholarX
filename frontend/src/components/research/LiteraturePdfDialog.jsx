import React, { useEffect, useRef, useState } from 'react';
import { Upload, Sparkles, Square } from 'lucide-react';
import ResearchModal from './ResearchModal.jsx';
import useLiteratureAssist from './useLiteratureAssist.js';
import { request } from './shared.jsx';

export default function LiteraturePdfDialog({ paper, project, onClose, onSaved, openSession }) {
  const fileInput = useRef(null);
  const saving = useRef('');
  const live = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const assist = useLiteratureAssist(project, 'pdf');
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const saved = () => { onSaved(); if (live.current) onClose(); };
  useEffect(() => {
    const sid = assist.task?.session_id;
    if (!assist.task?.output || saving.current === sid) return;
    saving.current = sid; setBusy(true); setError('');
    request(`/projects/${project.id}/literature/assist/${sid}/pdf`, { method: 'POST', body: {} })
      .then(saved).catch((e) => setError(e.message)).finally(() => setBusy(false));
  }, [assist.task?.output]);
  const upload = async (event) => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    setBusy(true); setError('');
    try { const body = new FormData(); body.append('file', file); await request(`/papers/${paper.id}/pdf`, { method: 'POST', body }); saved(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <ResearchModal title={paper.pdf_path ? '管理 PDF' : '添加 PDF'} subtitle={paper.title} className="lit-pdf-add-modal" onClose={onClose}>
    <input ref={fileInput} hidden type="file" accept=".pdf,application/pdf" aria-label="上传 PDF 文件" onChange={upload} />
    <div className="lit-pdf-choices"><button disabled={busy || assist.busy} onClick={() => fileInput.current.click()}><Upload size={21} />手动上传</button><button disabled={!project || busy || assist.busy} onClick={() => { setError(''); assist.start(paper.title, { paper_id: paper.id }); }}><Sparkles size={21} />Codex 自动抓取</button></div>
    {(assist.busy || busy) && <div className="lit-pdf-progress" role="status"><span>{busy ? '正在保存 PDF…' : 'Codex 正在查找公开全文…'}</span>{assist.busy && <button disabled={!assist.task?.session_id} onClick={assist.stop}><Square size={12} />停止</button>}</div>}
    {assist.task?.notice && <p className="rw-warning">{assist.task.notice}</p>}
    {(error || assist.error) && <p className="rw-dialog-error" role="alert">{error || assist.error}</p>}
    {assist.task?.status === 'waiting_approval' && <button onClick={() => openSession(assist.task.session_id)}>查看 Codex 请求</button>}
  </ResearchModal>;
}

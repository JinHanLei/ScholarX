import React, { useEffect, useRef, useState } from 'react';
import { Upload, Link, Languages, Download, Square, FileText } from 'lucide-react';
import { PdfJsViewer } from '../PdfViewer.jsx';
import ResearchModal from './ResearchModal.jsx';
import useLiteratureAssist from './useLiteratureAssist.js';
import { request, Badge, Field } from './shared.jsx';
import { downloadApiFile } from '../../utils/api.js';

export default function LiteratureReader({ paper, project, onClose, onChanged, openSession }) {
  const [hasPdf, setHasPdf] = useState(Boolean(paper.pdf_path));
  const [version, setVersion] = useState(0);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [quote, setQuote] = useState('');
  const [page, setPage] = useState(1);
  const [attachments, setAttachments] = useState(!paper.pdf_path);
  const [note, setNote] = useState('');
  const [annotations, setAnnotations] = useState([]);
  const reader = useRef(null);
  const assist = useLiteratureAssist(project, 'translate');
  useEffect(() => { request(`/papers/${paper.id}/annotations`).then((r) => setAnnotations(r.annotations.filter((a) => a.project_id === project?.id))).catch((e) => setError(e.message)); }, [paper.id]);
  const action = async (fn) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const attached = () => { setHasPdf(true); setVersion((v) => v + 1); setAttachments(false); onChanged(); };
  const capture = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !reader.current?.contains(selection.anchorNode) || !reader.current?.contains(selection.focusNode)) return;
    const text = selection.toString().trim();
    if (text) { setQuote(text.slice(0, 16000)); setPage(Number(selection.anchorNode?.parentElement?.closest('[data-pdf-page]')?.dataset.pdfPage || 1)); }
  };
  return <ResearchModal title={paper.title} subtitle={`${paper.year || '年份未知'} · ${paper.venue_name || '未注明期刊 / 会议'}`} wide className="lit-reader-modal" onClose={onClose}>
    <div className="lit-reader-toolbar"><div>{paper.rank && <Badge>CCF {paper.rank}</Badge>}<small>{paper.authors.join(', ')}</small></div><div className="rw-toolbar"><button onClick={() => setAttachments(!attachments)}><Upload size={14} />{hasPdf ? '管理 PDF' : '添加 PDF'}</button><button onClick={() => action(() => downloadApiFile(`/papers/${paper.id}/bibtex`, {}, 'reference.bib'))}><Download size={14} />BibTeX</button></div></div>
    {attachments && <section className="lit-attachments"><div><strong>保存到本地 PDF 文献库</strong><p>上传或粘贴 PDF 直链，文件统一保存并自动去重。</p></div><div className="rw-toolbar"><label className={`rw-file-button ${busy ? 'disabled' : ''}`}><Upload size={15} />上传 PDF<input type="file" accept=".pdf,application/pdf" disabled={busy} aria-label="上传 PDF" onChange={(e) => { const file = e.target.files[0]; e.target.value = ''; if (file) action(async () => { const body = new FormData(); body.append('file', file); await request(`/papers/${paper.id}/pdf`, { method: 'POST', body }); attached(); }); }} /></label><input type="url" aria-label="PDF 链接" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/paper.pdf" /><button disabled={!url.trim() || busy} onClick={() => action(async () => { await request(`/papers/${paper.id}/pdf-link`, { method: 'POST', body: { url } }); attached(); })}><Link size={14} />{busy ? '正在保存…' : '保存链接 PDF'}</button></div></section>}
    {error && <p className="rw-dialog-error" role="alert">{error}</p>}
    {hasPdf ? <div className="lit-reading-layout"><div className="lit-pdf-pane" ref={reader} onPointerUp={capture} onKeyUp={capture}><PdfJsViewer key={version} url={`/api/papers/${paper.id}/pdf?v=${version}`} title={paper.title} /></div><aside className="lit-translation"><h3><Languages size={17} />划词翻译</h3><p>选中 PDF 中的文字，用 Codex 翻译。</p><Field label="选中文本"><textarea rows={5} value={quote} onChange={(e) => setQuote(e.target.value)} placeholder="选中内容会显示在这里，也可以粘贴原文。" /></Field><div className="rw-toolbar"><button className="rw-primary" disabled={!project || !quote.trim() || assist.busy} onClick={() => assist.start(quote, { paper_id: paper.id })}><Languages size={14} />{assist.busy ? '正在翻译…' : 'Codex 翻译'}</button>{assist.busy && <button disabled={!assist.task?.session_id} onClick={assist.stop}><Square size={13} />停止</button>}</div>{assist.task?.notice && <p className="rw-warning" role="status">{assist.task.notice}</p>}{assist.error && <p className="rw-error" role="alert">{assist.error}</p>}{assist.task?.status === 'waiting_approval' && <button onClick={() => openSession(assist.task.session_id)}>查看 Codex 授权请求</button>}{assist.task?.output?.translation && <div className="lit-translation-output"><small>{assist.submittedText === quote ? '中文译文' : '上一条选文的译文'}</small><p>{assist.task.output.translation}</p></div>}<details className="lit-notes"><summary>摘录与笔记 · {annotations.length}</summary><Field label="笔记"><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field><button disabled={!project || !note.trim() || busy} onClick={() => action(async () => { const r = await request(`/papers/${paper.id}/annotations`, { method: 'POST', body: { project_id: project.id, page, quote, note } }); setAnnotations(r.annotations.filter((a) => a.project_id === project.id)); setNote(''); })}>保存摘录</button>{annotations.map((a) => <blockquote key={a.id}><small>第 {a.page} 页</small><p>{a.quote}</p><p>{a.note}</p></blockquote>)}</details></aside></div> : <div className="lit-pdf-empty"><FileText size={42} /><h3>为这篇论文添加 PDF</h3><p>保存到本地后，即可阅读、划词翻译和整理摘录。</p>{paper.doi && <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noreferrer">打开论文来源 ↗</a>}</div>}
  </ResearchModal>;
}

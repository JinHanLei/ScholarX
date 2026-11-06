import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Upload, Languages, Download, LoaderCircle, NotebookPen, X } from 'lucide-react';
import { PdfJsViewer } from '../PdfViewer.jsx';
import LiteraturePdfDialog from './LiteraturePdfDialog.jsx';
import useLiteratureTranslation from './useLiteratureTranslation.js';
import { request, Field } from './shared.jsx';
import { downloadApiFile } from '../../utils/api.js';

function SelectionPopup({ anchor, stage, text }) {
  const ref = useRef(null);
  const [position, setPosition] = useState(null);
  useLayoutEffect(() => {
    const popup = ref.current;
    if (!popup || !stage.current) return undefined;
    const place = () => {
      const { width, height } = popup.getBoundingClientRect();
      const area = stage.current.getBoundingClientRect();
      const left = Math.max(8, Math.min(anchor.left, area.width - width - 8));
      const preferredTop = anchor.bottom + 8 + height <= area.height - 8 ? anchor.bottom + 8 : anchor.top - height - 8;
      const top = Math.max(8, Math.min(preferredTop, area.height - height - 8));
      setPosition({ left, top });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(popup);
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [anchor, stage]);
  return <section ref={ref} className="lit-selection-popup" role="status" aria-label="译文" style={{ ...position, visibility: position ? 'visible' : 'hidden' }}>
    <p className="lit-translation-output">{text}</p>
  </section>;
}

export default function LiteratureReader({ paper, project, onClose, onChanged, openSession, onOpenApiSettings }) {
  const [hasPdf, setHasPdf] = useState(Boolean(paper.pdf_path));
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [quote, setQuote] = useState('');
  const [page, setPage] = useState(1);
  const [anchor, setAnchor] = useState(null);
  const [translationEnabled, setTranslationEnabled] = useState(false);
  const [attachments, setAttachments] = useState(!paper.pdf_path);
  const [notesOpen, setNotesOpen] = useState(false);
  const [note, setNote] = useState('');
  const [annotations, setAnnotations] = useState([]);
  const [toolbarContainer, setToolbarContainer] = useState(null);
  const reader = useRef(null);
  const stage = useRef(null);
  const backButton = useRef(null);
  const selecting = useRef(false);
  const lastSelection = useRef(null);
  const assist = useLiteratureTranslation(paper.id);

  useEffect(() => { backButton.current?.focus(); }, []);

  useEffect(() => {
    let live = true;
    request(`/papers/${paper.id}/annotations`).then((r) => {
      if (live) setAnnotations(r.annotations.filter((a) => a.project_id === project?.id));
    }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [paper.id, project?.id]);

  const capture = useCallback(() => {
    const selection = window.getSelection();
    if (selecting.current || !selection?.rangeCount || selection.isCollapsed || !stage.current) return;
    const inPdfText = (node) => reader.current?.contains(node) && (node?.nodeType === 1 ? node : node?.parentElement)?.closest('.pdf-js-text-layer');
    if (!inPdfText(selection.anchorNode) || !inPdfText(selection.focusNode)) return;
    const text = selection.toString().trim();
    if (!text) return;
    const range = selection.getRangeAt(0);
    const previous = lastSelection.current;
    if (previous && previous.startContainer === range.startContainer && previous.startOffset === range.startOffset &&
        previous.endContainer === range.endContainer && previous.endOffset === range.endOffset) return;
    const bounds = stage.current.getBoundingClientRect();
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.bottom > bounds.top && r.top < bounds.bottom && r.right > bounds.left && r.left < bounds.right);
    const rect = rects.at(-1);
    if (!rect) return;
    lastSelection.current = range.cloneRange();
    setQuote(text.slice(0, 16000));
    setPage(Number(selection.anchorNode?.parentElement?.closest('[data-pdf-page]')?.dataset.pdfPage || 1));
    setNotesOpen(false);
    if (translationEnabled) {
      setAnchor({ left: rect.left - bounds.left, top: rect.top - bounds.top, bottom: rect.bottom - bounds.top });
      assist.start(text.slice(0, 16000));
    }
  }, [translationEnabled, assist.start]);

  // Selection handles on touch devices can move after pointerup.
  useEffect(() => {
    let timer;
    const changed = () => { clearTimeout(timer); timer = setTimeout(capture, 160); };
    const released = () => { if (selecting.current) { selecting.current = false; capture(); } };
    document.addEventListener('selectionchange', changed);
    window.addEventListener('pointerup', released);
    window.addEventListener('pointercancel', released);
    return () => { clearTimeout(timer); document.removeEventListener('selectionchange', changed); window.removeEventListener('pointerup', released); window.removeEventListener('pointercancel', released); };
  }, [capture]);

  const dismissTranslation = useCallback(() => {
    setAnchor(null); lastSelection.current = null; assist.reset();
    const selection = window.getSelection();
    if (selection && reader.current?.contains(selection.anchorNode)) selection.removeAllRanges();
  }, [assist.reset]);

  useEffect(() => {
    if ((!anchor && !notesOpen) || attachments) return undefined;
    const escape = (event) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      event.preventDefault(); event.stopPropagation(); dismissTranslation(); setNotesOpen(false);
    };
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  }, [anchor, notesOpen, attachments, dismissTranslation]);

  const action = async (fn) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const attached = () => { setHasPdf(true); setVersion((v) => v + 1); setAttachments(false); dismissTranslation(); onChanged(); };
  const currentTranslation = assist.submittedText === quote;
  const readerError = error || (translationEnabled ? assist.error : '');
  const showNotes = () => { dismissTranslation(); setNotesOpen((value) => !value); };
  const toggleTranslation = () => {
    dismissTranslation(); setError('');
    if (!translationEnabled && !assist.settings?.has_key) {
      if (assist.settingsError) setError(assist.settingsError);
      onOpenApiSettings();
      return;
    }
    setTranslationEnabled((enabled) => !enabled);
  };
  const headerActions = <div className="lit-reader-actions">
    <div className="lit-reader-zoom" ref={setToolbarContainer} />
    <button type="button" className="lit-translation-toggle" aria-label="划词翻译" aria-pressed={translationEnabled} title={translationEnabled ? (assist.busy ? '正在翻译，点击关闭划词翻译' : '关闭划词翻译') : '开启划词翻译'} onClick={toggleTranslation}>
      {translationEnabled && assist.busy ? <LoaderCircle size={15} className="lit-translation-spinner" /> : <Languages size={15} />}<span>划词翻译</span>
    </button>
    <button type="button" className="rw-icon" title="摘录与笔记" aria-label="摘录与笔记" aria-expanded={notesOpen} onClick={showNotes}><NotebookPen size={16} /></button>
    <button type="button" className="rw-icon" title={hasPdf ? '管理 PDF' : '添加 PDF'} aria-label={hasPdf ? '管理 PDF' : '添加 PDF'} onClick={() => { dismissTranslation(); setAttachments(true); }}><Upload size={16} /></button>
    <button type="button" className="rw-icon" title="导出 BibTeX" aria-label="导出 BibTeX" disabled={busy} onClick={() => action(() => downloadApiFile(`/papers/${paper.id}/bibtex`, {}, 'reference.bib'))}><Download size={16} /></button>
  </div>;

  return <section className="lit-reader" aria-label="PDF 阅读器">
    <header className="lit-reader-header">
      <button ref={backButton} type="button" className="rw-icon" aria-label="返回文献列表" title="返回文献列表" onClick={onClose}><ArrowLeft size={18} /></button>
      <h2 title={paper.title}>{paper.title}</h2>
      {headerActions}
    </header>
    {attachments && <LiteraturePdfDialog paper={paper} project={project} onClose={() => setAttachments(false)} onSaved={attached} openSession={openSession} />}
    <div className="lit-reading-layout" ref={stage}>
      {readerError && <div className="lit-reader-error" role="alert">{readerError}<button type="button" className="rw-icon" aria-label="关闭错误提示" onClick={() => { setError(''); assist.reset(); }}><X size={14} /></button></div>}
      {hasPdf ? <div className="lit-pdf-pane" ref={reader} onPointerDown={() => { selecting.current = true; lastSelection.current = null; assist.reset(); setAnchor(null); setNotesOpen(false); }} onPointerUp={() => { selecting.current = false; capture(); }} onPointerCancel={() => { selecting.current = false; }} onKeyUp={capture}>
        <PdfJsViewer key={version} url={`/api/papers/${paper.id}/pdf?v=${version}`} title={paper.title} toolbarContainer={toolbarContainer} />
      </div> : <div className="lit-pdf-empty"><p>添加 PDF 后开始阅读。</p><button onClick={() => setAttachments(true)}><Upload size={15} />添加 PDF</button></div>}
      {translationEnabled && anchor && currentTranslation && assist.translation && <SelectionPopup anchor={anchor} stage={stage} text={assist.translation} />}
      {notesOpen && <section className="lit-reader-notes" role="dialog" aria-label="摘录与笔记">
        <header><strong>摘录与笔记 · {annotations.length}</strong><button type="button" className="rw-icon" aria-label="关闭笔记" onClick={() => setNotesOpen(false)}><X size={15} /></button></header>
        {quote && <blockquote className="lit-selection-quote"><small>第 {page} 页</small><p>{quote}</p></blockquote>}
        <Field label="笔记"><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="记录你的想法…" /></Field>
        <button disabled={!project || !note.trim() || busy} onClick={() => action(async () => {
          const r = await request(`/papers/${paper.id}/annotations`, { method: 'POST', body: { project_id: project.id, page, quote, note } });
          setAnnotations(r.annotations.filter((a) => a.project_id === project.id)); setNote('');
        })}>保存摘录</button>
        <div className="lit-reader-note-list">{annotations.map((a) => <blockquote key={a.id}><small>第 {a.page} 页</small><p>{a.quote}</p><p>{a.note}</p></blockquote>)}</div>
      </section>}
    </div>
  </section>;
}

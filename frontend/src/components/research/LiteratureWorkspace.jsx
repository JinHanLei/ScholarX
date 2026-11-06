import React, { useRef, useState } from 'react';
import { Search, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { request, Field } from './shared.jsx';
import ResearchModal from './ResearchModal.jsx';
import LiteratureCollection from './LiteratureCollection.jsx';
import LiteratureSearch from './LiteratureSearch.jsx';
import LiteratureReader from './LiteratureReader.jsx';
import LiteraturePdfDialog from './LiteraturePdfDialog.jsx';
import LiteratureUpdate from './LiteratureUpdate.jsx';
import './literature.css';

export default function LiteratureWorkspace({ project, select, epoch, onOpenApiSettings }) {
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null);
  const [readerOrigin, setReaderOrigin] = useState(null);
  const returnFocus = useRef(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [manual, setManual] = useState({ title: '', authors: '', year: '', venue_name: '', doi: '', url: '' });
  const changed = () => setRevision((v) => v + 1);
  const openPdf = (paper) => {
    if (paper.pdf_path) { returnFocus.current = document.activeElement; setReaderOrigin(modal); setModal(null); }
    setSelected(paper);
  };
  const closeReader = () => { setSelected(null); setModal(readerOrigin); requestAnimationFrame(() => returnFocus.current?.focus()); };
  const openSession = (id) => { setModal(null); setSelected(null); select({ kind: 'session', id }); };
  const addManual = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const item = await request('/papers', { method: 'POST', body: { ...manual, year: manual.year ? Number(manual.year) : null, authors: manual.authors.split(/[,，]/).map((a) => a.trim()).filter(Boolean) } });
      await request('/papers/' + item.id + '/library', { method: 'POST', body: { project_id: project.id } });
      setModal(null); setManual({ title: '', authors: '', year: '', venue_name: '', doi: '', url: '' }); changed();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <div className="lit-workspace">
    <div className="lit-list-view" hidden={Boolean(selected?.pdf_path)}>
    <div className="lit-topbar"><button className="lit-refresh" title="更新 DBLP" aria-label="更新 DBLP" onClick={() => setModal('update')}><RefreshCw size={18} /></button><form className="lit-global-search" onSubmit={(e) => { e.preventDefault(); if (query.trim()) setModal('keyword'); }}><input aria-label="文献检索关键词" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索论文、作者、关键词…" /><button className="rw-primary" type="submit" disabled={!query.trim()} aria-label="关键词检索"><Search size={15} />搜索</button><button type="button" className="lit-advanced-button" title="高级检索" aria-label="高级检索" onClick={() => setModal('advanced')}><SlidersHorizontal size={16} /><span>高级</span></button></form></div>
    <LiteratureCollection key={project?.id || 'empty'} project={project} epoch={epoch + ':' + revision} onPdf={openPdf} onArchive={() => setModal('archive')} onFind={() => setModal('advanced')} onManual={() => { setError(''); setModal('manual'); }} />
    </div>
    {modal === 'archive' && <ResearchModal title="已归档论文" subtitle="保留 PDF 与阅读记录，可随时恢复到自选。" wide className="lit-archive-modal" onClose={() => setModal(null)}><LiteratureCollection project={project} archived epoch={epoch + ':' + revision} onChanged={changed} onPdf={openPdf} /></ResearchModal>}
    {['keyword', 'advanced'].includes(modal) && <LiteratureSearch mode={modal} initialQuery={query} project={project} onClose={() => setModal(null)} onAdded={changed} />}
    {modal === 'update' && <LiteratureUpdate onClose={() => setModal(null)} />}
    {selected && (selected.pdf_path ? <LiteratureReader key={selected.id} paper={selected} project={project} onClose={closeReader} onChanged={changed} openSession={openSession} onOpenApiSettings={onOpenApiSettings} /> : <LiteraturePdfDialog key={selected.id} paper={selected} project={project} onClose={() => setSelected(null)} onSaved={changed} openSession={openSession} />)}
    {modal === 'manual' && <ResearchModal title="添加文献" onClose={() => setModal(null)}><form onSubmit={addManual}>{[['title', '标题'], ['authors', '作者（逗号分隔）'], ['year', '年份'], ['venue_name', '期刊 / 会议名称'], ['doi', 'DOI（可选）'], ['url', '文章 URL（可选）']].map(([key, label]) => <Field key={key} label={label}><input required={key === 'title'} type={key === 'year' ? 'number' : key === 'url' ? 'url' : 'text'} value={manual[key]} onChange={(e) => setManual({ ...manual, [key]: e.target.value })} /></Field>)}{error && <p className="rw-dialog-error" role="alert">{error}</p>}<button type="submit" className="rw-primary" disabled={!manual.title.trim() || busy}>加入自选</button></form></ResearchModal>}
  </div>;
}

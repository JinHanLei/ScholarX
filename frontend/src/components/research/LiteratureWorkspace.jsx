import React, { useEffect, useRef, useState } from 'react';
import { Search, RefreshCw, SlidersHorizontal, Sparkles, BookMarked, Archive, ArchiveRestore, Pin, FileText, Plus, ArrowUpDown } from 'lucide-react';
import { request, Badge, Field, Empty } from './shared.jsx';
import ResearchModal from './ResearchModal.jsx';
import LiteratureSearch from './LiteratureSearch.jsx';
import LiteratureReader from './LiteratureReader.jsx';
import LiteratureUpdate from './LiteratureUpdate.jsx';
import './literature.css';

export default function LiteratureWorkspace({ project, select, epoch }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('added');
  const [archived, setArchived] = useState(false);
  const [result, setResult] = useState({ papers: [], total: 0 });
  const [offset, setOffset] = useState(0);
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [manual, setManual] = useState({ title: '', authors: '', year: '', venue_name: '', doi: '' });
  const generation = useRef(0);
  const load = async (off = offset) => {
    if (!project) { setResult({ papers: [], total: 0 }); return; }
    const version = ++generation.current; setLoading(true);
    try { const value = await request('/papers?' + new URLSearchParams({ source: 'all', project_id: project.id, archived: archived ? '1' : '0', sort, offset: off, limit: 30 })); if (version === generation.current) { if (off && !value.papers.length) { setOffset(Math.max(0, off - 30)); return; } setResult(value); } }
    catch (e) { if (version === generation.current) setError(e.message); }
    finally { if (version === generation.current) setLoading(false); }
  };
  useEffect(() => { load(offset); return () => { generation.current++; }; }, [project?.id, sort, archived, offset, epoch]);
  const change = async (paper, values) => {
    setBusy(paper.id); setError('');
    try { await request(`/projects/${project.id}/library/${paper.id}`, { method: 'PATCH', body: values }); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const openSession = (id) => { setModal(null); setSelected(null); select({ kind: 'session', id }); };
  const addManual = async (e) => {
    e.preventDefault(); setBusy('manual'); setError('');
    try { const item = await request('/papers', { method: 'POST', body: { ...manual, year: manual.year ? Number(manual.year) : null, authors: manual.authors.split(/[,，]/).map((a) => a.trim()).filter(Boolean) } }); await request(`/papers/${item.id}/library`, { method: 'POST', body: { project_id: project.id } }); setModal(null); setManual({ title: '', authors: '', year: '', venue_name: '', doi: '' }); setNotice('文献已加入自选，可点击 PDF 添加全文。'); setArchived(false); setOffset(0); await load(0); }
    catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  return <div className="lit-workspace">
    <div className="lit-topbar"><button className="lit-refresh" title="更新 DBLP" aria-label="更新 DBLP" onClick={() => { setError(''); setModal('update'); }}><RefreshCw size={18} /></button><form className="lit-global-search" onSubmit={(e) => { e.preventDefault(); setModal('keyword'); }}><Search size={16} /><input aria-label="文献检索关键词" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索论文、作者、关键词…" /><button type="submit" disabled={!query.trim()} aria-label="关键词检索" title="关键词检索"><Search size={16} /></button><span className="lit-search-divider" /><button type="button" title="高级检索" aria-label="高级检索" onClick={() => setModal('advanced')}><SlidersHorizontal size={16} /><span>高级</span></button><button type="button" title="Codex 自然语言检索" aria-label="Codex 自然语言检索" onClick={() => setModal('natural')}><Sparkles size={16} /><span>Codex</span></button></form></div>
    <div className="lit-library-toolbar"><div className="lit-library-tabs"><button className={!archived ? 'active' : ''} onClick={() => { setArchived(false); setOffset(0); }}><BookMarked size={16} />自选文献{!archived && <span>{result.total}</span>}</button><button className={archived ? 'active' : ''} onClick={() => { setArchived(true); setOffset(0); }}><Archive size={15} />已归档{archived && <span>{result.total}</span>}</button></div><div className="lit-library-actions"><label><ArrowUpDown size={14} /><select aria-label="自选文献排序" value={sort} onChange={(e) => { setSort(e.target.value); setOffset(0); }}><option value="added">最近加入</option><option value="year">年份降序</option><option value="oldest">年份升序</option><option value="title">标题排序</option><option value="rank">等级排序</option></select></label><button title="手动添加文献" aria-label="手动添加文献" disabled={!project} onClick={() => { setError(''); setModal('manual'); }}><Plus size={16} /></button></div></div>
    {error && !modal && <p className="rw-dialog-error" role="alert">{error}</p>}{notice && <div className="lit-notice" role="status">{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}>×</button></div>}
    <div className="lit-paper-scroll" aria-busy={loading}><div className="lit-table-heading"><span>论文标题</span><span>年份</span><span>期刊 / 会议</span><span>等级</span><span>PDF</span><span>整理</span></div><div className="lit-paper-list">{result.papers.map((paper) => <article key={paper.id} className={`lit-paper-row ${paper.pinned ? 'is-pinned' : ''}`}>
      <div className="lit-paper-title"><button className="lit-title-link" onClick={() => setSelected(paper)}>{Boolean(paper.pinned) && <Pin size={13} className="lit-pin-mark" />}{paper.title}</button><p>{paper.authors.join(', ') || '作者未注明'}</p></div><span className="lit-year">{paper.year || '—'}</span><span className="lit-venue" title={paper.venue_name}>{paper.venue_name || '—'}</span><span className="lit-rank">{paper.rank ? <Badge tone={paper.rank === 'A' ? 'blue' : ''}>CCF {paper.rank}</Badge> : <span className="rw-muted">未评级</span>}</span><button className={`lit-pdf-button ${paper.pdf_path ? 'ready' : ''}`} title={paper.pdf_path ? '阅读 PDF' : '上传 PDF 或添加链接'} aria-label={`${paper.pdf_path ? '阅读 PDF' : '添加 PDF'}：${paper.title}`} onClick={() => setSelected(paper)}><FileText size={15} />{paper.pdf_path ? '阅读' : '添加'}</button><div className="lit-row-actions"><button aria-label={`${paper.pinned ? '取消置顶' : '置顶'}：${paper.title}`} title={paper.pinned ? '取消置顶' : '置顶'} aria-pressed={Boolean(paper.pinned)} disabled={Boolean(busy)} onClick={() => change(paper, { pinned: !paper.pinned })}><Pin size={15} /></button><button title={archived ? '恢复到自选' : '归档'} aria-label={`${archived ? '恢复到自选' : '归档'}：${paper.title}`} disabled={Boolean(busy)} onClick={() => change(paper, { archived: !archived })}>{archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}</button></div>
    </article>)}</div>{!result.papers.length && <Empty><BookMarked size={38} /><h3>{loading ? '正在加载文献…' : archived ? '还没有归档文献' : '把值得深入阅读的论文留在这里'}</h3><p>{archived ? '归档的论文会保留 PDF 和阅读记录，随时可以恢复。' : project ? '用右上角搜索找到论文，加入自选，逐步建立这篇论文的参考文献库。' : '先创建一个项目，再开始整理参考文献。'}</p>{!archived && <button className="rw-primary" onClick={() => setModal('advanced')}><Search size={15} />查找论文</button>}</Empty>}</div>
    <div className="lit-library-footer"><small>{loading ? '正在加载…' : `${result.total.toLocaleString()} 篇${archived ? '归档' : '自选'}文献`} · 置顶优先</small><div><button disabled={loading || !offset} onClick={() => setOffset(Math.max(0, offset - 30))}>上一页</button><span>{result.total ? offset + 1 : 0}–{Math.min(offset + 30, result.total)}</span><button disabled={loading || offset + 30 >= result.total} onClick={() => setOffset(offset + 30)}>下一页</button></div></div>
    {['keyword', 'advanced', 'natural'].includes(modal) && <LiteratureSearch mode={modal} initialQuery={query} project={project} onClose={() => setModal(null)} onAdded={() => { load(); }} openSession={openSession} />}
    {modal === 'update' && <LiteratureUpdate onClose={() => setModal(null)} />}
    {selected && <LiteratureReader key={selected.id} paper={selected} project={project} onClose={() => setSelected(null)} onChanged={() => load()} openSession={openSession} />}
    {modal === 'manual' && <ResearchModal title="添加文献" subtitle="保存基本信息后，可上传 PDF 或添加全文链接。" onClose={() => setModal(null)}><form onSubmit={addManual}>{[['title', '标题'], ['authors', '作者（逗号分隔）'], ['year', '年份'], ['venue_name', '期刊 / 会议名称'], ['doi', 'DOI（可选）']].map(([key, label]) => <Field key={key} label={label}><input required={key === 'title'} type={key === 'year' ? 'number' : 'text'} value={manual[key]} onChange={(e) => setManual({ ...manual, [key]: e.target.value })} /></Field>)}{error && <p className="rw-dialog-error" role="alert">{error}</p>}<button type="submit" className="rw-primary" disabled={!manual.title.trim() || Boolean(busy)}>加入自选</button></form></ResearchModal>}
  </div>;
}

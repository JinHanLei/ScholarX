import React, { useEffect, useRef, useState } from 'react';
import { Search, Plus, Check, Sparkles, Square } from 'lucide-react';
import ResearchModal from './ResearchModal.jsx';
import useLiteratureAssist from './useLiteratureAssist.js';
import { request, Field, Badge, Empty } from './shared.jsx';

const defaults = { source: 'all', rank: '', year_from: '', year_to: '', author: '', type: '', venue_id: '', sort: 'year' };
export default function LiteratureSearch({ mode, initialQuery = '', project, onClose, onAdded, openSession }) {
  const [query, setQuery] = useState(initialQuery);
  const [natural, setNatural] = useState(initialQuery);
  const [filters, setFilters] = useState(defaults);
  const [venues, setVenues] = useState([]);
  const [result, setResult] = useState(null);
  const [offset, setOffset] = useState(0);
  const [searched, setSearched] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState('');
  const [added, setAdded] = useState(new Set());
  const generation = useRef(0);
  const assist = useLiteratureAssist(project, 'search');
  const run = async (params, off = 0) => {
    const version = ++generation.current;
    setBusy(true); setError('');
    try { const response = await request('/papers?' + new URLSearchParams({ ...params, offset: off, limit: 30 })); if (version === generation.current) { setResult(response); setSearched(params); setOffset(off); } }
    catch (e) { if (version === generation.current) setError(e.message); }
    finally { if (version === generation.current) setBusy(false); }
  };
  useEffect(() => {
    if (mode === 'advanced') request('/venues').then((r) => setVenues(r.venues)).catch((e) => setError(e.message));
    if (mode === 'keyword' && initialQuery.trim()) run({ ...defaults, q: initialQuery });
    return () => { generation.current++; };
  }, []);
  useEffect(() => { if (assist.task?.output) { const output = assist.task.output; const params = { ...defaults, ...Object.fromEntries(Object.entries(output).filter(([key, value]) => !['explanation', 'venue'].includes(key) && value !== null)) }; setQuery(output.q); setFilters(params); run(params); } }, [assist.task?.output]);
  const add = async (paper) => {
    setAdding(paper.id); setError('');
    try { await request(`/papers/${paper.id}/library`, { method: 'POST', body: { project_id: project.id } }); setAdded((old) => new Set([...old, paper.id])); onAdded(); }
    catch (e) { setError(e.message); } finally { setAdding(''); }
  };
  const online = async () => { setBusy(true); setError(''); try { await request('/papers/online', { method: 'POST', body: { q: query } }); await run({ ...filters, q: query }); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const title = { keyword: '检索文献', advanced: '高级检索', natural: 'Codex 自然语言检索' }[mode];
  return <ResearchModal title={title} subtitle="找到相关论文，加入当前项目的自选文献。" wide onClose={onClose}>
    {mode === 'natural' ? <div className="lit-natural"><Field label="描述你想找的论文"><textarea rows={3} value={natural} onChange={(e) => setNatural(e.target.value)} placeholder="例如：2022 年以来，CCF A 类会议中关于图神经网络的论文" /></Field><div className="rw-toolbar"><button className="rw-primary" disabled={!project || !natural.trim() || assist.busy} onClick={() => assist.start(natural)}><Sparkles size={15} />{assist.busy ? 'Codex 正在理解…' : '开始检索'}</button>{assist.busy && <button onClick={assist.stop} disabled={!assist.task?.session_id}><Square size={13} />停止</button>}</div><small>由本地 Codex 解析条件，结果来自真实文献索引。</small></div> : <form className="lit-query" onSubmit={(e) => { e.preventDefault(); run({ ...filters, q: query }); }}><Search size={17} /><input autoFocus aria-label="检索关键词" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="标题、作者或主题关键词" /><button className="rw-primary" disabled={busy}>检索</button><button type="button" disabled={!query.trim() || busy} onClick={online}>DBLP 在线</button></form>}
    {mode === 'advanced' && <div className="lit-advanced rw-form-grid"><Field label="等级"><select value={filters.rank} onChange={(e) => setFilters({ ...filters, rank: e.target.value })}><option value="">全部等级</option>{['A', 'B', 'C'].map((rank) => <option key={rank}>{rank}</option>)}</select></Field><Field label="期刊 / 会议"><select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}><option value="">全部类型</option><option value="Journal">期刊</option><option value="Conference">会议</option></select></Field><Field label="起始年份"><input type="number" value={filters.year_from} onChange={(e) => setFilters({ ...filters, year_from: e.target.value })} /></Field><Field label="截止年份"><input type="number" value={filters.year_to} onChange={(e) => setFilters({ ...filters, year_to: e.target.value })} /></Field><Field label="作者"><input value={filters.author} onChange={(e) => setFilters({ ...filters, author: e.target.value })} /></Field><Field label="期刊 / 会议名称"><select value={filters.venue_id} onChange={(e) => setFilters({ ...filters, venue_id: e.target.value })}><option value="">全部期刊与会议</option>{venues.filter((v) => v.stream).map((v) => <option key={v.id} value={v.id}>{v.abbreviation} · {v.rank}</option>)}</select></Field></div>}
    {assist.task?.notice && <p className="rw-warning" role="status">{assist.task.notice}</p>}
    {assist.task?.output?.explanation && <p className="lit-explanation">{assist.task.output.explanation}</p>}
    {assist.task?.status === 'waiting_approval' && <p className="rw-warning">Codex 等待授权。<button onClick={() => openSession(assist.task.session_id)}>查看会话</button></p>}
    {(error || assist.error) && <p role="alert" className="rw-dialog-error">{error || assist.error}</p>}
    {busy && <p role="status" className="rw-muted">正在检索…</p>}
    {result && <><div className="lit-results-caption"><strong>{result.total.toLocaleString()} 篇结果</strong><small>添加后显示在自选文献中</small></div><div className="lit-results">{result.papers.map((paper) => <article key={paper.id}><div><h3>{paper.title}</h3><p>{paper.year || '年份未知'} · {paper.venue_name || '未注明期刊 / 会议'} {paper.rank && <Badge>CCF {paper.rank}</Badge>}</p><small>{paper.authors.join(', ')}</small></div><button aria-label={`加入自选：${paper.title}`} disabled={!project || added.has(paper.id) || Boolean(adding)} onClick={() => add(paper)}>{added.has(paper.id) ? <Check size={16} /> : <Plus size={16} />}{added.has(paper.id) ? '已加入' : '自选'}</button></article>)}{!result.papers.length && <Empty><Search size={28} /><h3>没有匹配的文献</h3><p>试试减少关键词或放宽年份、等级条件。</p></Empty>}</div><div className="rw-pagination rw-toolbar"><button disabled={busy || !offset} onClick={() => run(searched, Math.max(0, offset - 30))}>上一页</button><span>{result.total ? offset + 1 : 0}–{Math.min(offset + 30, result.total)} / {result.total}</span><button disabled={busy || offset + 30 >= result.total} onClick={() => run(searched, offset + 30)}>下一页</button></div></>}
    {!project && <p className="rw-muted">先创建一个项目，即可保存自选文献。</p>}
  </ResearchModal>;
}

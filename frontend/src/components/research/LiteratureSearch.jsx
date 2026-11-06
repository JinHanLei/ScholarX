import React, { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import ResearchModal from './ResearchModal.jsx';
import LiteratureSearchResults from './LiteratureSearchResults.jsx';
import { request, Field } from './shared.jsx';

const defaults = { rank: '', year_from: '', year_to: '', author: '', type: '', venue_id: '', sort: 'year' };
export default function LiteratureSearch({ mode, initialQuery = '', project, onClose, onAdded }) {
  const [query, setQuery] = useState(initialQuery);
  const [filters, setFilters] = useState(defaults);
  const [venues, setVenues] = useState([]);
  const [result, setResult] = useState(null);
  const [searched, setSearched] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const run = async (params, offset = 0) => {
    const version = ++generation.current;
    setBusy(true); setError('');
    try {
      const response = await request('/literature/search?' + new URLSearchParams({ ...params, offset, limit: 30 }));
      if (version === generation.current) { setResult(response); setSearched(params); }
    } catch (e) { if (version === generation.current) setError(e.message); }
    finally { if (version === generation.current) setBusy(false); }
  };
  const search = () => {
    const params = { ...filters, q: query.trim() };
    setResult(null); setRevision((value) => value + 1); run(params);
  };
  useEffect(() => {
    if (mode === 'advanced') request('/venues').then((r) => setVenues(r.venues)).catch((e) => setError(e.message));
    if (mode === 'keyword' && initialQuery.trim()) search();
    return () => { generation.current++; };
  }, []);
  return <ResearchModal title={mode === 'advanced' ? '高级检索' : '检索文献'} wide onClose={onClose}>
    <form className="lit-query" onSubmit={(e) => { e.preventDefault(); search(); }}>
      <input autoFocus aria-label="检索关键词" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="标题、作者或主题关键词" />
      <button className="rw-primary" disabled={busy}><Search size={15} />搜索</button>
    </form>
    {mode === 'advanced' && <>
      <div className="lit-advanced rw-form-grid">
        <Field label="等级"><select value={filters.rank} onChange={(e) => setFilters({ ...filters, rank: e.target.value })}><option value="">全部等级</option>{['A', 'B', 'C'].map((rank) => <option key={rank}>{rank}</option>)}</select></Field>
        <Field label="期刊 / 会议"><select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}><option value="">全部类型</option><option value="Conference">会议</option><option value="Journal">期刊</option></select></Field>
        <Field label="起始年份"><input type="number" value={filters.year_from} onChange={(e) => setFilters({ ...filters, year_from: e.target.value })} /></Field>
        <Field label="截止年份"><input type="number" value={filters.year_to} onChange={(e) => setFilters({ ...filters, year_to: e.target.value })} /></Field>
        <Field label="作者"><input value={filters.author} onChange={(e) => setFilters({ ...filters, author: e.target.value })} /></Field>
        <Field label="期刊 / 会议名称"><select value={filters.venue_id} onChange={(e) => setFilters({ ...filters, venue_id: e.target.value })}><option value="">全部期刊与会议</option>{venues.filter((v) => v.stream).map((v) => <option key={v.id} value={v.id}>{v.abbreviation} · {v.rank}</option>)}</select></Field>
      </div>
      <p className="lit-chat-hint">你也可以通过聊天来检索</p>
    </>}
    {busy && <div className="lit-search-progress" role="status">正在查询数据库…</div>}
    {error && <p role="alert" className="rw-dialog-error">{error}</p>}
    <LiteratureSearchResults key={revision} result={result} project={project} onAdded={onAdded} busy={busy} onPage={(offset) => run(searched, offset)} />
    {!project && <p className="rw-muted">先创建一个项目，即可保存自选文献。</p>}
  </ResearchModal>;
}

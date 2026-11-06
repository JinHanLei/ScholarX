import React, { useEffect, useRef, useState } from 'react';
import { Search, Globe, MessageSquare } from 'lucide-react';
import ResearchModal from './ResearchModal.jsx';
import useLiteratureAssist from './useLiteratureAssist.js';
import LiteratureSearchResults from './LiteratureSearchResults.jsx';
import { request, Field } from './shared.jsx';

const defaults = { rank: '', year_from: '', year_to: '', author: '', type: '', venue_id: '', sort: 'year' };
export default function LiteratureSearch({ mode, initialQuery = '', initialNetwork = false, onNetworkChange, project, onClose, onAdded, openSession, openChat }) {
  const [query, setQuery] = useState(initialQuery);
  const [network, setNetwork] = useState(initialNetwork);
  const [filters, setFilters] = useState(defaults);
  const [venues, setVenues] = useState([]);
  const [result, setResult] = useState(null);
  const [searched, setSearched] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const assist = useLiteratureAssist(project, 'search');
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
    setResult(null); setRevision((value) => value + 1); assist.reset(); run(params);
    if (network) assist.start('关键词：' + query.trim(), { network: true, filters });
  };
  useEffect(() => {
    if (mode === 'advanced') request('/venues').then((r) => setVenues(r.venues)).catch((e) => setError(e.message));
    if (mode === 'keyword' && initialQuery.trim()) search();
    return () => { generation.current++; };
  }, []);
  return <ResearchModal title={mode === 'advanced' ? '高级检索' : '检索文献'} wide onClose={onClose}>
    <form className="lit-query" onSubmit={(e) => { e.preventDefault(); search(); }}>
      <input autoFocus aria-label="检索关键词" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="标题、作者或主题关键词" />
      <button type="button" className="lit-network-toggle" aria-pressed={network} disabled={busy || assist.busy || !project} title={network ? '数据库 + 网络检索' : '仅检索数据库'} onClick={() => { setNetwork(!network); onNetworkChange?.(!network); assist.reset(); }}><Globe size={15} />网络检索</button>
      <button className="rw-primary" disabled={busy || assist.busy || (network && !project)}><Search size={15} />搜索</button>
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
      <button type="button" className="lit-chat-hint" disabled={!project} onClick={() => openChat(query)}><MessageSquare size={15} />你也可以通过聊天来检索</button>
    </>}
    {(busy || assist.busy) && <div className="lit-search-progress" role="status"><span>{assist.busy ? '正在查询数据库和网络…' : '正在查询数据库…'}</span>{assist.busy && <button type="button" onClick={assist.stop} disabled={!assist.task?.session_id}>停止联网</button>}</div>}
    {assist.task?.notice && <p className="rw-warning" role="status">{assist.task.notice}</p>}
    {assist.task?.status === 'waiting_approval' && <p className="rw-warning">网络检索等待授权。<button onClick={() => openSession(assist.task.session_id)}>查看会话</button></p>}
    {(error || assist.error) && <p role="alert" className="rw-dialog-error">{error || assist.error}</p>}
    <LiteratureSearchResults key={revision} result={result} webPapers={network ? assist.task?.output?.papers || [] : []} project={project} sessionId={assist.task?.session_id} onAdded={onAdded} busy={busy || assist.busy} onPage={(offset) => run(searched, offset)} />
    {!project && <p className="rw-muted">先创建一个项目，即可保存自选文献。</p>}
  </ResearchModal>;
}

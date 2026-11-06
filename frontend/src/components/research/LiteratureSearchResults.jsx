import React, { useState } from 'react';
import { Search, Plus, Check } from 'lucide-react';
import { request, Badge, Empty } from './shared.jsx';
import { articleUrl, samePaper } from './literatureHelpers.js';

export default function LiteratureSearchResults({ result, webPapers = [], project, sessionId, onAdded, busy, onPage }) {
  const [adding, setAdding] = useState('');
  const [added, setAdded] = useState(new Set());
  const [error, setError] = useState('');
  const local = result?.papers || [];
  const catalog = result?.catalog?.papers || [];
  const database = [...local, ...catalog.filter((p) => !local.some((q) => samePaper(p, q)))];
  const papers = [...database, ...webPapers.filter((p) => !database.some((q) => samePaper(p, q)))];
  const total = Math.max(result?.total || 0, result?.catalog?.total || 0);
  const offset = result?.offset || 0;
  const limit = result?.limit || 30;
  const add = async (paper) => {
    setAdding(paper.id); setError('');
    try {
      if (paper.from_catalog) await request(`/projects/${project.id}/literature/catalog/collect`, { method: 'POST', body: { catalog_id: paper.catalog_id } });
      else if (paper.from_web) await request(`/projects/${project.id}/literature/assist/${sessionId}/collect`, { method: 'POST', body: { candidate: paper.candidate } });
      else await request(`/papers/${paper.id}/library`, { method: 'POST', body: { project_id: project.id } });
      setAdded((old) => new Set([...old, paper.id])); onAdded();
    } catch (e) { setError(e.message); } finally { setAdding(''); }
  };
  if (!result && !webPapers.length) return null;
  return <>
    <div className="lit-results-caption"><strong>{result?.catalog ? `DBLP 数据库 ${result.catalog.total.toLocaleString()} 篇 · 本机 ${result.total.toLocaleString()} 篇` : `数据库 ${(result?.total || 0).toLocaleString()} 篇`}{webPapers.length > 0 && ` · 网络 ${webPapers.length} 篇`}</strong></div>
    {error && <p className="rw-dialog-error" role="alert">{error}</p>}
    <div className="lit-results">{papers.map((paper) => <article key={paper.id}>
      <div><h3>{articleUrl(paper) ? <a href={articleUrl(paper)} target="_blank" rel="noreferrer">{paper.title}</a> : paper.title}</h3>
        <p><span className="lit-source-badge">{paper.from_web ? '网络' : paper.from_catalog ? 'DBLP' : '本机'}</span>{paper.year || '年份未知'} · {paper.venue_name || '未注明期刊 / 会议'} {paper.rank && <Badge>CCF {paper.rank}</Badge>}</p>
        <small>{(paper.authors || []).join(', ')}</small></div>
      <button type="button" aria-label={`加入自选：${paper.title}`} disabled={!project || added.has(paper.id) || Boolean(adding)} onClick={() => add(paper)}>{added.has(paper.id) ? <Check size={16} /> : <Plus size={16} />}{added.has(paper.id) ? '已加入' : '自选'}</button>
    </article>)}{!papers.length && !busy && <Empty><Search size={28} /><h3>没有匹配的文献</h3><p>试试减少关键词或放宽筛选条件。</p></Empty>}</div>
    {onPage && total > limit && <div className="rw-pagination rw-toolbar"><button type="button" disabled={busy || !offset} onClick={() => onPage(Math.max(0, offset - limit))}>上一页</button><span>{offset + 1}–{Math.min(offset + limit, total)} / {total.toLocaleString()}</span><button type="button" disabled={busy || offset + limit >= total} onClick={() => onPage(offset + limit)}>下一页</button></div>}
  </>;
}

import React, { useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Pin, FileText, ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';
import { request, Badge, Empty } from './shared.jsx';
import { articleUrl, cycleSort } from './literatureHelpers.js';

export default function LiteratureCollection({ project, archived = false, epoch, onChanged, onPdf, onArchive, onFind, onManual }) {
  const [result, setResult] = useState({ papers: [], total: 0 });
  const [sorts, setSorts] = useState([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const load = async () => {
    const version = ++generation.current;
    if (!project) { setResult({ papers: [], total: 0 }); return; }
    setLoading(true); setError('');
    try {
      const value = await request('/papers?' + new URLSearchParams({ project_id: project.id, source: 'all', archived: archived ? '1' : '0', sort: 'added', sort_by: sorts.map((s) => s.field + ':' + s.direction).join(','), limit: 30, offset }));
      if (version !== generation.current) return;
      if (offset && !value.papers.length) { setOffset(Math.max(0, offset - 30)); return; }
      setResult(value);
    } catch (e) { if (version === generation.current) setError(e.message); }
    finally { if (version === generation.current) setLoading(false); }
  };
  useEffect(() => {
    load();
    const refresh = () => { if (document.visibilityState !== 'hidden') load(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      generation.current++;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [project?.id, archived, epoch, sorts, offset]);
  const change = async (paper, values) => {
    setBusy(true); setError('');
    try { await request(`/projects/${project.id}/library/${paper.id}`, { method: 'PATCH', body: values }); await load(); onChanged?.(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <div className="lit-collection">
    {error && <p className="rw-dialog-error" role="alert">{error}</p>}
    <div className="lit-paper-scroll" aria-busy={loading}>
      <table className="lit-table" aria-label={archived ? '已归档论文' : '自选论文'}>
        <colgroup><col className="lit-col-title" /><col className="lit-col-year" /><col className="lit-col-rank" /><col className="lit-col-pdf" /><col className="lit-col-archive" /></colgroup>
        <thead><tr>{[['title', '标题'], ['year', '年份'], ['rank', '等级'], ['pdf', 'PDF']].map(([field, label]) => {
          const index = sorts.findIndex((s) => s.field === field); const current = sorts[index];
          return <th key={field} scope="col" aria-sort={!current ? 'none' : sorts.length === 1 ? current.direction === 'asc' ? 'ascending' : 'descending' : 'other'}>
            <button aria-label={`${label}排序：${current ? current.direction === 'asc' ? '升序' : '降序' : '未排序'}${current ? '，优先级 ' + (index + 1) : ''}`} onClick={() => { setSorts((old) => cycleSort(old, field)); setOffset(0); }}>
              {label}{!current ? <ChevronsUpDown size={12} /> : current.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}{current && <sup>{index + 1}</sup>}
            </button>
          </th>;
        })}<th scope="col">{archived ? <span>恢复</span> : <button onClick={onArchive} aria-label="归档：查看已归档论文">归档<Archive size={13} /></button>}</th></tr></thead>
        <tbody>{result.papers.map((paper) => {
          const url = articleUrl(paper);
          return <tr key={paper.id} className={`lit-paper-row ${paper.pinned ? 'is-pinned' : ''}`}>
            <td><div className="lit-title-cell"><button className="lit-pin-button" aria-label={`${paper.pinned ? '取消置顶' : '置顶'}：${paper.title}`} aria-pressed={Boolean(paper.pinned)} title={paper.pinned ? '取消置顶' : '置顶'} disabled={busy} onClick={() => change(paper, { pinned: !paper.pinned })}><Pin size={13} /></button>{url ? <a className="lit-title-link" href={url} target="_blank" rel="noreferrer" title={paper.title}>{paper.title}</a> : <span className="lit-title-link" title={paper.title + '（未提供文章链接）'}>{paper.title}</span>}</div></td>
            <td>{paper.year || '—'}</td><td>{paper.rank ? <Badge>CCF {paper.rank}</Badge> : <span className="rw-muted">—</span>}</td>
            <td><button className={`lit-pdf-button ${paper.pdf_path ? 'ready' : ''}`} aria-label={`${paper.pdf_path ? '阅读 PDF' : '添加 PDF'}：${paper.title}`} onClick={() => onPdf(paper)}><FileText size={14} />{paper.pdf_path ? '阅读' : '添加'}</button></td>
            <td><button className="lit-archive-button" title={archived ? '恢复到自选' : '归档'} aria-label={`${archived ? '恢复到自选' : '归档'}：${paper.title}`} disabled={busy} onClick={() => change(paper, { archived: !archived })}>{archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}</button></td>
          </tr>;
        })}</tbody>
      </table>
      {!result.papers.length && <Empty><h3>{loading ? '正在加载…' : archived ? '还没有归档论文' : '还没有自选论文'}</h3><p>{archived ? '归档后仍保留 PDF 和阅读记录。' : project ? '检索论文并加入自选，建立当前项目的文献库。' : '先创建一个项目，再整理文献。'}</p>{onFind && <button onClick={onFind}>查找论文</button>}</Empty>}
    </div>
    <footer className="lit-library-footer"><small>{result.total} 篇{archived ? '归档' : '自选'} · {sorts.length ? '按表头编号复合排序' : '点击表头排序'}{result.papers.some((p) => p.pinned) ? ' · 置顶优先' : ''}</small><div>{onManual && <button disabled={!project} onClick={onManual}>手动添加</button>}<button disabled={loading || !offset} onClick={() => setOffset(Math.max(0, offset - 30))}>上一页</button><span>{result.total ? offset + 1 : 0}–{Math.min(offset + 30, result.total)}</span><button disabled={loading || offset + 30 >= result.total} onClick={() => setOffset(offset + 30)}>下一页</button></div></footer>
  </div>;
}

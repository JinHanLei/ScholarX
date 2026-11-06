import React, { useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, ChevronDown, History } from 'lucide-react';
import { request } from '../shared.jsx';
import { STAGES } from './ideaGraph.js';
import PaperFigure from './PaperFigure.jsx';
import ResearchModal from '../ResearchModal.jsx';

function Record({ record, onSnapshot }) {
  const data = record.data;
  return <article className="idea-research-record">
    <header><span>{data.kind === 'conclusion' ? '实验结论' : '确定的修改'}</span><time>{new Date(record.created_at).toLocaleString()}</time></header>
    <h3>{data.title}</h3>
    <dl>{[['change', '修改'], ['reason', '理由'], ['validation', '预期验证'], ['conclusion', '结论']].filter(([key]) => data[key]).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{data[key]}</dd></div>)}</dl>
    {data.experiments?.length > 0 && <p className="idea-record-evidence">引用运行：{data.experiments.map((run) => `${run.name}（${run.status}）`).join('、')}</p>}
    <button onClick={() => onSnapshot(record.id)}><History size={12} />查看当时的设计</button>
  </article>;
}

export default function ResearchJournal({ projectId, ideaId, versions, onVersion, onExperiment }) {
  const [records, setRecords] = useState([]), [error, setError] = useState(''), [all, setAll] = useState(false), [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    let live = true, timer;
    const load = async () => {
      try { const value = await request(`/projects/${projectId}/ideas/${ideaId}/records`); if (live) { setRecords(value.records); setError(''); } }
      catch (e) { if (live) setError(e.message); }
      if (live) timer = setTimeout(load, 2000);
    };
    load(); return () => { live = false; clearTimeout(timer); };
  }, [projectId, ideaId]);
  const openSnapshot = async (id) => {
    try { const value = await request(`/projects/${projectId}/ideas/${ideaId}/records/${id}`); setSnapshot(value.record); }
    catch (e) { setError(e.message); }
  };
  const pending = records.filter((record) => !record.version_id);
  return <section className="idea-journal" aria-label="研究记录">
    <header><div><BookOpen size={17} /><h2>研究记录</h2></div><small>决策 · 版本 · 实验 · 结论</small></header>
    {error && <p className="idea-error" role="alert">{error}</p>}
    {pending.length > 0 && <div className="idea-journal-draft"><div className="idea-journal-group-title"><span>当前讨论</span><small>{pending.length} 项修改 · 草稿记录</small></div>{pending.map((record) => <Record key={record.id} record={record} onSnapshot={openSnapshot} />)}</div>}
    {!records.length && <p className="idea-journal-hint">下一次在 Codex 中确定修改时，会记录修改内容、理由和预期验证；实验完成后在对应版本下查看结果与结论。</p>}
    {(all ? versions : versions.slice(0, 3)).map((version, index) => {
      const notes = records.filter((record) => record.version_id === version.id);
      const runs = version.runs || [];
      return <details key={version.id} className="idea-journal-version" open={index === 0 && Boolean(notes.length || runs.length)}>
        <summary><span className="idea-version-pill">V{version.number}</span><div><strong>{version.purpose}</strong><small>{new Date(version.created_at).toLocaleString()} · {notes.length} 条研究记录 · {runs.length} 次运行</small></div><span className={`idea-stage-tag ${version.stage}`}>{STAGES[version.stage]}</span><ChevronDown size={14} /></summary>
        <div className="idea-version-review"><div className="idea-journal-links"><button onClick={() => onVersion(version.id)}>查看此版模型图</button><button title={`查看 V${version.number} 对应实验`} onClick={() => onExperiment(version.id)}>对应实验<ArrowUpRight size={13} /></button></div>
          {notes.map((record) => <Record key={record.id} record={record} onSnapshot={openSnapshot} />)}
          {runs.map((run) => <article className="idea-journal-result" key={run.id}><header><strong>{run.name}</strong><span>{({ completed: '已完成', failed: '失败', running: '运行中', cancelled: '已停止' })[run.status] || run.status}</span></header><p>{run.config.dataset} · {run.config.split} · Seed {run.config.seed}</p><dl>{Object.entries(run.metrics || {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{Number(value.toPrecision(6))}</dd></div>)}</dl>{run.error && <p>{run.error}</p>}{!Object.keys(run.metrics || {}).length && <p>尚无真实指标。</p>}</article>)}
          {!runs.length && <p className="idea-journal-hint">{version.message}</p>}
          {!notes.some((record) => record.data.kind === 'conclusion') && runs.some((run) => run.status === 'completed') && <p className="idea-journal-hint">指标已记录，结论待讨论。下一次和 Codex 分析结果时补入。</p>}
        </div>
      </details>;
    })}
    {versions.length > 3 && <button className="idea-history-more" onClick={() => setAll(!all)}>{all ? '收起早期版本' : `查看全部 ${versions.length} 个版本`}</button>}
    {snapshot && <ResearchModal title={snapshot.data.title} subtitle="当时的设计快照" onClose={() => setSnapshot(null)} wide className="idea-record-dialog"><PaperFigure projectId={projectId} ideaId={ideaId} figure={snapshot.document.figure} stale={snapshot.figure_stale} historical /><pre className="idea-snapshot-description">{snapshot.document.description}</pre>{!snapshot.document.figure && <ul>{snapshot.document.graph.nodes.map((node) => <li key={node.id}>{node.label}：{node.description}</li>)}</ul>}</ResearchModal>}
  </section>;
}

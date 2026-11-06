import React, { useEffect, useState } from 'react';
import { FlaskConical, FileCode2, RotateCcw, Square, Check, ChevronRight } from 'lucide-react';
import { request } from '../shared.jsx';
import ModelCanvas from './ModelCanvas.jsx';
import { ACTIVE, STAGES } from './ideaGraph.js';
import './idea.css';

export default function IdeaExperimentPanel({ versions, selectedVersion, onIdea }) {
  const [chosen, setChosen] = useState(selectedVersion || ''), [runId, setRunId] = useState('');
  const [detail, setDetail] = useState(null), [error, setError] = useState(''), [showModel, setShowModel] = useState(false);
  useEffect(() => { if (selectedVersion) setChosen(selectedVersion); }, [selectedVersion]);
  const version = versions.find((v) => v.id === chosen) || versions[0];
  useEffect(() => { setRunId(''); setDetail(null); }, [version.id]);
  useEffect(() => {
    if (!runId) return;
    let live = true, timer;
    const load = async () => { try { const value = await request(`/experiments/${runId}`); if (live) setDetail(value); } catch (e) { if (live) setError(e.message); } if (live) timer = setTimeout(load, 1800); };
    load(); return () => { live = false; clearTimeout(timer); };
  }, [runId]);
  const action = async (name) => { try { await request(`/idea-versions/${version.id}/${name}`, { method: 'POST', body: {} }); setError(''); window.dispatchEvent(new Event('easyref:idea-saved')); } catch (e) { setError(e.message); } };
  return <div className="idea-experiments"><header className="idea-heading"><div><span className="idea-eyebrow">DESIGN → IMPLEMENTATION → EVIDENCE</span><h1>版本实验<span>Experiment</span></h1></div><button onClick={onIdea}>返回模型图<ChevronRight size={14} /></button></header>
    <div className="idea-experiment-select"><label>统一版本<select aria-label="选择实验版本" value={version.id} onChange={(e) => setChosen(e.target.value)}>{versions.map((item) => <option value={item.id} key={item.id}>V{item.number} · {item.document.name}</option>)}</select></label><span className={`idea-stage-tag ${version.stage}`}>{STAGES[version.stage]}</span></div>
    <section className="idea-experiment-state"><span className="idea-version-pill">V{version.number}</span><div><strong>{version.message}</strong><p>对应 Idea V{version.number} · {version.runs.length} 次运行 · {new Date(version.created_at).toLocaleString()}</p></div>{ACTIVE.includes(version.stage) ? <button onClick={() => action('cancel')}><Square size={13} />停止</button> : version.stage !== 'completed' && <button onClick={() => action('retry')}><RotateCcw size={13} />重试</button>}</section>
    {error && <p className="idea-error" role="alert">{error}</p>}
    <button className="idea-model-toggle" onClick={() => setShowModel(!showModel)}><FileCode2 size={14} />{showModel ? '收起' : '查看'}此版本的模型设计</button>
    {showModel && <ModelCanvas graph={version.document.graph} readOnly />}
    <section className="idea-history"><header><div><FlaskConical size={18} /><h2>实验运行</h2></div><small>每次运行固定设计、源码与配置</small></header>
      {!version.runs.length ? <p className="idea-placeholder">{ACTIVE.includes(version.stage) ? '流程正在自动推进，校验通过后实验会出现在这里。' : version.message}</p> : <div className="idea-runs">{version.runs.map((run) => <button className={`idea-run ${run.id === runId ? 'selected' : ''}`} key={run.id} onClick={() => setRunId(run.id)}><span className="idea-run-index">{run.position}</span><div><strong>{run.name}</strong><small>Seed {run.config.seed} · {run.config.dataset} · {run.config.split}</small></div><span>{run.status === 'completed' ? <Check size={15} /> : null}{({ registered: '已登记', queued: '排队中', running: '运行中', completed: '已完成', failed: '失败', cancelled: '已停止', interrupted: '已中断' })[run.status]}</span></button>)}</div>}
    </section>
    {detail && <section className="idea-run-detail"><header><h2>{detail.experiment.name}</h2><span>{detail.experiment.status}</span></header>{detail.experiment.error && <p className="idea-error">{detail.experiment.error}</p>}
      <div className="idea-metrics">{Object.entries(detail.experiment.metrics || {}).map(([key, value]) => <div key={key}><small>{key}</small><strong>{typeof value === 'number' ? Number(value.toPrecision(6)) : value}</strong></div>)}</div>
      <details><summary>执行配置与源码记录</summary><pre>{JSON.stringify({ command: detail.experiment.command, cwd: detail.experiment.cwd, config: detail.experiment.config, blueprint_revision: detail.experiment.blueprint_revision, artifacts: detail.artifacts }, null, 2)}</pre></details>
      <h3>运行日志</h3><pre className="idea-run-log">{detail.log || '尚无日志输出'}</pre>
    </section>}
    <section className="idea-history"><header><div><h2>流程记录</h2></div></header>{version.events.map((event) => <div className="idea-event" key={event.id}><time>{new Date(event.created_at).toLocaleTimeString()}</time><span>{STAGES[event.stage]} · {event.message}</span></div>)}</section>
  </div>;
}

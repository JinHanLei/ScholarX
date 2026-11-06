import React, { useState } from 'react';
import { Check, ChevronDown, ChevronUp, LoaderCircle, Square, RotateCcw } from 'lucide-react';
import { request } from '../shared.jsx';
import useIdeaVersions from './useIdeaVersions.js';
import { ACTIVE, STAGES } from './ideaGraph.js';
import './idea.css';
const steps = [['设计', ['queued', 'snapshotting']], ['实现', ['implementing', 'waiting_approval']], ['校验', ['validating']], ['实验', ['running']], ['结果', ['summarizing', 'completed']]];
export default function IdeaProgressBar({ project, onExperiment }) {
  const { versions, error } = useIdeaVersions(project?.id);
  const [expanded, setExpanded] = useState(false), [actionError, setActionError] = useState('');
  if (!versions.length) return error ? <div className="idea-progressbar" role="status">版本状态暂不可用：{error}</div> : null;
  const version = [...versions].reverse().find((v) => ACTIVE.includes(v.stage)) || versions[0];
  const current = steps.findIndex(([, states]) => states.includes(version.stage));
  const queued = versions.filter((v) => v.stage === 'queued' && v.id !== version.id).length;
  const action = async (name) => { try { await request(`/idea-versions/${version.id}/${name}`, { method: 'POST', body: {} }); setActionError(''); window.dispatchEvent(new Event('easyref:idea-saved')); } catch (e) { setActionError(e.message); } };
  return <section className={`idea-progressbar ${expanded ? 'expanded' : ''}`} aria-label="版本自动流程">
    {expanded && <div className="idea-progress-detail"><header><strong>V{version.number} · {version.document.name}</strong><button onClick={() => onExperiment(version.id)}>查看对应实验</button></header>
      <ol>{version.events.slice(-12).map((event) => <li key={event.id}><time>{new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><span>{STAGES[event.stage]} · {event.message}</span></li>)}</ol>
      {(actionError || error) && <p role="alert">{actionError || error}</p>}
      <div className="idea-progress-actions">{ACTIVE.includes(version.stage) ? <button onClick={() => action('cancel')}><Square size={12} />停止当前版本</button> : version.stage !== 'completed' && <button onClick={() => action('retry')}><RotateCcw size={13} />重试此版本</button>}</div>
    </div>}
    <button className="idea-progress-summary" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
      <span className="idea-progress-version">V{version.number}</span>
      {ACTIVE.includes(version.stage) ? <LoaderCircle className="idea-spin" size={15} /> : version.stage === 'completed' ? <Check size={16} /> : <span className="idea-status-dot" />}
      <span className="idea-progress-message" role="status"><strong>{STAGES[version.stage]}</strong><span>{error || version.message}</span></span>
      <span className="idea-progress-steps">{steps.map(([label], index) => <span key={label} className={index === current ? 'current' : current > index ? 'done' : ''}>{label}</span>)}</span>
      {queued > 0 && <small>另有 {queued} 个版本排队</small>}{expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
    </button>
  </section>;
}

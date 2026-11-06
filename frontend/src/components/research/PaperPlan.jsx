import React, { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { Field, request } from './shared.jsx';
import useLiteratureAssist from './useLiteratureAssist.js';

export default function PaperPlan({ project, onCreated }) {
  const [topic, setTopic] = useState(''), [venue, setVenue] = useState('');
  const [plan, setPlan] = useState(null), [filename, setFilename] = useState('main.tex');
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const planning = useLiteratureAssist(project, 'plan', 'paper');
  const drafting = useLiteratureAssist(project, 'draft', 'paper');
  const busy = planning.busy || drafting.busy || saving;
  useEffect(() => {
    let live = true;
    request(`/projects/${project.id}/research-brief`).then((r) => { if (live) { setTopic((old) => old || r.brief?.research_question || ''); setVenue((old) => old || r.brief?.target_venue || ''); } }).catch(() => {});
    return () => { live = false; };
  }, [project.id]);
  useEffect(() => { if (planning.task?.output) setPlan(planning.task.output); }, [planning.task?.output]);
  const edit = (s, p, value) => {
    drafting.reset();
    setPlan((old) => ({ ...old, sections: old.sections.map((section, i) => i !== s ? section : { ...section, paragraphs: section.paragraphs.map((paragraph, j) => j !== p ? paragraph : { ...paragraph, purpose: value }) }) }));
  };
  const save = async () => {
    setSaving(true); setError('');
    try { const doc = await request(`/projects/${project.id}/paper/assist/${drafting.task.session_id}/apply`, { method: 'POST', body: { filename } }); onCreated(doc); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  return <section className="rw-card paper-plan"><div className="paper-plan-heading"><BookOpen size={26} /><div><small>从计划到正文</small><h2>先想清楚，每一段写什么</h2></div></div>
    <p>检索目标期刊的相似工作 → 审阅大纲与逐段写作计划 → 开始写正文。</p>
    <div className="rw-form-grid"><Field label="研究主题 / 检索关键词"><textarea rows={3} value={topic} maxLength={2000} disabled={busy} onChange={(e) => setTopic(e.target.value)} placeholder="建议使用英文主题关键词，并说明你的研究问题" /></Field><Field label="目标期刊"><input value={venue} maxLength={300} disabled={busy} onChange={(e) => setVenue(e.target.value)} placeholder="期刊全称或已收录缩写，如 TKDE" /></Field></div>
    <button className="rw-primary" disabled={!topic.trim() || !venue.trim() || busy} onClick={() => { setPlan(null); drafting.reset(); setError(''); planning.start(topic, { topic, venue }); }}>{planning.busy ? '正在检索与规划…' : '查找相似工作并生成大纲'}</button>
    {planning.busy && planning.task?.session_id && <button onClick={planning.stop}>停止</button>}
    {planning.task?.notice && <p role="status">{planning.task.notice}</p>}
    {[planning, drafting].some((a) => a.task?.status === 'waiting_approval') && <p role="status">请在右侧 Codex Assistant 中查看 Paper 会话授权请求。</p>}
    {(planning.error || drafting.error || error) && <p className="rw-error" role="alert">{error || planning.error || drafting.error}</p>}
    {plan && <><div className="paper-plan-references"><h3>检索到的目标期刊相似工作</h3><p>根据元数据与可用摘要规划；未提供全文的文献不视为已阅读全文。</p>{planning.task.references.map((ref) => <div key={ref.id}><a href={/^https?:\/\//.test(ref.url) ? ref.url : undefined} target="_blank" rel="noreferrer">{ref.title}</a><small>{ref.venue} · {ref.year || '年份未知'} · {ref.source}</small></div>)}</div>
      <h3>{plan.title}</h3>{plan.sections.map((section, s) => <section className="paper-plan-section" key={s}><h4>{s + 1}. {section.title}</h4>{section.paragraphs.map((p, i) => <div className="paper-plan-paragraph" key={i}><Field label={`第 ${i + 1} 段 · 写作目的（可修改）`}><textarea rows={2} value={p.purpose} disabled={busy} onChange={(e) => edit(s, i, e.target.value)} /></Field><p><strong>主要论点：</strong>{p.main_claim}</p><p><strong>需要的证据：</strong>{p.evidence_needed}</p>{p.references.length > 0 && <small>参考：{p.references.join('；')}</small>}</div>)}</section>)}
      <button className="rw-primary" disabled={busy || plan.sections.some((s) => s.paragraphs.some((p) => !p.purpose.trim()))} onClick={() => drafting.start('按确认的计划写正文', { confirmed: true, plan_session_id: planning.task.session_id, plan })}>{drafting.busy ? '正在逐段起草…' : '确认逐段计划，开始写正文'}</button>{drafting.busy && drafting.task?.session_id && <button onClick={drafting.stop}>停止</button>}
    </>}
    {drafting.task?.output && <div className="paper-draft-preview"><h3>正文草稿预览</h3>{drafting.task.output.paragraphs.map((p, i) => <p key={i}>{p}</p>)}<Field label="保存为新 LaTeX 文件"><input value={filename} onChange={(e) => setFilename(e.target.value)} /></Field><button className="rw-primary" disabled={busy || !filename.trim()} onClick={save}>保存草稿与段落大纲</button></div>}
  </section>;
}

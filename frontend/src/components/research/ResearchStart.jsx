import React, { useEffect, useState } from 'react';
import { request, Field, Badge } from './shared.jsx';
const phases = [['problem', '研究问题与目标'], ['literature', '文献证据'], ['protocol', '实验协议'], ['experiments', '真实实验'], ['review', '审查与修订'], ['paper', '论文草稿']];
const labels = { pending: '待开始', running: '进行中', completed: '已有产物', blocked: '待解决' };

export default function ResearchStart({ project, act, select, refresh, epoch }) {
  const [brief, setBrief] = useState({ research_question: '', target_venue: '' });
  const [saved, setSaved] = useState(null); const [workflow, setWorkflow] = useState(null);
  const [starting, setStarting] = useState(false); const [workflowError, setWorkflowError] = useState('');
  useEffect(() => { act(async () => { const r = await request(`/projects/${project.id}/research-brief`); setBrief(r.brief); setSaved(r.brief); }); }, [project.id, epoch]);
  useEffect(() => {
    let live = true;
    const load = () => request(`/projects/${project.id}/workflow`).then((r) => { if (live) { setWorkflow(r.workflow); setWorkflowError(''); } }).catch((e) => { if (live) setWorkflowError(e.message); });
    load(); const timer = setInterval(load, 5000); return () => { live = false; clearInterval(timer); };
  }, [project.id, epoch]);
  const ready = Boolean(brief.research_question.trim() && brief.target_venue.trim());
  const dirty = !saved || ['research_question', 'target_venue'].some((k) => brief[k] !== saved[k]);
  const save = async () => { const r = await request(`/projects/${project.id}/research-brief`, { method: 'PUT', body: { research_question: brief.research_question, target_venue: brief.target_venue, expected_revision: saved?.component?.revision_id } }); setBrief(r.brief); setSaved(r.brief); refresh(); return r.brief; };
  const start = () => act(async () => {
    setStarting(true);
    try {
    const sessions = (await request(`/projects/${project.id}/sessions`)).sessions;
    const active = sessions.find((s) => s.role === 'Assistant' && ['running','starting','waiting_approval'].includes(s.status));
    if (active) { select({ kind: 'session', id: active.id, title: '正在执行的研究' }); return; }
    const current = dirty ? await save() : saved;
    const catalog = await request(`/projects/${project.id}/skills`);
    const skill = catalog.skills.find((s) => s.name === 'easyref-research' && s.available);
    if (!skill) throw new Error('EasyRef 内置 Skill 不可用，请检查安装');
    const r = await request(`/projects/${project.id}/sessions`, { method: 'POST', body: { stage: 'Idea' } });
    select({ kind: 'session', id: r.session.id, title: 'EasyRef 研究流程' });
    await request(`/sessions/${r.session.id}/turn`, { method: 'POST', body: {
      text: `使用 EasyRef 内置 Skill 推进当前研究。第一步引出问题并明确目标 ${current.target_venue}：${current.research_question}。检查 workflow.json 和已有产物后从未完成阶段继续；不要重复运行已完成实验。`,
      selected: [{ kind: 'idea', id: current.component.id }], skills: [skill.path],
    } });
    } finally { setStarting(false); }
  });
  return <section className="rw-card"><div className="rw-eyebrow">第一步 · RESEARCH START</div><h2>先明确问题，再确定目标期刊或会议</h2><p>文献比较、实验设计和论文写作都围绕这两个起点展开。后续只使用 EasyRef 内置 Skill。</p>
    <Field label="研究问题"><textarea rows={3} value={brief.research_question} onChange={(e) => setBrief({ ...brief, research_question: e.target.value })} placeholder="现有方法在什么场景下失效？你准备检验什么假设？" /></Field>
    <Field label="目标期刊或会议"><input value={brief.target_venue} onChange={(e) => setBrief({ ...brief, target_venue: e.target.value })} placeholder="例如：IEEE TKDE、AAAI、SIGMOD" /></Field>
    <div className="rw-toolbar"><button disabled={!ready || !dirty || starting} onClick={() => act(save)}>保存研究起点</button><button className="rw-primary" disabled={!ready || starting} onClick={start}>{starting ? '正在连接研究会话…' : '启动 / 继续 EasyRef 研究'}</button></div>
    {workflowError && <p className="rw-error">流程记录读取失败：{workflowError}</p>}
    {workflow?.stale && <p className="rw-warning">研究问题或投稿目标已改变，下面是旧流程记录，需要重新核对。</p>}
    <div className="rw-form-grid">{phases.map(([key, title]) => { const phase = workflow?.phases?.[key]; return <div key={key}><strong>{title}</strong> <Badge>{labels[phase?.status] || '待开始'}</Badge>{phase?.summary && <p>{phase.summary}</p>}{phase?.artifacts?.length > 0 && <small>{phase.artifacts.join(' · ')}</small>}</div>; })}</div>
  </section>;
}

import React, { useEffect, useRef, useState } from 'react';
import { MessageSquareReply, Play, Square, Download, Save, ShieldCheck } from 'lucide-react';
import { request, Field, Badge, stamp } from './shared.jsx';
import ReviewPreparation from './ReviewPreparation.jsx';
import './review.css';

const phases = { parsing: '正在拆解审稿意见', processing: '正在处理修改、核查证据并撰写回复', done: '回复草稿已生成', failed: '处理失败', interrupted: '处理已中断' };
const statuses = { pending: '待处理', drafted: '草稿待核对', blocked: '需要补充材料或处理' };

function responseDocument(review, edits) {
  return ['# Response to reviewers', review.scope.summary,
    ...(review.scope.responses || []).map((r, i) => `## ${r.reviewer} · Comment ${i + 1}\n\n${r.original}\n\n### Response\n\n${edits[r.id] ?? r.response}\n\n### Processing record\n\nStatus: ${statuses[r.status]}\n\nEvidence: ${r.evidence}\n\nChanges: ${r.changes}\n\nValidation: ${r.validation}${r.blocker ? `\n\nPending: ${r.blocker}` : ''}`),
  ].join('\n\n');
}

export default function ReviewWorkspace({ project, act, select, epoch, setStage }) {
  const [source, setSource] = useState('');
  const [instructions, setInstructions] = useState('');
  const [language, setLanguage] = useState('English');
  const [seconds, setSeconds] = useState(1800);
  const [reviews, setReviews] = useState([]);
  const [review, setReview] = useState(null);
  const [edits, setEdits] = useState({});
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [showSubmission, setShowSubmission] = useState(false);
  const [intakeOpen, setIntakeOpen] = useState(true);
  const selectedId = useRef(null);
  const busy = review?.status === 'running';
  const responses = review?.scope.responses || [];
  const dirty = Object.keys(edits).length > 0;
  const hasRunning = reviews.some((r) => r.status === 'running');

  const choose = (next) => { selectedId.current = next?.id; setReview(next); setEdits({}); setNotice(''); if (next) setIntakeOpen(false); };
  useEffect(() => {
    let live = true;
    act(async () => {
      const data = await request(`/projects/${project.id}/reviews`);
      if (!live) return;
      setReviews(data.reviews);
      if (!selectedId.current) {
        const latest = data.reviews.find((r) => r.scope?.mode === 'rebuttal');
        if (latest) choose(latest);
      }
    });
    return () => { live = false; };
  }, [project.id, epoch]);

  useEffect(() => {
    if (!busy && !hasRunning) return;
    let live = true; let pending = false;
    const timer = setInterval(async () => {
      if (pending) return;
      pending = true;
      await act(async () => {
        const data = await request(`/projects/${project.id}/reviews`);
        if (!live) return;
        setReviews(data.reviews);
        const next = data.reviews.find((r) => r.id === review?.id);
        if (next && busy) setReview(next);
      });
      pending = false;
    }, 1500);
    return () => { live = false; clearInterval(timer); };
  }, [review?.id, busy, hasRunning, project.id]);

  const start = () => act(async () => {
    setStarting(true); setNotice('');
    try {
      const data = await request(`/projects/${project.id}/reviews`, { method: 'POST', body: { mode: 'rebuttal', source, instructions, language, max_seconds: seconds } });
      choose(data.review);
      setReviews((items) => [data.review, ...items]);
    } finally { setStarting(false); }
  });
  const save = () => act(async () => {
    setSaving(true);
    try {
      const data = await request(`/reviews/${review.id}/responses`, { method: 'PATCH', body: { revision: review.scope.revision, responses: Object.entries(edits).map(([id, response]) => ({ id, response })) } });
      choose(data.review); setNotice('回复草稿已保存');
    } finally { setSaving(false); }
  });
  const download = () => {
    const url = URL.createObjectURL(new Blob([responseDocument(review, edits)], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `review-response-${review.id.slice(0, 8)}.md`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <div className="rw-stack review-workspace">
    <details className="rw-card review-intake" open={intakeOpen} onToggle={(e) => setIntakeOpen(e.currentTarget.open)}>
      <summary><MessageSquareReply size={21} />{review ? '粘贴新一轮审稿意见' : '粘贴审稿意见，开始准备回复'}</summary>
      <p className="rw-muted">粘贴编辑和审稿人的完整意见。Codex 会按审稿人逐条拆解，读取论文与实验，执行可行的修改和验证，自动填充处理记录与回复草稿。</p>
      <Field label="审稿意见原文" hint="保留 Reviewer 1 / Reviewer 2 等标题即可，无需手动整理成表格。">
        <textarea rows={10} maxLength={100000} value={source} onChange={(e) => setSource(e.target.value)} placeholder={'Reviewer 1\n1. Please clarify…\n2. An additional experiment is needed…\n\nReviewer 2\n…'} />
      </Field>
      <div className="rw-form-grid">
        <Field label="回复语言"><select value={language} onChange={(e) => setLanguage(e.target.value)}><option>English</option><option>中文</option></select></Field>
        <Field label="自动处理时间预算（秒）"><input type="number" min="30" max="3600" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} /></Field>
      </div>
      <Field label="补充要求（可选）"><textarea rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="例如：回复不超过 1000 词；重点解释表 3；补充实验使用项目内已有数据。" /></Field>
      <div className="rw-toolbar"><button className="rw-primary" disabled={!source.trim() || starting || busy || hasRunning || dirty || seconds < 30 || seconds > 3600} onClick={start}><Play size={16} />{starting ? '正在启动…' : '自动处理并生成回复'}</button><span className="rw-muted">缺少数据或证据的事项会标为待处理，回复可继续编辑。</span></div>
    </details>

    <section className="rw-card">
      <div className="rw-card-heading"><h2>逐条回复</h2><div className="rw-toolbar">
        <select aria-label="审稿回复历史" disabled={dirty || saving} value={review?.id || ''} onChange={(e) => { const id = e.target.value; act(async () => choose((await request(`/reviews/${id}`)).review)); }}>
          <option value="" disabled>选择一轮审稿意见</option>{reviews.filter((r) => r.scope?.mode === 'rebuttal').map((r) => <option key={r.id} value={r.id}>{stamp(r.created_at)} · {r.status}</option>)}
        </select>
        {responses.length > 0 && <><button disabled={busy || !dirty || saving} onClick={save}><Save size={15} />保存回复</button><button disabled={busy} onClick={download}><Download size={15} />导出回复</button></>}
      </div></div>
      {!review && <p className="rw-muted review-empty">审稿意见会在这里整理为「原文 → 处理记录 → 回复草稿」。粘贴意见后即可开始。</p>}
      {review && <>
        <div className="rw-toolbar" role="status"><Badge tone={busy ? 'warning' : ''}>{review.status === 'interrupted' ? phases.interrupted : phases[review.scope.phase] || review.status}</Badge><span>{responses.length} 条意见 · {responses.filter((r) => r.status === 'blocked').length} 条待处理</span>
          {busy && <button onClick={() => act(async () => { await request(`/reviews/${review.id}/stop`, { method: 'POST', body: {} }); setNotice('已请求停止，已执行的修改与会话记录会保留'); })}><Square size={14} />停止处理</button>}
        </div>
        {review.scope.error && <p className="rw-error" role="alert">{review.scope.error}</p>}
        {['failed', 'interrupted'].includes(review.status) && <button disabled={dirty} onClick={() => { setSource(review.scope.source); setInstructions(review.scope.instructions); setLanguage(review.scope.language); setIntakeOpen(true); setNotice('原文已载入上方，可重新启动处理；已有修改会保留，请结合会话记录核对。'); }}>载入原文重新处理</button>}
        {review.scope.summary && <p className="review-summary">{review.scope.summary}</p>}
        <details className="review-record"><summary>本轮审稿意见原文</summary><p className="review-summary">{review.scope.source}</p></details>
        <div className="rw-toolbar">{(review.sessions || []).map((id, i) => <button key={id} onClick={() => select({ kind: 'session', id, title: i === 0 ? '拆解审稿意见' : '自动处理与回复' })}>{i === 0 ? '查看意见拆解会话' : '查看处理会话 / 处理授权'}</button>)}</div>
        {dirty && <p className="rw-muted">有未保存的回复。保存后可以切换历史或开始新一轮。</p>}
      </>}
      {notice && <p className="rw-success" role="status">{notice}</p>}
    </section>

    {responses.map((r, index) => <article className="rw-card review-response" key={`${review.id}-${r.id}`}>
      <div className="rw-card-heading"><h3>{r.reviewer} · 意见 {index + 1}</h3><Badge tone={r.status === 'blocked' ? 'warning' : ''}>{statuses[r.status]}</Badge></div>
      <blockquote>{r.original}</blockquote>
      <div className="review-analysis"><div><strong>意见要点</strong><p>{r.request}</p></div><div><strong>处理方案</strong><p>{r.action}</p></div></div>
      {r.blocker && <p className="rw-warning">待处理：{r.blocker}</p>}
      <Field label={`${r.reviewer} · 意见 ${index + 1} 回复草稿`}><textarea rows={7} disabled={busy || saving} value={edits[r.id] ?? r.response} onChange={(e) => { const value = e.target.value; setNotice(''); setEdits((current) => { const next = { ...current }; if (value === r.response) delete next[r.id]; else next[r.id] = value; return next; }); }} placeholder={busy ? 'Codex 处理完成后会自动填充回复…' : '填写或修改给审稿人的回复'} /></Field>
      <details className="review-record" open={r.status === 'blocked'}><summary>证据、修改与验证记录</summary><dl><dt>依据</dt><dd>{r.evidence || '等待核查'}</dd><dt>实际修改</dt><dd>{r.changes || '尚无修改记录'}</dd><dt>验证结果</dt><dd>{r.validation || '尚无验证记录'}</dd></dl></details>
    </article>)}

    <div className="review-secondary"><ShieldCheck size={18} /><span>投稿前的多角色评议与问题排查在独立的对抗审查环节中进行。</span><button onClick={() => setStage('Polish')}>进入对抗审查</button></div>
    <details className="rw-card" onToggle={(e) => setShowSubmission(e.currentTarget.open)}><summary>投稿记录与修订快照</summary>{showSubmission && <ReviewPreparation project={project} act={act} select={select} epoch={epoch} setStage={setStage} mode="submission" />}</details>
  </div>;
}

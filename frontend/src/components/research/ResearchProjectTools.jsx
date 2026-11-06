import React, { useEffect, useState } from 'react';
import { request, Field } from './shared.jsx';
import ResearchModal from './ResearchModal.jsx';
import { downloadApiFile } from '../../utils/api.js';

const objectNames = { ResearchProject: '项目', Paper: '论文', PaperParagraph: '论文段落', LiteratureReference: '文献', Evidence: '研究证据', ResearchQuestion: '研究问题', Hypothesis: '研究假设', Task: '任务', Idea: '研究构想', ExperimentRun: '实验', ModelBlueprint: '模型设计', ModelModule: '模型模块', ReviewIssue: '审稿意见', Decision: '研究决策', AgentSession: '助手会话', SkillRun: 'Skill 记录', SubmissionAttempt: '投稿记录' };
const missingNames = { 'Research objective': '研究目标', 'Executed commands and result provenance': '已运行的命令与结果来源', 'Environment and data availability': '运行环境与数据准备情况' };

function ImportPreview({ preview }) {
  return <section className="rw-import-preview">
    <h3>{preview.format === 'standard' ? '已识别 EasyRef 项目' : '已识别项目文件夹'}</h3>
    <p>共 {preview.objects.length} 项内容，导入后将创建独立工作副本。</p>
    <ul>{preview.objects.map((item) => <li key={item.id}><span>{objectNames[item.type] || item.type}</span><strong>{item.title || item.file}</strong></li>)}</ul>
    {preview.missing_information?.length > 0 && <div><h4>导入后待补充</h4><ul>{preview.missing_information.map((item) => <li key={item}>{missingNames[item] || item}</li>)}</ul></div>}
    {(preview.excluded?.length > 0 || preview.report?.missing_dependencies?.length > 0) && <p className="rw-warning">有 {preview.excluded?.length || preview.report?.missing_dependencies?.length} 项资源未包含在项目中，请查看详细报告。</p>}
    <details><summary>查看详细报告</summary><pre className="rw-git-status">{JSON.stringify({ objects: preview.objects, missing_information: preview.missing_information, excluded: preview.excluded, report: preview.report }, null, 2)}</pre></details>
  </section>;
}

export default function ResearchProjectTools({ project, stage, onImported, select, onClose, initialMode }) {
  const [tab, setTab] = useState(initialMode);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (fn) => { setBusy(true); setError(''); try { return await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const [source, setSource] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [plan, setPlan] = useState(null);
  const [objects, setObjects] = useState([]);
  const [mode, setMode] = useState('portable');
  const [history, setHistory] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [approvalResponse, setApprovalResponse] = useState('{"decision":"decline"}');
  useEffect(() => {
    if (!['running', 'waiting_approval'].includes(analysis?.status)) return;
    const timer = setInterval(() => request('/research/import/analysis/' + analysis.id).then(setAnalysis).catch((e) => setAnalysis({ status: 'failed', error: e.message })), 1500);
    return () => clearInterval(timer);
  }, [analysis?.id, analysis?.status]);
  useEffect(() => { setPreview(null); setResult(null); setPlan(null); setObjects([]); }, [project?.id]);
  const base = project ? `/projects/${project.id}/research` : '';
  const run = (path) => act(async () => { setPlan(null); setResult(await request(base + path)); });
  return <ResearchModal title="项目导入与导出" subtitle="沿用 EasyRef 项目规范，保留研究对象、文件与恢复信息。" onClose={onClose}>
    <div className="lit-library-tabs"><button className={tab === 'import' ? 'active' : ''} onClick={() => setTab('import')}>导入项目</button><button disabled={!project} className={tab === 'export' ? 'active' : ''} onClick={() => setTab('export')}>导出项目</button></div>
    {error && <p role="alert" className="rw-dialog-error">{error}</p>}
    <fieldset className="rw-transfer-fields" disabled={busy}>
    {tab === 'import' && <>

      <Field label="项目文件夹或 ZIP 路径"><input value={source} onChange={(e) => { setSource(e.target.value); setPreview(null); }} placeholder="先只读分析，确认后创建独立副本" /></Field>
      <button disabled={!source.trim()} onClick={() => act(async () => { setPreview(await request('/research/import/preview', { method: 'POST', body: { path: source } })); })}>预览导入</button>
      {analysis?.status === 'waiting_approval' && <div className="rw-warning"><p>本地 Codex 请求授权。请核对具体请求；导入分析只需要读取副本中的文件。</p>{analysis.approvals?.map((approval) => <div key={approval.request_id}><pre>{JSON.stringify(approval, null, 2)}</pre><Field label="审批响应 JSON"><textarea value={approvalResponse} onChange={(e) => setApprovalResponse(e.target.value)} /></Field><button onClick={() => act(() => request('/research/import/analysis/' + analysis.id + '/approve', { method: 'POST', body: { request_id: approval.request_id, response: JSON.parse(approvalResponse) } }))}>提交本次审批响应</button></div>)}</div>}
      {preview && <div><ImportPreview preview={preview} /><div className="rw-import-actions">{preview.format === 'unstructured' && <button disabled={['running', 'waiting_approval'].includes(analysis?.status)} onClick={() => act(async () => setAnalysis(await request('/research/import/analyze', { method: 'POST', body: { preview_id: preview.preview_id, approved: true } })))}>Codex 辅助分析（可选）</button>}<button className="rw-primary" disabled={['running', 'waiting_approval'].includes(analysis?.status)} onClick={() => act(async () => { const r = await request('/research/import', { method: 'POST', body: { path: source, preview_id: preview.preview_id, fingerprint: preview.fingerprint, confirmed: true } }); setPreview(null); setAnalysis(null); await onImported(r.project); setResult(r.report); })}>确认并建立工作副本</button></div>{analysis && <details><summary>Codex 分析状态：{analysis.status}</summary><pre className="rw-git-status">{JSON.stringify(analysis, null, 2)}</pre></details>}</div>}
      </>}
      {tab === 'export' && project && <>

        <div className="rw-toolbar"><select aria-label="导出模式" value={mode} onChange={(e) => { setMode(e.target.value); setHistory(false); }}><option value="metadata">仅元数据</option><option value="portable">便携项目（含 PDF 与文件）</option><option value="reproducible">可复现归档</option></select>{mode === 'reproducible' && <label><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />包含经秘密扫描的 Git 历史</label>}<button onClick={() => act(() => downloadApiFile(base + '/export', { method: 'POST', body: { mode, git_history: history } }, 'EasyRef-project.zip'))}>导出项目 ZIP</button></div>
        <p>导出包包含项目说明、研究记录和所选范围的文件。未包含的资源会列在随包报告中。</p>
        <details className="lit-update-details"><summary>恢复与诊断</summary>
        <div className="rw-toolbar"><button onClick={() => run('/validate')}>检查项目完整性</button><button onClick={() => run('/status')}>恢复报告</button><button onClick={() => run('/timeline')}>研究时间线</button><button onClick={() => act(async () => { const r = await request(base + '/resume-plan'); setPlan(r); setResult(r.plan); })}>继续研究</button></div>
        <button onClick={() => act(async () => setObjects((await request(base + '/objects?workspace=' + stage)).objects))}>查看 {stage} 结构化对象</button>
        {objects.map((o) => <details key={o.id}><summary>{o.type} · {o.title} · {o.validation_status}</summary><pre className="rw-git-status">{JSON.stringify(o, null, 2)}</pre><button onClick={() => act(async () => setResult(await request(base + '/context?id=' + encodeURIComponent(o.id))))}>读取关联研究上下文</button></details>)}
        {plan && <button className="rw-primary" disabled={!plan.plan.can_start} onClick={() => act(async () => { const r = await request(base + '/resume', { method: 'POST', body: { approved: true, plan_hash: plan.plan_hash } }); select({ kind: 'session', id: r.session.id }); setPlan(null); })}>批准恢复计划并启动本地 Codex</button>}
        </details>
      </>}
      {result && <pre className="rw-git-status" aria-label="项目协议操作结果">{JSON.stringify(result, null, 2)}</pre>}
    </fieldset>
  </ResearchModal>;
}

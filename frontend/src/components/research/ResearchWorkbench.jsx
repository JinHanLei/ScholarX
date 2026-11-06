import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, Lightbulb, FlaskConical, FileText, ShieldCheck, PanelRightClose, PanelRightOpen, Plus, FolderGit2, Database, Download, RefreshCw, ChevronRight } from 'lucide-react';
import { request, Field, Empty, Badge, short } from './shared.jsx';
import { downloadApiFile } from '../../utils/api.js';
import LiteratureWorkspace from './LiteratureWorkspace.jsx';
import LiteratureApiSettings from './LiteratureApiSettings.jsx';
import IdeaWorkspace from './IdeaWorkspace.jsx';
import ExperimentWorkspace from './ExperimentWorkspace.jsx';
import PaperWorkspace from './PaperWorkspace.jsx';
import ReviewWorkspace from './ReviewWorkspace.jsx';
import ReviewPreparation from './ReviewPreparation.jsx';
import useReviewProgress from './useReviewProgress.js';
import ResearchAssistant from './ResearchAssistant.jsx';
import ResearchProjectTools from './ResearchProjectTools.jsx';
import ResearchProjectDialog from './ResearchProjectDialog.jsx';
import IdeaProgressBar from './idea/IdeaProgressBar.jsx';
import './research.css';

const stages = [
  ['Literature', '文献与证据', BookOpen], ['Idea', '研究问题与构想', Lightbulb], ['Experiment', '模型与实验', FlaskConical], ['Paper', '论文与段落大纲', FileText], ['Polish', '对抗审查', ShieldCheck], ['Review', '回复审稿人', FileText],
];
export default function ResearchWorkbench() {
  const [projects, setProjects] = useState([]); const [pid, setPid] = useState(localStorage.getItem('easyref.project') || '');
  const [stage, setStage] = useState(localStorage.getItem('easyref.workspace') || 'Literature');
  const [status, setStatus] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(0);
  const [creating, setCreating] = useState(false);
  const [translationSettingsOpen, setTranslationSettingsOpen] = useState(false);
  const [transfer, setTransfer] = useState(null);
  const [collapsed, setCollapsed] = useState(true); const [selection, setSelection] = useState(null); const [epoch, setEpoch] = useState(0);
  const [git, setGit] = useState(null); const [checkpoint, setCheckpoint] = useState('');
  const [workflow, setWorkflow] = useState(null); const [settingsOpen, setSettingsOpen] = useState(false);
  const [ideaVersion, setIdeaVersion] = useState(null);
  const reviewProgress = useReviewProgress(pid, epoch);
  const project = projects.find((p) => p.id === pid);
  const act = useCallback(async (fn) => { setBusy((n) => n + 1); setError(''); try { return await fn(); } catch (e) { setError(e.message || String(e)); return undefined; } finally { setBusy((n) => n - 1); } }, []);
  const reload = useCallback(async () => { const [p, s] = await Promise.all([request('/projects'), request('/status')]); setProjects(p.projects); setStatus(s); setPid((id) => p.projects.some((p) => p.id === id) ? id : p.projects[0]?.id || ''); }, []);
  useEffect(() => { act(reload); }, []);
  useEffect(() => { const timer = setInterval(() => request('/status').then(setStatus).catch(() => {}), 10000); return () => clearInterval(timer); }, []);
  useEffect(() => { localStorage.setItem('easyref.project', pid); if (pid) act(async () => { const r = await request(`/projects/${pid}`); setGit(r.git); }); }, [pid, epoch]);
  useEffect(() => { setSelection(null); }, [pid]);
  useEffect(() => { setWorkflow(null); if (!pid) return; let live = true; const load = () => request(`/projects/${pid}/workflow`).then((r) => { if (live) setWorkflow(r.workflow); }).catch(() => { if (live) setWorkflow(null); }); load(); const timer = setInterval(load, 5000); return () => { live = false; clearInterval(timer); }; }, [pid, epoch]);
  useEffect(() => { localStorage.setItem('easyref.workspace', stage); }, [stage]);
  const select = (value) => { setSelection(value); if (stage !== 'Idea') setCollapsed(false); };
  const openExperiment = (versionId) => { window.dispatchEvent(new Event('easyref:flush-idea')); setIdeaVersion(versionId || null); setStage('Experiment'); };
  const common = { project, act, select, epoch, refresh: () => setEpoch((v) => v + 1) };
  const savedProject = (saved) => {
    setProjects((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
    setPid(saved.id);
    if (creating) setStage('Idea');
    setCreating(false); setSettingsOpen(false); setCheckpoint(''); setEpoch((value) => value + 1);
  };
  return <div className={`research-shell ${collapsed || ['Idea', 'Experiment'].includes(stage) ? 'assistant-collapsed' : ''}`}>
    <header className="rw-topbar">
      <div className="rw-topline">
        <button type="button" className="rw-brand lit-api-logo" aria-label="OpenAI API 设置" title="OpenAI API 设置" aria-haspopup="dialog" onClick={() => setTranslationSettingsOpen(true)}><span className="rw-brand-mark"><BookOpen size={19} /></span><strong>EasyRef</strong></button>
        <div className="rw-explore"><span>一起探索</span><button type="button" className="rw-project-name" aria-label={project ? `项目设置：${project.name}` : '创建第一个项目'} aria-haspopup="dialog" title={project?.name || '创建第一个项目'} onClick={() => project ? setSettingsOpen(true) : setCreating(true)}>{project?.name || '你的下一篇论文'}</button></div>
        <button type="button" className="rw-add-project" title="新增项目" aria-label="新增项目" aria-haspopup="dialog" onClick={() => { setSettingsOpen(false); setCreating(true); }}><Plus size={20} /></button>
      </div>
    </header>
    <main className={`rw-main ${stage === 'Literature' ? 'lit-main' : ''}`}>
      {!['Literature', 'Idea', 'Experiment'].includes(stage) && <header className="rw-header"><div><div className="rw-breadcrumb">{project?.name || 'EasyRef'} <span>/</span> {stage}</div><h1>{stages.find(([key]) => key === stage)?.[1]}</h1>{stage === 'Literature' && <span className="rw-dblp-date" title={status?.dblp?.imported_at ? `最近完整导入：${new Date(status.dblp.imported_at).toLocaleString()}` : '尚无完整导入记录'}><Database size={11} /> DBLP 截至 {status?.dblp?.cutoff || '未标注'}{status?.dblp?.imported_at && <small> · 更新 {new Date(status.dblp.imported_at).toLocaleDateString('sv-SE')}</small>}</span>}</div><div className="rw-toolbar">{busy > 0 && <span className="rw-working" role="status">处理中…</span>}<Badge tone="local">LOCAL</Badge><button className="rw-icon" title={collapsed ? '展开 Codex Assistant' : '折叠 Codex Assistant'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelRightOpen size={20} /> : <PanelRightClose size={20} />}</button></div></header>}

      {error && <div className="rw-error-banner" role="alert"><span>{error}</span><button onClick={() => setError('')}>关闭</button></div>}
      <div className={`rw-content ${stage === 'Literature' ? 'lit-content' : ''}`}>{!project && stage !== 'Literature' ? <Empty><FolderGit2 size={36} /><h2>从一个真实研究项目开始</h2><p>创建本地项目，或导入已有 Git 与 LaTeX 工程。各工作区共享同一份研究上下文。</p><button className="rw-primary" onClick={() => setCreating(true)}>创建研究项目</button></Empty> : <React.Fragment key={pid}>
        {stage === 'Literature' && <LiteratureWorkspace {...common} onOpenApiSettings={() => setTranslationSettingsOpen(true)} />}
        {stage === 'Idea' && <IdeaWorkspace {...common} onExperiment={openExperiment} />}
        {stage === 'Experiment' && <ExperimentWorkspace key={pid} {...common} selection={selection} ideaVersion={ideaVersion} onIdea={() => setStage('Idea')} />}
        {stage === 'Paper' && <PaperWorkspace {...common} selection={selection} />}
        {stage === 'Polish' && <ReviewPreparation {...common} setStage={setStage} />}
        {stage === 'Review' && <ReviewWorkspace {...common} setStage={setStage} />}
      </React.Fragment>}</div>
    </main>
    {translationSettingsOpen && <LiteratureApiSettings onClose={() => setTranslationSettingsOpen(false)} />}
    {transfer && <ResearchProjectTools initialMode={transfer} onClose={() => setTransfer(null)} project={project} stage={stage} act={act} select={(value) => { setTransfer(null); select(value); }} onImported={async (p) => { await reload(); setPid(p.id); setEpoch((v) => v + 1); setTransfer(null); }} />}
    {(creating || (settingsOpen && project)) && <ResearchProjectDialog key={creating ? 'new-project' : pid} creating={creating} project={creating ? null : project} projects={projects} onSwitch={(id) => { setPid(id); setCheckpoint(''); }} onClose={() => { setCreating(false); setSettingsOpen(false); }} onSaved={savedProject} onTransfer={(mode) => { setCreating(false); setSettingsOpen(false); setTransfer(mode); }}>
      {!creating && <div className="rw-project-maintenance"><Field label="Checkpoint 说明"><input value={checkpoint} onChange={(e) => setCheckpoint(e.target.value)} /></Field><button type="button" disabled={!checkpoint.trim() || busy > 0} onClick={() => act(async () => { await request(`/projects/${pid}/git/checkpoint`, { method: 'POST', body: { message: checkpoint } }); setCheckpoint(''); setEpoch((n) => n + 1); })}>保存 Git Checkpoint</button><pre className="rw-git-status">{git?.changes || '工作目录干净'}</pre><div className="rw-toolbar"><button type="button" onClick={() => act(() => downloadApiFile('/backup', { method: 'POST', body: {} }, 'EasyRef-backup.sqlite3'))}><Download size={14} /> 备份</button><button type="button" onClick={() => act(reload)}><RefreshCw size={14} /> 刷新</button><small>{git?.branch} · {short(git?.commit)}</small></div>{error && <p className="rw-error" role="alert">{error}</p>}</div>}
    </ResearchProjectDialog>}
    <IdeaProgressBar project={project} onExperiment={openExperiment} />
    <nav className="rw-progress" aria-label="研究阶段进度">{stages.map(([key, label, Icon], index) => { const keys = { Literature: ['literature'], Idea: ['problem'], Experiment: ['protocol', 'experiments'], Paper: ['paper'], Polish: ['review'], Review: ['rebuttal'] }[key]; const states = workflow?.stale ? [] : (keys || []).map((k) => workflow?.phases?.[k]?.status); const progress = reviewProgress[key] || (states.length && states.every((s) => s === 'completed') ? 'completed' : states.includes('running') ? 'running' : 'pending'); const text = { completed: '已结束', running: '进行中', pending: '未进行' }[progress]; return <div className={`rw-progress-step ${progress}`} key={key}><button className={stage === key ? 'selected' : ''} aria-label={`${key} ${label}`} aria-current={stage === key ? 'step' : undefined} title={`${label} · ${text}`} onClick={() => { window.dispatchEvent(new Event('easyref:flush-idea')); setStage(key); }}><span className="rw-progress-light" /><Icon size={17} /><span>{key}</span><span className="rw-sr-only">{text}</span></button>{index < stages.length - 1 && <ChevronRight className="rw-progress-arrow" size={15} />}</div>; })}</nav>
    {!['Idea', 'Experiment'].includes(stage) && !collapsed && <ResearchAssistant onClose={() => setCollapsed(true)} key={pid || 'empty'} project={project} stage={stage === 'Polish' ? 'Review' : stage} selection={selection} setSelection={setSelection} act={act} refresh={() => setEpoch((n) => n + 1)} />}
  </div>;
}

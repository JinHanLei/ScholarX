import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Presentation, Check, LoaderCircle, History, ArrowUpRight, GitBranch, Download, Save } from 'lucide-react';
import { request } from './shared.jsx';
import PaperFigure from './idea/PaperFigure.jsx';
import ResearchJournal from './idea/ResearchJournal.jsx';
import { downloadFigure } from './idea/paperFigure.js';
import DesignNotes from './idea/DesignNotes.jsx';
import useIdeaVersions from './idea/useIdeaVersions.js';
import { semanticGraph } from './idea/ideaGraph.js';
import './idea/idea.css';
import './idea/ideaPreview.css';
import './idea/ideaResearch.css';

export default function IdeaWorkspace({ project, onExperiment }) {
  const [ideas, setIdeas] = useState([]), [legacy, setLegacy] = useState([]);
  const [record, setRecord] = useState(null), [document, setDocument] = useState(null);
  const [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [historical, setHistorical] = useState(null), [editingNotes, setEditingNotes] = useState(false), [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [publishing, setPublishing] = useState(false);
  const state = useRef({ record: null, document: null, dirty: false, saving: false, sequence: 0, dragging: false, live: true, undo: [], redo: [], historyAt: 0, dragStart: null });
  const { versions } = useIdeaVersions(project.id);
  const ownVersions = versions.filter((version) => version.idea_id === record?.idea_id);
  const latest = ownVersions[0];
  const unpublished = Boolean(document && (!latest || JSON.stringify(document) !== JSON.stringify(latest.document)));
  const methodChanged = Boolean(document && (!latest || semanticGraph(document) !== semanticGraph(latest.document)));
  const canPublish = Boolean(document?.graph.nodes.length && document.figure && !record?.figure_stale && (methodChanged || ['imported', 'cancelled'].includes(latest?.stage)));
  const viewedVersion = historical ? ownVersions.find((v) => v.id === historical) : null;
  const displayed = viewedVersion?.document || document;
  const retainDraft = useCallback(() => {
    const current = state.current;
    if (!current.record) return;
    const key = `easyref.idea-draft.${project.id}.${current.record.idea_id}`;
    try {
      if (current.dirty) sessionStorage.setItem(key, JSON.stringify({ document: current.document, expected_revision: current.record.revision }));
      else sessionStorage.removeItem(key);
    } catch { /* The unload guard still protects edits if browser storage is unavailable. */ }
  }, [project.id]);
  const applyRecord = useCallback((value, recover = false) => {
    let draft = null;
    if (value && recover) {
      try { draft = JSON.parse(sessionStorage.getItem(`easyref.idea-draft.${project.id}.${value.idea_id}`)); } catch { /* Ignore an unreadable local draft. */ }
    }
    const restored = draft?.document?.graph && JSON.stringify(draft.document) !== JSON.stringify(value.document);
    const next = restored ? draft.document : value?.document;
    state.current.record = restored ? { ...value, revision: draft.expected_revision } : value;
    state.current.document = next; state.current.dirty = Boolean(restored);
    state.current.undo = []; state.current.redo = [];
    setRecord(state.current.record); setDocument(next || null); setDirty(Boolean(restored));
    if (restored) {
      setNotice('已恢复本地未保存修改');
      if (draft.expected_revision !== value.revision) setError('模型已被另一个编辑更新，请保留本地修改并重新加载');
    }
    retainDraft();
  }, [project.id, retainDraft]);
  const edit = useCallback((update) => {
    const next = typeof update === 'function' ? update(state.current.document) : update;
    if (JSON.stringify(next) === JSON.stringify(state.current.document)) return;
    if (!state.current.dragging && Date.now() - state.current.historyAt > 500) {
      state.current.undo = [...state.current.undo.slice(-39), structuredClone(state.current.document)];
    }
    state.current.redo = []; state.current.historyAt = Date.now();
    state.current.document = next; state.current.dirty = true; state.current.sequence += 1;
    retainDraft();
    setDocument(next); setDirty(true); setError(''); setNotice('');
  }, [retainDraft]);
  const travel = (direction) => {
    const current = state.current, source = current[direction];
    if (!source.length || historical) return;
    current[direction === 'undo' ? 'redo' : 'undo'].push(structuredClone(current.document));
    current.document = source.pop(); current.dirty = true; current.sequence += 1; current.historyAt = 0;
    retainDraft();
    setDocument(current.document); setDirty(true); setError('');
  };
  const save = useCallback(async (commit = false) => {
    const current = state.current;
    if (!current.dirty && !commit) return true;
    if (current.saving || current.dragging) return false;
    if (!current.document.name.trim() || current.document.graph.nodes.some((n) => !n.label.trim())) { if (current.live) setError('请补齐 Idea 和模块名称后继续'); return false; }
    const sequence = current.sequence, submitted = structuredClone(current.document);
    let succeeded = false;
    current.saving = true; if (current.live) { setSaving(true); setPublishing(commit); }
    try {
      const result = await request(`/projects/${project.id}/ideas/${current.record.idea_id}${commit ? '/versions' : ''}`, { method: commit ? 'POST' : 'PUT', body: { expected_revision: current.record.revision, document: submitted, purpose: commit ? '保存模型版本' : '模型草稿修改' } });
      current.record = result.idea;
      succeeded = true;
      if (sequence === current.sequence) current.dirty = false;
      retainDraft();
      if (current.live) {
        setRecord(result.idea); setDirty(current.dirty); setError('');
        setNotice(result.published ? `V${result.version.number} 已保存，实验流程已自动排队` : commit ? '当前设计已是最新版本，不会重复启动实验' : '草稿已保存，点击“保存为版本”后开始实验');
      }
      window.dispatchEvent(new Event('easyref:idea-saved'));
      return !current.dirty;
    } catch (e) { if (current.live) setError(e.message); return false; }
    finally {
      current.saving = false;
      if (current.live) { setSaving(false); setPublishing(false); }
      else if (succeeded && current.dirty) void save();
    }
  }, [project.id, retainDraft]);
  useEffect(() => {
    state.current.live = true;
    let live = true, timer;
    const load = async () => {
      try {
        const value = await request(`/projects/${project.id}/ideas`);
        if (!live) return;
        setIdeas(value.ideas); setLegacy(value.legacy);
        const current = state.current;
        const savedId = localStorage.getItem(`easyref.idea.${project.id}`);
        const next = value.ideas.find((v) => v.idea_id === (current.record?.idea_id || savedId)) || value.ideas[0];
        if (next && !current.dirty && !current.saving && (next.idea_id !== current.record?.idea_id || next.revision !== current.record?.revision)) {
          applyRecord(next, !current.record);
          await request(`/projects/${project.id}/idea-context`, { method: 'POST', body: { idea_id: next.idea_id } });
        }
        if (!next && !current.record) await request(`/projects/${project.id}/idea-context`, { method: 'POST', body: {} });
      } catch (e) { if (live) setError(e.message); }
      if (live) timer = setTimeout(load, 2000);
    };
    load();
    return () => { live = false; clearTimeout(timer); state.current.live = false; void save(); };
  }, [project.id, applyRecord, save]);
  useEffect(() => {
    if (!dirty || saving || error) return;
    const timer = setTimeout(save, 2000); return () => clearTimeout(timer);
  }, [document, dirty, saving, error, save]);
  useEffect(() => {
    const flush = () => { void save(); };
    const beforeUnload = (e) => { if (state.current.dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('easyref:flush-idea', flush); window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('easyref:flush-idea', flush); window.removeEventListener('beforeunload', beforeUnload); };
  }, [save]);
  const choose = async (id) => {
    if (!(await save())) return;
    const value = ideas.find((item) => item.idea_id === id); if (!value) return;
    setError(''); setNotice(''); applyRecord(value, true); setHistorical(null);
    localStorage.setItem(`easyref.idea.${project.id}`, id);
    try { await request(`/projects/${project.id}/idea-context`, { method: 'POST', body: { idea_id: id } }); } catch (e) { setError(e.message); }
  };
  const create = async (legacyId) => {
    if (!(await save())) return;
    try {
      const value = await request(`/projects/${project.id}/ideas`, { method: 'POST', body: legacyId ? { idea_id: legacyId } : { name: `研究构想 ${ideas.length + 1}` } });
      setIdeas((items) => [value.idea, ...items.filter((item) => item.idea_id !== value.idea.idea_id)]);
      applyRecord(value.idea); setHistorical(null); setError(''); setEditingNotes(true);
      localStorage.setItem(`easyref.idea.${project.id}`, value.idea.idea_id);
    } catch (e) { setError(e.message); }
  };
  const downloadLocal = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state.current.document, null, 2)], { type: 'application/json' }));
    const a = window.document.createElement('a'); a.href = url; a.download = 'idea-local-draft.json'; a.click(); URL.revokeObjectURL(url);
  };
  const reload = async () => {
    try { const value = await request(`/projects/${project.id}/ideas/${record.idea_id}`); applyRecord(value.idea); setError(''); }
    catch (e) { setError(e.message); }
  };
  const exportPpt = async () => {
    if (!displayed) return; setExporting(true);
    try { const { exportPresentation } = await import('./idea/ideaExport.js'); await exportPresentation(displayed, viewedVersion?.number || (!unpublished ? latest?.number : null)); }
    catch (e) { setError(`PPT 导出失败：${e.message}`); } finally { setExporting(false); }
  };
  const saveState = <span className="idea-save-state">{saving ? <LoaderCircle className="idea-spin" size={13} /> : dirty ? <span className="idea-status-dot" /> : <Check size={13} />}{saving ? (publishing ? '保存版本中' : '保存草稿中') : dirty ? '草稿待保存' : '草稿已保存'}</span>;
  const errorBanner = error && <div className="idea-error" role="alert"><span>{error}</span>{record && <><button onClick={downloadLocal}><Download size={13} />保留本地副本</button><button onClick={reload}>重新加载</button></>}</div>;
  return <div className="idea-workspace" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) { e.preventDefault(); travel(e.shiftKey ? 'redo' : 'undo'); } }}>
    <header className="idea-heading"><div><h1>研究构想<span>Idea</span></h1></div><button className="idea-new" onClick={() => create()}><Plus size={15} />新建 Idea</button></header>
    {errorBanner}
    {!displayed ? <section className="idea-onboarding"><GitBranch size={35} /><h2>从一个 backbone 开始</h2><p>和 Codex 讨论方法，生成论文模型图，记录每次确定的修改与实验结果。</p><button className="idea-primary" onClick={() => create()}><Plus size={16} />新建研究构想</button>{legacy.length > 0 && <div className="idea-legacy"><span>继续已有构想</span>{legacy.map((item) => <button key={item.id} onClick={() => create(item.id)}>{item.name}<ArrowUpRight size={13} /></button>)}</div>}</section> : <>
      <div className="idea-document-toolbar"><div className="idea-document-title"><select aria-label="选择模型构想" value={record.idea_id} onChange={(e) => choose(e.target.value)}>{ideas.map((item) => <option key={item.idea_id} value={item.idea_id}>{item.document.name}</option>)}</select><span className="idea-version-pill">{viewedVersion ? `V${viewedVersion.number}` : latest ? `V${latest.number}${unpublished ? ' · 草稿' : ''}` : 'DRAFT'}</span></div><div className="idea-document-actions">{!viewedVersion && saveState}<button disabled={!displayed.figure} onClick={() => downloadFigure(displayed.figure, displayed.name)}><Download size={14} />导出 SVG</button><button disabled={exporting || !displayed.graph.nodes.length} onClick={exportPpt}><Presentation size={15} />{exporting ? '导出中' : '导出 PPT'}</button>{!viewedVersion && <button className="idea-primary idea-publish" disabled={saving || !canPublish || Boolean(error)} onClick={() => void save(true)} title="创建正式版本并自动开始实验"><Save size={15} />{publishing ? '提交中…' : '保存为版本'}</button>}</div></div>
      {viewedVersion && <div className="idea-history-banner"><History size={15} />正在查看 V{viewedVersion.number}<button onClick={() => setHistorical(null)}>返回当前设计</button><button onClick={() => { setHistorical(null); edit(structuredClone(viewedVersion.document)); }}>基于此版本继续</button></div>}
      <PaperFigure figure={displayed.figure} stale={viewedVersion ? viewedVersion.figure_stale : record.figure_stale} historical={Boolean(viewedVersion)} />
      {!viewedVersion && <div className="idea-canvas-footnote"><span>{notice || '在 Codex 中讨论修改，论文图和研究记录会同步更新。点击“保存为版本”后开始对应实验。'}</span></div>}
      <DesignNotes key={`notes-${historical || record.idea_id}`} document={displayed} readOnly={Boolean(viewedVersion)} editing={editingNotes && !viewedVersion} onEditingChange={(value) => { setEditingNotes(value); if (!value) void save(); }} onChange={edit} />
      <ResearchJournal key={record.idea_id} projectId={project.id} ideaId={record.idea_id} versions={ownVersions} onVersion={async (id) => { if (await save()) { setHistorical(id); setEditingNotes(false); } }} onExperiment={onExperiment} />
    </>}
  </div>;
}

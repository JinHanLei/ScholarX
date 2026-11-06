import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Presentation, Check, LoaderCircle, History, ArrowUpRight, GitBranch, Download, Undo2, Redo2, Save, ChevronDown } from 'lucide-react';
import { request } from './shared.jsx';
import ResearchModal from './ResearchModal.jsx';
import ModelCanvas from './idea/ModelCanvas.jsx';
import ModelPreview from './idea/ModelPreview.jsx';
import DesignNotes from './idea/DesignNotes.jsx';
import useIdeaVersions from './idea/useIdeaVersions.js';
import { STAGES, changedNodes, semanticGraph } from './idea/ideaGraph.js';
import './idea/idea.css';
import './idea/ideaPreview.css';

function versionChangeSummary(version) {
  const changes = version.changes;
  return [changes.added.length && `新增 ${changes.added.join('、')}`, changes.modified.length && `调整 ${changes.modified.join('、')}`, changes.removed.length && `移除 ${changes.removed.join('、')}`, changes.connections_changed && '连接关系变化', changes.description_changed && '设计说明更新'].filter(Boolean).join(' · ') || '初始模型设计';
}

export default function IdeaWorkspace({ project, onExperiment }) {
  const [ideas, setIdeas] = useState([]), [legacy, setLegacy] = useState([]);
  const [record, setRecord] = useState(null), [document, setDocument] = useState(null);
  const [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [historical, setHistorical] = useState(null), [editingNotes, setEditingNotes] = useState(false), [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [editingModel, setEditingModel] = useState(false), [editorNode, setEditorNode] = useState(null);
  const [showAllVersions, setShowAllVersions] = useState(false);
  const state = useRef({ record: null, document: null, dirty: false, saving: false, sequence: 0, dragging: false, live: true, undo: [], redo: [], historyAt: 0, dragStart: null });
  const { versions } = useIdeaVersions(project.id);
  const ownVersions = versions.filter((version) => version.idea_id === record?.idea_id);
  const latest = ownVersions[0];
  const unpublished = Boolean(document && (!latest || semanticGraph(document) !== semanticGraph(latest.document)));
  const canPublish = Boolean(document?.graph.nodes.length && (unpublished || ['imported', 'cancelled'].includes(latest?.stage)));
  const viewedVersion = historical ? ownVersions.find((v) => v.id === historical) : null;
  const displayed = viewedVersion?.document || document;
  const differences = viewedVersion ? changedNodes(ownVersions.find((v) => v.number < viewedVersion.number)?.document, viewedVersion.document) : {};
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
  const openModel = (nodeId) => { setEditorNode(nodeId || null); setEditingModel(true); };
  const closeModel = () => { state.current.dragging = false; setEditingModel(false); void save(); };
  const saveState = <span className="idea-save-state">{saving ? <LoaderCircle className="idea-spin" size={13} /> : dirty ? <span className="idea-status-dot" /> : <Check size={13} />}{saving ? (publishing ? '保存版本中' : '保存草稿中') : dirty ? '草稿待保存' : '草稿已保存'}</span>;
  const errorBanner = error && <div className="idea-error" role="alert"><span>{error}</span>{record && <><button onClick={downloadLocal}><Download size={13} />保留本地副本</button><button onClick={reload}>重新加载</button></>}</div>;
  return <div className="idea-workspace" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) { e.preventDefault(); travel(e.shiftKey ? 'redo' : 'undo'); } }}>
    <header className="idea-heading"><div><h1>模型构想<span>Idea</span></h1></div><button className="idea-new" onClick={() => create()}><Plus size={15} />新建 Idea</button></header>
    {!editingModel && errorBanner}
    {!displayed ? <section className="idea-onboarding"><GitBranch size={35} /><h2>从一个 backbone 开始</h2><p>和 Codex 讨论模型结构，在画布中继续调整。设计完成后保存为版本，自动开始对应实验。</p><button className="idea-primary" onClick={() => create()}><Plus size={16} />创建模型画布</button>{legacy.length > 0 && <div className="idea-legacy"><span>继续已有构想</span>{legacy.map((item) => <button key={item.id} onClick={() => create(item.id)}>{item.name}<ArrowUpRight size={13} /></button>)}</div>}</section> : <>
      <div className="idea-document-toolbar"><div className="idea-document-title"><select aria-label="选择模型构想" value={record.idea_id} onChange={(e) => choose(e.target.value)}>{ideas.map((item) => <option key={item.idea_id} value={item.idea_id}>{item.document.name}</option>)}</select><span className="idea-version-pill">{viewedVersion ? `V${viewedVersion.number}` : latest ? `V${latest.number}${unpublished ? ' · 草稿' : ''}` : 'DRAFT'}</span></div><div className="idea-document-actions">{!editingModel && !viewedVersion && saveState}<button disabled={exporting || !displayed.graph.nodes.length} onClick={exportPpt}><Presentation size={15} />{exporting ? '导出中' : '导出 PPT'}</button>{!viewedVersion && <button className="idea-primary idea-publish" disabled={saving || !canPublish || Boolean(error)} onClick={() => void save(true)} title="创建正式版本并自动开始实验"><Save size={15} />{publishing ? '提交中…' : '保存为版本'}</button>}</div></div>
      {viewedVersion && <div className="idea-history-banner"><History size={15} />正在查看 V{viewedVersion.number}<button onClick={() => setHistorical(null)}>返回当前设计</button><button onClick={() => { setHistorical(null); edit(structuredClone(viewedVersion.document)); }}>基于此版本继续</button></div>}
      <ModelPreview key={`preview-${historical || record.idea_id}`} graph={displayed.graph} readOnly={Boolean(viewedVersion)} differences={differences} onEdit={openModel} />
      {!viewedVersion && <div className="idea-canvas-footnote"><span>{notice || '编辑自动保存为草稿；点击“保存为版本”后开始对应实验。'}</span></div>}
      <DesignNotes key={`notes-${historical || record.idea_id}`} document={displayed} readOnly={Boolean(viewedVersion)} editing={editingNotes && !viewedVersion} onEditingChange={(value) => { setEditingNotes(value); if (!value) void save(); }} onChange={edit} />
      <section className="idea-history"><header><div><History size={16} /><h2>修改记录与版本</h2><span>{ownVersions.length}</span></div><small>Idea / Experiment 同版本</small></header>
        {!ownVersions.length ? <p className="idea-placeholder">完成设计并点击“保存为版本”后，这里会出现 V1 和对应实验进度。</p> : (showAllVersions ? ownVersions : ownVersions.slice(0, 3)).map((version) => <article className={`idea-version-row ${historical === version.id ? 'selected' : ''}`} key={version.id}>
          <button className="idea-version-label" onClick={async () => { if (await save()) { setHistorical(version.id); setEditingNotes(false); } }}>V{version.number}</button>
          <div className="idea-version-copy"><strong title={versionChangeSummary(version)}>{versionChangeSummary(version)}</strong><small>{version.purpose} · {new Date(version.created_at).toLocaleString()} · {version.runs.length} 次运行</small></div>
          <span className={`idea-stage-tag ${version.stage}`}>{STAGES[version.stage]}</span><button title={`查看 V${version.number} 对应实验`} onClick={() => onExperiment(version.id)}><ArrowUpRight size={17} /></button>
        </article>)}
        {ownVersions.length > 3 && <button className="idea-history-more" aria-expanded={showAllVersions} onClick={() => setShowAllVersions(!showAllVersions)}><ChevronDown size={13} />{showAllVersions ? '收起早期版本' : `查看全部 ${ownVersions.length} 个版本`}</button>}
      </section>
      {editingModel && <ResearchModal title={viewedVersion ? `查看 V${viewedVersion.number} 模型` : '编辑模型'} subtitle={viewedVersion ? '历史版本只读' : '调整模块和连接，修改自动保存为草稿。完成后返回页面保存为版本。'} onClose={closeModel} wide className="idea-model-dialog">
        {errorBanner}
        <div className="idea-editor-actions">{!viewedVersion && <><button title="撤销修改" disabled={!state.current.undo.length} onClick={() => travel('undo')}><Undo2 size={14} />撤销</button><button title="重做修改" disabled={!state.current.redo.length} onClick={() => travel('redo')}><Redo2 size={14} />重做</button>{saveState}</>}<button className="idea-primary" onClick={closeModel}><Check size={14} />{viewedVersion ? '返回预览' : '完成编辑'}</button></div>
        <ModelCanvas graph={displayed.graph} initialSelection={editorNode} readOnly={Boolean(viewedVersion)} differences={differences}
          onInteraction={(dragging) => { const current = state.current; if (dragging) current.dragStart = structuredClone(current.document); else if (current.dragStart) { if (JSON.stringify(current.dragStart) !== JSON.stringify(current.document)) { current.undo = [...current.undo.slice(-39), current.dragStart]; current.redo = []; } current.dragStart = null; } current.dragging = dragging; if (!dragging) void save(); }} onChange={(graph) => edit((doc) => ({ ...doc, graph }))} />
      </ResearchModal>}
    </>}
  </div>;
}

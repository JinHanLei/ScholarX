import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Plus, Presentation, Check, LoaderCircle, History, ArrowUpRight, Pencil, FileText, GitBranch, Download, Copy, Undo2, Redo2 } from 'lucide-react';
import { request } from './shared.jsx';
import ModelCanvas from './idea/ModelCanvas.jsx';
import useIdeaVersions from './idea/useIdeaVersions.js';
import { STAGES, changedNodes } from './idea/ideaGraph.js';
import './idea/idea.css';

export default function IdeaWorkspace({ project, onExperiment }) {
  const [ideas, setIdeas] = useState([]), [legacy, setLegacy] = useState([]);
  const [record, setRecord] = useState(null), [document, setDocument] = useState(null);
  const [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [historical, setHistorical] = useState(null), [editingNotes, setEditingNotes] = useState(false), [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const state = useRef({ record: null, document: null, dirty: false, saving: false, sequence: 0, dragging: false, live: true, undo: [], redo: [], historyAt: 0, dragStart: null });
  const { versions } = useIdeaVersions(project.id);
  const ownVersions = versions.filter((version) => version.idea_id === record?.idea_id);
  const latest = ownVersions[0];
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
  const save = useCallback(async () => {
    const current = state.current;
    if (!current.dirty) return true;
    if (current.saving || current.dragging) return false;
    if (!current.document.name.trim() || current.document.graph.nodes.some((n) => !n.label.trim())) { if (current.live) setError('请补齐 Idea 和模块名称后继续'); return false; }
    const sequence = current.sequence, submitted = structuredClone(current.document);
    let succeeded = false;
    current.saving = true; if (current.live) setSaving(true);
    try {
      const result = await request(`/projects/${project.id}/ideas/${current.record.idea_id}`, { method: 'PUT', body: { expected_revision: current.record.revision, document: submitted, purpose: '模型画布修改' } });
      current.record = result.idea;
      succeeded = true;
      if (sequence === current.sequence) current.dirty = false;
      retainDraft();
      if (current.live) {
        setRecord(result.idea); setDirty(current.dirty); setError('');
        setNotice(result.published ? `V${result.version.number} 已保存，实验流程已自动排队` : '已保存 · 外观调整不会重跑实验');
      }
      window.dispatchEvent(new Event('easyref:idea-saved'));
      return !current.dirty;
    } catch (e) { if (current.live) setError(e.message); return false; }
    finally {
      current.saving = false;
      if (current.live) setSaving(false);
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
    try { const { exportPresentation } = await import('./idea/ideaExport.js'); await exportPresentation(displayed, viewedVersion?.number || (!dirty ? latest?.number : null)); }
    catch (e) { setError(`PPT 导出失败：${e.message}`); } finally { setExporting(false); }
  };
  const copyContext = async () => {
    try {
      const context = await request('/idea-context');
      await navigator.clipboard.writeText(`请在 EasyRef 项目「${project.name}」中更新模型图。API: ${context.api_base}；project_id: ${project.id}；idea_id: ${record?.idea_id || '尚未创建'}。先读取当前模型及 revision，再通过 Idea API 保存结构化图；保存后会自动形成统一版本并启动实验，不需要二次同步。不要直接修改数据库或导出文件。`);
      setNotice('已复制当前项目与模型上下文');
    } catch (e) { setError(e.message); }
  };
  return <div className="idea-workspace" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) { e.preventDefault(); travel(e.shiftKey ? 'redo' : 'undo'); } }}>
    <header className="idea-heading"><div><span className="idea-eyebrow">FROM IDEA TO EXPERIMENT</span><h1>模型构想<span>Idea</span></h1></div><button className="idea-new" onClick={() => create()}><Plus size={15} />新建 Idea</button></header>
    {error && <div className="idea-error" role="alert"><span>{error}</span>{record && <><button onClick={downloadLocal}><Download size={13} />保留本地副本</button><button onClick={reload}>重新加载</button></>}</div>}
    {!displayed ? <section className="idea-onboarding"><GitBranch size={35} /><h2>从一个 backbone 开始</h2><p>和 Codex 讨论模型结构，在画布中继续调整。每个设计版本都会自动关联实验。</p><button className="idea-primary" onClick={() => create()}><Plus size={16} />创建模型画布</button>{legacy.length > 0 && <div className="idea-legacy"><span>继续已有构想</span>{legacy.map((item) => <button key={item.id} onClick={() => create(item.id)}>{item.name}<ArrowUpRight size={13} /></button>)}</div>}</section> : <>
      <div className="idea-document-toolbar"><div className="idea-document-title"><select aria-label="选择模型构想" value={record.idea_id} onChange={(e) => choose(e.target.value)}>{ideas.map((item) => <option key={item.idea_id} value={item.idea_id}>{item.document.name}</option>)}</select><span className="idea-version-pill">{viewedVersion ? `V${viewedVersion.number}` : latest ? `V${latest.number}${dirty ? ' · 草稿' : ''}` : 'DRAFT'}</span></div><div className="idea-document-actions"><button title="撤销修改" disabled={Boolean(viewedVersion) || !state.current.undo.length} onClick={() => travel('undo')}><Undo2 size={14} /></button><button title="重做修改" disabled={Boolean(viewedVersion) || !state.current.redo.length} onClick={() => travel('redo')}><Redo2 size={14} /></button><span className="idea-save-state">{saving ? <LoaderCircle className="idea-spin" size={13} /> : dirty ? <span className="idea-status-dot" /> : <Check size={13} />}{saving ? '保存中' : dirty ? '待保存' : '已保存'}</span><button title="复制当前模型上下文给 Codex" onClick={copyContext}><Copy size={14} /></button><button disabled={exporting || !displayed.graph.nodes.length} onClick={exportPpt}><Presentation size={15} />{exporting ? '导出中' : '导出 PPT'}</button></div></div>
      {viewedVersion && <div className="idea-history-banner"><History size={15} />正在查看 V{viewedVersion.number}<button onClick={() => setHistorical(null)}>返回当前设计</button><button onClick={() => { setHistorical(null); edit(structuredClone(viewedVersion.document)); }}>基于此版本继续</button></div>}
      <ModelCanvas key={historical || record.idea_id} graph={displayed.graph} readOnly={Boolean(viewedVersion)} differences={viewedVersion ? changedNodes(ownVersions.find((v) => v.number < viewedVersion.number)?.document, viewedVersion.document) : {}}
        onInteraction={(dragging) => { const current = state.current; if (dragging) current.dragStart = structuredClone(current.document); else if (current.dragStart && JSON.stringify(current.dragStart) !== JSON.stringify(current.document)) { current.undo = [...current.undo.slice(-39), current.dragStart]; current.redo = []; current.dragStart = null; } current.dragging = dragging; if (!dragging) void save(); }} onChange={(graph) => edit((doc) => ({ ...doc, graph }))} />
      <div className="idea-canvas-footnote"><span>{notice || '结构修改自动保存并进入实验流程；布局调整不触发重跑。'}</span><span>React Flow</span></div>
      <section className="idea-notes"><header><div><FileText size={17} /><h2>设计说明</h2></div>{!viewedVersion && <button onClick={() => setEditingNotes(!editingNotes)}><Pencil size={13} />{editingNotes ? '预览说明' : '编辑说明'}</button>}</header>
        {editingNotes && !viewedVersion ? <><label>构想名称<input aria-label="Idea 名称" value={document.name} onChange={(e) => edit((doc) => ({ ...doc, name: e.target.value }))} /></label><textarea aria-label="模型设计说明" placeholder="研究问题、核心假设、模块职责、训练目标与实验设置……支持 Markdown。" rows={7} value={document.description} onChange={(e) => edit((doc) => ({ ...doc, description: e.target.value }))} /></> : <div className="idea-markdown">{displayed.description ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayed.description}</ReactMarkdown> : <p className="idea-placeholder">补充为什么这样设计，以及希望通过实验验证什么。</p>}</div>}
      </section>
      <section className="idea-history"><header><div><History size={17} /><h2>修改记录与版本</h2><span>{ownVersions.length}</span></div><small>Idea 与 Experiment 共用版本</small></header>
        {!ownVersions.length ? <p className="idea-placeholder">保存第一个模型结构后，这里会出现 V1 和对应实验进度。</p> : ownVersions.map((version) => <article className={`idea-version-row ${historical === version.id ? 'selected' : ''}`} key={version.id}>
          <button className="idea-version-label" onClick={async () => { if (await save()) { setHistorical(version.id); setEditingNotes(false); } }}>V{version.number}</button>
          <div className="idea-version-copy"><strong>{version.purpose}</strong><p>{[version.changes.added.length && `新增 ${version.changes.added.join('、')}`, version.changes.modified.length && `调整 ${version.changes.modified.join('、')}`, version.changes.removed.length && `移除 ${version.changes.removed.join('、')}`, version.changes.connections_changed && '连接关系变化', version.changes.description_changed && '设计说明更新'].filter(Boolean).join(' · ') || '初始模型设计'}</p><small>{new Date(version.created_at).toLocaleString()} · {version.runs.length} 次运行</small></div>
          <span className={`idea-stage-tag ${version.stage}`}>{STAGES[version.stage]}</span><button title={`查看 V${version.number} 对应实验`} onClick={() => onExperiment(version.id)}><ArrowUpRight size={17} /></button>
        </article>)}
      </section>
    </>}
  </div>;
}

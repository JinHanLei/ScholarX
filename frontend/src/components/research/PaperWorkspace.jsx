import React, { useEffect, useRef, useState } from 'react';
import { FileUp, Save, FileText, Code2, BookOpen, History } from 'lucide-react';
import { PdfJsViewer } from '../PdfViewer.jsx';
import PaperOutline from './PaperOutline.jsx';
import PaperRevision from './PaperRevision.jsx';
import PaperPlan from './PaperPlan.jsx';
import './paper.css';
import { request, Field, Badge, Empty, short, stamp } from './shared.jsx';

export default function PaperWorkspace({ project, act, select, selection, epoch }) {
  const [files, setFiles] = useState([]); const [path, setPath] = useState(''); const [doc, setDoc] = useState(null); const [source, setSource] = useState('');
  const [mode, setMode] = useState('read'); const [compile, setCompile] = useState(null); const [history, setHistory] = useState([]); const [version, setVersion] = useState(''); const [diff, setDiff] = useState('');
  const [editing, setEditing] = useState(''); const [text, setText] = useState(''); const [newFile, setNewFile] = useState(false); const [filename, setFilename] = useState('main.tex'); const [initial, setInitial] = useState('');
  const reader = useRef(null);
  const [reviseEnabled, setReviseEnabled] = useState(false), [selectedText, setSelectedText] = useState(null), [selectionError, setSelectionError] = useState('');
  const captureSelection = () => {
    if (!reviseEnabled || editing || dirty || selectedText) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const element = (node) => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const start = element(range.startContainer)?.closest('[data-paper-text]');
    const end = element(range.endContainer)?.closest('[data-paper-text]');
    if (!start || !reader.current?.contains(start)) return;
    if (start !== end) { setSelectionError('请在同一段正文内选择需要修改的文字。'); return; }
    const prefix = range.cloneRange(); prefix.selectNodeContents(start); prefix.setEnd(range.startContainer, range.startOffset);
    const text = range.toString();
    if (!text.trim()) return;
    if (text.length > 16000) { setSelectionError('选区最多 16000 字符，请缩小选区。'); return; }
    setSelectionError('');
    setSelectedText({ path, expected_hash: doc.sha256, paragraph_id: start.dataset.paperText, start: prefix.toString().length, end: prefix.toString().length + text.length, text });
  };
  const emptyDoc = doc && !doc.source.replace(/%[^\n]*/g, '').replace(/\\(?:documentclass|usepackage|begin|end|title|author|date|section|subsection)(?:\[[^\]]*\])?\{[^}]*\}/g, '').replace(/\\maketitle/g, '').trim();
  const dirty = doc && source !== doc.source;
  const loadFiles = async () => { const r = await request(`/projects/${project.id}/paper/files`); setFiles(r.files); if (!path && r.files.length) setPath(r.files[0]); };
  const accept = (d) => { setSelectedText(null); setDoc(d); setSource(d.source); setPath(d.path); };
  const load = async () => { if (path) accept(await request(`/projects/${project.id}/paper?path=${encodeURIComponent(path)}`)); };
  useEffect(() => { act(loadFiles); }, [epoch]);
  useEffect(() => { if (path && !dirty && !editing) act(load); }, [epoch]);
  useEffect(() => { if (selection?.kind === 'paragraph' && selection.document_path) { setPath(selection.document_path); setMode('read'); } }, [selection?.id]);
  useEffect(() => { if (selection?.kind === 'paragraph' && doc) document.getElementById('paragraph-' + selection.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [doc?.path, selection?.id]);
  useEffect(() => { act(load); setCompile(null); setEditing(''); }, [path]);
  useEffect(() => { if (!dirty) return; const handler = (e) => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler); }, [dirty]);
  const chooseParagraph = (p) => { act(async () => { const r = await request(`/paragraphs/${p.id}/outline`); select({ kind: 'paragraph', id: p.id, title: p.section || short(p.id), outline: r.outline, document_path: path }); }); };
  const save = () => act(async () => accept(await request(`/projects/${project.id}/paper`, { method: 'PUT', body: { path, source, expected_hash: doc.sha256 } })));
  return <div className="rw-paper-stack"><div className="rw-toolbar rw-paper-toolbar"><select aria-label="LaTeX 文件" value={path} onChange={(e) => { if (!(dirty || editing) || window.confirm('当前源码尚未保存，确认切换文件？')) setPath(e.target.value); }}><option value="" disabled>选择 LaTeX 文件</option>{files.map((f) => <option key={f}>{f}</option>)}</select><label className="rw-file-button"><FileUp size={15} /> 导入 .tex / ZIP<input type="file" accept=".tex,.zip" onChange={(e) => { const file = e.target.files[0]; if (file) act(async () => { const form = new FormData(); form.append('file', file); const result = await request(`/projects/${project.id}/paper/import`, { method: 'POST', body: form }); await loadFiles(); if (result.source) accept(result); }); }} /></label><button onClick={() => setNewFile(!newFile)}>新建源码</button>{doc && <button onClick={() => { if (!(dirty || editing) || window.confirm('放弃未保存的修改并刷新？')) act(load); }}>刷新文件</button>}</div>
    {newFile && <section className="rw-card"><Field label="文件名"><input value={filename} onChange={(e) => setFilename(e.target.value)} /></Field><Field label="LaTeX 全文"><textarea className="rw-code" rows={12} value={initial} onChange={(e) => setInitial(e.target.value)} placeholder="粘贴真实 LaTeX 源码。导入后会插入不影响排版的段落注释锚点。" /></Field><button className="rw-primary" disabled={!initial.trim()} onClick={() => act(async () => { const d = await request(`/projects/${project.id}/paper/import`, { method: 'POST', body: { filename, source: initial } }); accept(d); await loadFiles(); setNewFile(false); })}>创建 LaTeX 文件</button></section>}
    {(!doc || emptyDoc) && <PaperPlan project={project} onCreated={(d) => { accept(d); act(loadFiles); }} />}
    {!doc && <p className="rw-muted">也可以直接导入已有 .tex / ZIP，或新建源码。</p>}
    {doc && <><div className="rw-toolbar rw-paper-modes"><div className="rw-segmented"><button className={mode === 'read' ? 'active' : ''} onClick={() => setMode('read')}><BookOpen size={15} /> 全文源码阅读</button><button disabled={Boolean(editing)} className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}><Code2 size={15} /> LaTeX 编辑</button><button className={mode === 'pdf' ? 'active' : ''} onClick={() => setMode('pdf')}><FileText size={15} /> PDF</button></div><button className={`paper-revise-toggle ${reviseEnabled ? 'active' : ''}`} aria-pressed={reviseEnabled} disabled={mode !== 'read' || dirty || Boolean(editing)} onClick={() => { setReviseEnabled(!reviseEnabled); setSelectionError(''); }}>划词修改{reviseEnabled ? ' · 已开启' : ''}</button><button disabled={dirty || Boolean(editing)} onClick={() => act(async () => { setCompile(await request(`/projects/${project.id}/paper/compile`, { method: 'POST', body: { path } })); setMode('pdf'); })}>编译论文</button><button onClick={() => act(async () => { const r = await request(`/projects/${project.id}/paper/versions?path=${encodeURIComponent(path)}`); setHistory(r.versions); setVersion(r.versions[0]?.id || ''); })}><History size={15} /> 历史</button><button className="rw-primary" disabled={!dirty} onClick={save}><Save size={15} /> 保存源码</button></div>
      {reviseEnabled && mode === 'read' && <p className="rw-muted">选中同一段内的正文，弹出修改意见输入框。</p>}
      {selectionError && <p role="status" className="rw-warning">{selectionError}</p>}
      {doc.needs_anchor_import && <div className="rw-callout"><p>此文件尚未建立 Paragraph ID。添加注释锚点后可使用蓝条和稳定大纲。</p><button onClick={() => act(async () => accept(await request(`/projects/${project.id}/paper/anchors`, { method: 'POST', body: { path } })))}>建立段落锚点</button></div>}
      {history.length > 0 && <section className="rw-card"><div className="rw-toolbar"><select aria-label="论文历史版本" value={version} onChange={(e) => setVersion(e.target.value)}>{history.map((v) => <option key={v.id} value={v.id}>{stamp(v.created_at)} · {short(v.id)}</option>)}</select><button onClick={() => act(async () => setDiff((await request(`/projects/${project.id}/paper/diff?path=${encodeURIComponent(path)}&version_id=${version}`)).diff))}>比较当前全文</button><button onClick={() => { if (window.confirm('确认恢复此历史源码？当前源码会保存为历史版本。')) act(async () => accept(await request(`/projects/${project.id}/paper/restore`, { method: 'POST', body: { version_id: version, expected_hash: doc.sha256, confirmed: true } }))); }}>回退</button><button onClick={() => setHistory([])}>收起</button></div>{diff && <pre className="rw-diff">{diff}</pre>}</section>}
      {mode === 'edit' && <div className="rw-source-editor"><div className="rw-source-info"><Badge>{dirty ? '未保存' : '已保存'}</Badge><span>保留 % easyref:paragraph:… 注释。结构变化请使用拆分/合并 API，以保存 ID 演化。</span></div><textarea aria-label="LaTeX 全文源码" spellCheck={false} value={source} onChange={(e) => setSource(e.target.value)} /></div>}
      {mode === 'read' && <div className="rw-paper-reading" ref={reader} onPointerUp={captureSelection} onKeyUp={captureSelection}><article className="rw-manuscript"><div className="rw-manuscript-heading"><small>LATEX SOURCE READING</small><h2>{path.split('/').pop()}</h2><p>悬停蓝条查看写作意图，点击在右侧编辑大纲和证据。</p></div>{doc.paragraphs.length ? doc.paragraphs.map((p) => <section id={'paragraph-' + p.id} className="rw-paragraph" data-paragraph-id={p.id} key={p.id}><button className={`rw-outline-bar ${p.outline?.needs_review ? 'needs-review' : ''}`} aria-label={`段落大纲 ${short(p.id)}`} title={p.outline?.purpose || '尚未设置段落写作意图，点击添加大纲'} onClick={() => chooseParagraph(p)} /><div className="rw-paragraph-meta"><small>{p.section || 'Paragraph'} · {short(p.id)}</small>{p.outline?.locked ? <Badge>已锁定大纲</Badge> : null}{p.outline?.needs_review ? <Badge tone="warning">正文已变化 · 核查大纲</Badge> : null}<button onClick={() => { if (!dirty || window.confirm('放弃未保存的全文源码修改？')) { setSource(doc.source); setEditing(p.id); setText(p.content); } }}>编辑此段</button></div>{editing === p.id ? <><textarea className="rw-paragraph-editor" rows={8} value={text} onChange={(e) => setText(e.target.value)} /><div className="rw-toolbar"><button className="rw-primary" onClick={() => act(async () => { accept(await request(`/paragraphs/${p.id}`, { method: 'PUT', body: { content: text, expected_hash: doc.sha256 } })); setEditing(''); })}>只保存此段</button><button onClick={() => setEditing('')}>取消</button></div></> : <pre className="rw-paragraph-text" data-paper-text={p.id}>{p.content}</pre>}</section>) : <pre className="rw-paragraph-text">{doc.source}</pre>}</article></div>}
      {mode === 'pdf' && <div className="rw-stack">{compile?.engine?.available && <p className="rw-muted">实际编译器：{compile.engine.version} · {compile.engine.source}</p>}{compile?.pdf ? <div className="rw-pdf rw-paper-pdf"><PdfJsViewer url={`/api/projects/${project.id}/file?path=${encodeURIComponent(compile.pdf)}`} title={path} /></div> : <Empty><FileText size={30} /><p>{compile?.error || '编译 LaTeX 后显示真实 PDF。'}</p></Empty>}<p className="rw-muted">段落级 PDF 定位尚不可用；蓝色大纲标记在准确的源码阅读模式中显示。</p>{compile?.log && <details className="rw-card"><summary>编译日志 · {compile.status}</summary><pre className="rw-log">{compile.log}</pre></details>}</div>}
    {mode === 'read' && <PaperOutline doc={doc} reader={reader} />}
    </>}
    {selectedText && <PaperRevision project={project} selected={selectedText} onClose={() => setSelectedText(null)} onApplied={accept} />}
  </div>;
}

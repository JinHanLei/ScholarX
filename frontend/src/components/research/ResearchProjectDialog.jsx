import React, { useEffect, useRef, useState } from 'react';
import { FolderOpen, LockKeyhole, X } from 'lucide-react';
import { request, Field } from './shared.jsx';

export default function ResearchProjectDialog({ project, projects, creating, onSwitch, onClose, onSaved, onTransfer, children }) {
  const dialog = useRef(null);
  const nameInput = useRef(null);
  const [name, setName] = useState(project?.name || '');
  const [description, setDescription] = useState(project?.settings?.description || '');
  const [pythonPath, setPythonPath] = useState(project?.settings?.python_executable || '');
  const [rules, setRules] = useState(project?.settings?.writing_rules || '');
  const [restricted, setRestricted] = useState(project?.settings?.restrict_to_project !== false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    nameInput.current?.focus();
    return () => element.close();
  }, []);
  const close = () => { if (!saving) onClose(); };
  const save = async (event) => {
    event.preventDefault();
    if (saving || !name.trim()) return;
    setSaving(true); setError('');
    try {
      const result = await request(creating ? '/projects' : `/projects/${project.id}`, {
        method: creating ? 'POST' : 'PATCH',
        body: { name: name.trim(), settings: { ...project?.settings, description: description.trim(), python_executable: pythonPath.trim(), writing_rules: rules, restrict_to_project: restricted } },
      });
      onSaved(result.project);
    } catch (err) { setError(err.message || '保存失败，请重试。'); }
    finally { setSaving(false); }
  };
  return <dialog ref={dialog} className="rw-project-dialog" aria-labelledby="rw-project-dialog-title" aria-describedby="rw-project-dialog-description"
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => { if (event.target === dialog.current) { const rect = dialog.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); } }}>
    <div className="rw-dialog-heading">
      <div><h2 id="rw-project-dialog-title">{creating ? '开启新的探索' : '项目设置'}</h2><p id="rw-project-dialog-description">一篇论文，一个文件夹，一个项目。</p></div>
      <button type="button" className="rw-icon" aria-label="关闭项目弹窗" disabled={saving} onClick={close}><X size={19} /></button>
    </div>
    <form onSubmit={save} className="rw-project-form">
      <div className="rw-dialog-body">
        {!creating && projects.length > 1 && <div className="rw-dialog-switch"><span>切换项目</span><select aria-label="当前项目" value={project.id} disabled={saving} onChange={(event) => onSwitch(event.target.value)}>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>}
        <fieldset disabled={saving}>
          <Field label="项目名"><input ref={nameInput} required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} placeholder="为这篇论文起个名字" /></Field>
          <Field label="文件夹" hint={creating ? '创建后自动分配独立文件夹，集中保存论文、代码与实验。' : '这篇论文的文件与研究记录都保存在此文件夹中。'}><div className="rw-project-folder"><FolderOpen size={16} /><input aria-label="文件夹" readOnly value={project?.root_path || '创建项目时自动建立'} title={project?.root_path} /></div></Field>
          <Field label="项目简介"><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="简单介绍研究方向、想解决的问题，或这篇论文的目标…" /></Field>
          <Field label="解释器" hint="可选，留空使用默认 Python 环境。"><input value={pythonPath} onChange={(event) => setPythonPath(event.target.value)} placeholder="例如 D:\anaconda\envs\paper\python.exe" spellCheck={false} /></Field>
          <Field label="写作规则"><textarea rows={4} value={rules} onChange={(event) => setRules(event.target.value)} placeholder="例如：使用学术英语；术语保持一致；结论须有实验或文献支持。" /></Field>
          <details className="rw-project-advanced"><summary>更多设置</summary><label className="rw-checkbox" title="对后续 Codex 指令生效；不是操作系统级目录隔离。"><input type="checkbox" checked={restricted} onChange={(event) => setRestricted(event.target.checked)} /><LockKeyhole size={13} /> 限定 Codex 工作目录</label>{children}</details>
        </fieldset>
        {error && <p className="rw-dialog-error" role="alert">{error}</p>}
      </div>
      <footer className="rw-dialog-footer"><button type="button" className="rw-project-transfer-link" disabled={saving} onClick={() => onTransfer(creating ? 'import' : 'export')}>{creating ? '导入已有项目' : '导入 / 导出项目'}</button><button type="button" disabled={saving} onClick={close}>取消</button><button className="rw-primary" type="submit" disabled={saving || !name.trim()}>{saving ? '正在保存…' : creating ? '创建项目' : '保存修改'}</button></footer>
    </form>
  </dialog>;
}

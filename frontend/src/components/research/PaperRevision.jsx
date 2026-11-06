import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Field, request } from './shared.jsx';
import useLiteratureAssist from './useLiteratureAssist.js';

export default function PaperRevision({ project, selected, onClose, onApplied }) {
  const dialog = useRef(null), input = useRef(null);
  const [instruction, setInstruction] = useState('');
  const [replacement, setReplacement] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const assist = useLiteratureAssist(project, 'revise', 'paper');
  useEffect(() => { dialog.current.showModal(); input.current.focus(); }, []);
  useEffect(() => { if (assist.task?.output) setReplacement(assist.task.output.replacement); }, [assist.task?.output]);
  const apply = async () => {
    setSaving(true); setError('');
    try { onApplied(await request(`/projects/${project.id}/paper/assist/${assist.task.session_id}/apply`, { method: 'POST', body: { replacement } })); onClose(); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  return <dialog className="paper-revision-dialog" ref={dialog} onCancel={(e) => { e.preventDefault(); if (!assist.busy && !saving) onClose(); }}>
    <header><div><small>选区修改</small><h2>这段文字，你想怎么改？</h2></div><button aria-label="关闭划词修改" disabled={assist.busy || saving} onClick={onClose}><X size={18} /></button></header>
    <div className="paper-revision-body"><Field label="选中的原文"><pre className="paper-selection-preview">{selected.text}</pre></Field>
      <Field label="修改意见"><textarea ref={input} rows={3} maxLength={4000} value={instruction} disabled={assist.busy || saving} onChange={(e) => setInstruction(e.target.value)} placeholder="例如：精简表达，强调与已有方法的区别，保留公式和引用。" /></Field>
      <div className="rw-toolbar"><button className="rw-primary" disabled={!instruction.trim() || assist.busy || saving} onClick={() => { setReplacement(''); assist.start(selected.text, { ...selected, instruction }); }}>{assist.busy ? '正在修改…' : '生成修改建议'}</button>{assist.busy && <button disabled={!assist.task?.session_id} onClick={assist.stop}>停止</button>}</div>
      {assist.task?.status === 'waiting_approval' && <p role="status">请在右侧 Codex Assistant 中查看此 Paper 会话的授权请求。</p>}
      {assist.task?.notice && <p role="status">{assist.task.notice}</p>}
      {(assist.error || error) && <p className="rw-error" role="alert">{error || assist.error}</p>}
      {assist.task?.output && <><Field label="修改预览（可继续编辑）"><textarea rows={7} value={replacement} disabled={saving} onChange={(e) => setReplacement(e.target.value)} /></Field><p>{assist.task.output.explanation}</p><button className="rw-primary" disabled={!replacement.trim() || saving || assist.busy} onClick={apply}>{saving ? '正在保存…' : '应用到选中位置'}</button></>}
    </div>
  </dialog>;
}

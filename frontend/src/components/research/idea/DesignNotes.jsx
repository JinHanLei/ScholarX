import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, FileText, Pencil } from 'lucide-react';

function excerpts(markdown) {
  const sections = [];
  let section = { title: '', lines: [] };
  for (const line of markdown.split('\n')) {
    const heading = line.match(/^#{1,6}\s+(.+)/);
    if (heading) { sections.push(section); section = { title: heading[1], lines: [] }; }
    else section.lines.push(line);
  }
  sections.push(section);
  const filled = sections.map((item) => ({ ...item, text: item.lines.join('\n').trim() })).filter((item) => item.text);
  const chosen = [
    filled.find((item) => /research.question|研究问题/i.test(item.title)),
    filled.find((item) => /核心方法|模型设计|核心假设|method|backbone/i.test(item.title)),
    filled.find((item) => /验证|实验|试验|evaluation|validation/i.test(item.title)),
  ].filter(Boolean);
  return (chosen.length ? [...new Set(chosen)] : filled.slice(0, 2)).map((item) => ({ ...item, title: /research.question/i.test(item.title) ? '研究问题' : item.title }));
}

export default function DesignNotes({ document, readOnly, editing, onEditingChange, onChange }) {
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(() => excerpts(document.description || ''), [document.description]);
  return <section className={`idea-notes ${expanded ? 'expanded' : ''}`}>
    <header><div><FileText size={16} /><h2>设计说明</h2></div><div className="idea-notes-actions">
      {!editing && document.description && <button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><ChevronDown size={13} className={expanded ? 'rotated' : ''} />{expanded ? '收起说明' : '展开说明'}</button>}
      {!readOnly && <button onClick={() => onEditingChange(!editing)}><Pencil size={13} />{editing ? '完成说明' : '编辑说明'}</button>}
    </div></header>
    {editing && !readOnly ? <><label>构想名称<input aria-label="Idea 名称" value={document.name} onChange={(e) => onChange((doc) => ({ ...doc, name: e.target.value }))} /></label><textarea aria-label="模型设计说明" placeholder="研究问题、核心假设、模块职责、训练目标与实验设置……支持 Markdown。" rows={7} value={document.description} onChange={(e) => onChange((doc) => ({ ...doc, description: e.target.value }))} /></> : !document.description ? <p className="idea-placeholder">补充为什么这样设计，以及希望通过实验验证什么。</p> : expanded ? <div className="idea-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{document.description}</ReactMarkdown></div> : <div className="idea-notes-excerpts">
      {summary.map((item, index) => <div key={index}>{item.title && <h3>{item.title}</h3>}<div className="idea-excerpt-text"><ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown></div></div>)}
    </div>}
  </section>;
}

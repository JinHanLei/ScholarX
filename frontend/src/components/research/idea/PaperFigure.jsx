import React, { useEffect, useState } from 'react';
import { Image, Maximize2 } from 'lucide-react';
import ResearchModal from '../ResearchModal.jsx';
import { figureSvg } from './paperFigure.js';
import PptxFigure from './PptxFigure.jsx';

export default function PaperFigure({ figure, projectId, ideaId, stale = false, historical = false }) {
  const [src, setSrc] = useState(''), [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!figure || figure.presentation) { setSrc(''); return; }
    const url = URL.createObjectURL(new Blob([figureSvg(figure)], { type: 'image/svg+xml' }));
    setSrc(url); return () => URL.revokeObjectURL(url);
  }, [figure]);
  return <section className="idea-paper-figure" aria-label="论文模型图">
    <header><div><span className="idea-figure-kicker">METHOD</span><h2>{figure?.title || '论文模型图'}</h2></div>{figure && <button onClick={() => setExpanded(true)}><Maximize2 size={13} />放大查看</button>}</header>
    {stale && <p className="idea-figure-stale" role="status">{historical ? '这条历史记录中的模型图当时尚未同步，完整方案以设计快照为准。' : '方案已更新，模型图待同步。请在 Codex 中完成改图后再保存为版本。'}</p>}
    {figure && (src || figure.presentation) ? <figure>{figure.presentation ? <PptxFigure projectId={projectId} ideaId={ideaId} figure={figure} /> : <img src={src} alt={figure.title || '论文模型图'} />}<figcaption>{figure.caption}</figcaption></figure> : <div className="idea-paper-empty"><Image size={30} strokeWidth={1.3} /><h3>{historical ? '此历史记录尚未附论文模型图' : '让讨论中的方法成为一张论文图'}</h3><p>{historical ? '原始方案与实验记录已保留。' : '在 Codex 中确定方法后，模型图和这次修改的研究记录会同步出现在这里。'}</p></div>}
    {expanded && figure && <ResearchModal title={figure.title || '论文模型图'} onClose={() => setExpanded(false)} wide className="idea-paper-dialog">{figure.presentation ? <PptxFigure projectId={projectId} ideaId={ideaId} figure={figure} large /> : <img src={src} alt={figure.title || '论文模型图'} />}<p>{figure.caption}</p></ResearchModal>}
  </section>;
}

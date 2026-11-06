import React, { useEffect, useRef, useState } from 'react';

export function pptxUrl(projectId, ideaId, presentation) {
  return `${import.meta.env.VITE_API_URL || '/api'}/projects/${encodeURIComponent(projectId)}/ideas/${encodeURIComponent(ideaId)}/pptx/${presentation.sha256}`;
}

export async function downloadPptx(projectId, ideaId, presentation) {
  const response = await fetch(pptxUrl(projectId, ideaId, presentation));
  if (!response.ok) throw new Error('无法读取原始 PPTX 文件');
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = presentation.name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PptxFigure({ projectId, ideaId, figure, large = false }) {
  const host = useRef(null), [status, setStatus] = useState('正在加载第一张幻灯片…');
  const source = pptxUrl(projectId, ideaId, figure.presentation);
  useEffect(() => {
    const abort = new AbortController(); let viewer, live = true;
    setStatus('正在加载第一张幻灯片…');
    const load = async () => {
      try {
        const [module, response] = await Promise.all([import('@aiden0z/pptx-renderer'), fetch(source, { signal: abort.signal })]);
        if (!response.ok) throw new Error('原始 PPTX 文件不可用');
        const buffer = await response.arrayBuffer();
        if (!live) return;
        // PDF/EMF fallback is deliberately disabled; the app's PDF reader stays on its existing version.
        viewer = new module.PptxViewer(host.current, { fitMode: 'contain', externalMedia: 'block', pdfjs: false });
        await viewer.open(buffer, { renderMode: 'slide', lazySlides: true, lazyMedia: true, zipLimits: module.RECOMMENDED_ZIP_LIMITS, signal: abort.signal });
        if (live) setStatus('');
        else viewer.destroy();
      } catch (e) { if (live) setStatus(`第一张预览失败：${e.message}。仍可导出原始 PPT。`); }
    };
    void load();
    return () => { live = false; abort.abort(); viewer?.destroy(); };
  }, [source]);
  return <div className={`idea-pptx-preview ${large ? 'large' : ''}`}>
    {status && <p role="status">{status}</p>}
    <div ref={host} className="idea-pptx-slide" aria-label="PPT 模型图（第 1 张）" style={{ aspectRatio: `${figure.width}/${figure.height}`, maxWidth: large ? '100%' : `${480 * figure.width / figure.height}px` }} />
  </div>;
}

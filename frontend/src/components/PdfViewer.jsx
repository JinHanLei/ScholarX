import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText } from 'lucide-react';
import { API } from '../utils/api.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PDF_SIDE_GUTTER = 36;
const PDF_MIN_VIEWPORT_WIDTH = 320;
const DEFAULT_PDF_COPY = { workbench: { pdfLoading: '正在加载 PDF...', pdfLoadError: 'PDF 加载失败' } };

function normalizePdfSearchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function pdfSearchNeedles(value) {
  const normalized = normalizePdfSearchText(value);
  if (!normalized) return [];
  const starts = [0, Math.floor(normalized.length * 0.25), Math.floor(normalized.length * 0.5)];
  return [...new Set(starts.map((start) => normalized.slice(start, start + 220)).filter((item) => item.length >= 28))];
}

function clearPdfTargetHighlights(root) {
  root?.querySelectorAll?.('.pdf-js-text-hit').forEach((node) => node.classList.remove('pdf-js-text-hit'));
}

function findPdfTextMatch(root, target) {
  const needles = pdfSearchNeedles(target?.quote || target?.text || '');
  if (!root || !needles.length) return null;
  const page = Number(target?.page);
  const pageNodes = Number.isFinite(page) && page >= 1
    ? [...root.querySelectorAll(`[data-pdf-page="${page}"]`)]
    : [...root.querySelectorAll('[data-pdf-page]')];
  for (const pageNode of pageNodes) {
    const spans = [...pageNode.querySelectorAll('.pdf-js-text-layer span')];
    const normalizedSpans = spans.map((span) => normalizePdfSearchText(span.textContent));
    const joined = normalizedSpans.join('');
    if (!joined) continue;
    for (const needle of needles) {
      const matchIndex = joined.indexOf(needle);
      if (matchIndex < 0) continue;
      const matchEnd = matchIndex + needle.length;
      const hitSpans = [];
      let cursor = 0;
      spans.forEach((span, index) => {
        const textLength = normalizedSpans[index].length;
        const spanStart = cursor;
        const spanEnd = cursor + textLength;
        if (textLength && spanEnd > matchIndex && spanStart < matchEnd) hitSpans.push(span);
        cursor = spanEnd;
      });
      if (hitSpans.length) return { pageNode, hitSpans };
    }
  }
  return null;
}

function pdfFetchUrl(url) {
  if (!url) return '';
  if (url.startsWith('/')) return url;
  return `${API}/pdf/proxy?url=${encodeURIComponent(url)}`;
}

function PdfJsViewer({ text = DEFAULT_PDF_COPY, url, title, target, toolbarContainer = null }) {
  const wrapRef = useRef(null);
  const targetTimerRef = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pageBaseWidth, setPageBaseWidth] = useState(0);
  const [availableWidth, setAvailableWidth] = useState(0);

  const changeZoom = useCallback((delta) => {
    setZoom((value) => Math.max(0.5, Math.min(2.6, Number((value + delta).toFixed(2)))));
  }, []);

  const measureAvailableWidth = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wrapRect = wrap.getBoundingClientRect();
    const parentRect = wrap.parentElement?.getBoundingClientRect();
    const measuredWidth = Math.max(
      wrap.clientWidth || 0,
      wrapRect.width || 0,
      parentRect?.width || 0,
    );
    if (!measuredWidth) return;
    setAvailableWidth(Math.max(PDF_MIN_VIEWPORT_WIDTH, Math.floor(measuredWidth - PDF_SIDE_GUTTER)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setError('');
    setZoom(1);
    setPageBaseWidth(0);
    const task = pdfjsLib.getDocument({ url: pdfFetchUrl(url), isEvalSupported: false });
    task.promise
      .then(async (document) => {
        const firstPage = await document.getPage(1);
        const viewport = firstPage.getViewport({ scale: 1 });
        if (!cancelled) {
          setPdf(document);
          setPageBaseWidth(viewport.width);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || text.workbench.pdfLoadError);
      });
    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [url, text.workbench.pdfLoadError]);

  useLayoutEffect(() => {
    if (!wrapRef.current) return undefined;
    measureAvailableWidth();
    const frame = requestAnimationFrame(measureAvailableWidth);
    const lateFrame = requestAnimationFrame(() => requestAnimationFrame(measureAvailableWidth));
    const observer = new ResizeObserver(measureAvailableWidth);
    observer.observe(wrapRef.current);
    if (wrapRef.current.parentElement) observer.observe(wrapRef.current.parentElement);
    window.addEventListener('resize', measureAvailableWidth);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(lateFrame);
      observer.disconnect();
      window.removeEventListener('resize', measureAvailableWidth);
    };
  }, [measureAvailableWidth]);

  useEffect(() => {
    if (!pdf) return undefined;
    measureAvailableWidth();
    const frame = requestAnimationFrame(measureAvailableWidth);
    return () => cancelAnimationFrame(frame);
  }, [pdf, measureAvailableWidth]);

  useEffect(() => {
    if (!pdf || !target) return undefined;
    clearPdfTargetHighlights(wrapRef.current);
    const page = Number(target.page);
    const hasPage = Number.isFinite(page) && page >= 1;
    let cancelled = false;
    let attempts = 0;
    const locateTarget = () => {
      if (cancelled) return;
      attempts += 1;
      const match = findPdfTextMatch(wrapRef.current, target);
      if (match) {
        match.hitSpans.forEach((span) => span.classList.add('pdf-js-text-hit'));
        match.hitSpans[0].scrollIntoView({ block: 'center', inline: 'nearest' });
        window.setTimeout(() => {
          match.hitSpans.forEach((span) => span.classList.remove('pdf-js-text-hit'));
        }, 3600);
        return;
      }
      const pageNode = hasPage ? wrapRef.current?.querySelector?.(`[data-pdf-page="${page}"]`) : null;
      if (pageNode && attempts >= 3) {
        pageNode.scrollIntoView({ block: 'center' });
        pageNode.classList.add('citation-target-flash');
        window.setTimeout(() => pageNode.classList.remove('citation-target-flash'), 1300);
        return;
      }
      if (attempts < 24) targetTimerRef.current = window.setTimeout(locateTarget, 180);
    };
    targetTimerRef.current = window.setTimeout(locateTarget, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(targetTimerRef.current);
      clearPdfTargetHighlights(wrapRef.current);
    };
  }, [pdf, target?.page, target?.chunkId, target?.quote]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    const handleCtrlWheel = (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      changeZoom(event.deltaY > 0 ? -0.08 : 0.08);
    };
    wrap.addEventListener('wheel', handleCtrlWheel, { passive: false, capture: true });
    return () => wrap.removeEventListener('wheel', handleCtrlWheel, { capture: true });
  }, [changeZoom]);

  if (error) {
    return (
      <div className="pdf-js-state">
        <FileText size={24} />
        <strong>{text.workbench.pdfLoadError}</strong>
        <p>{error}</p>
      </div>
    );
  }

  if (!pdf) {
    return (
      <div className="pdf-js-state">
        <FileText size={24} />
        <strong>{text.workbench.pdfLoading}</strong>
      </div>
    );
  }

  const pages = Array.from({ length: pdf.numPages }, (_item, index) => index + 1);
  const minPageWidth = pageBaseWidth ? pageBaseWidth * 0.35 : PDF_MIN_VIEWPORT_WIDTH;
  const maxPageWidth = pageBaseWidth ? pageBaseWidth * 4 : PDF_MIN_VIEWPORT_WIDTH * 4;
  const targetPageWidth = Math.round(Math.max(minPageWidth, Math.min(maxPageWidth, (availableWidth || pageBaseWidth || PDF_MIN_VIEWPORT_WIDTH) * zoom)));
  const toolbar = <div className="pdf-js-toolbar">
    <span>{pdf.numPages} {toolbarContainer ? '页' : 'pages'}</span>
    <button type="button" className="icon-button" aria-label="缩小 PDF" title="缩小" disabled={zoom <= 0.5} onClick={() => changeZoom(-0.1)}>-</button>
    <strong>{Math.round(zoom * 100)}%</strong>
    <button type="button" className="icon-button" aria-label="放大 PDF" title="放大" disabled={zoom >= 2.6} onClick={() => changeZoom(0.1)}>+</button>
  </div>;
  return (
    <div
      ref={wrapRef}
      className="pdf-js-wrap"
      aria-label={title}
    >
      {toolbarContainer ? createPortal(toolbar, toolbarContainer) : toolbar}
      <div className="pdf-js-pages">
        {pages.map((pageNumber) => (
          <PdfJsPage key={`${pageNumber}-${targetPageWidth}`} pdf={pdf} pageNumber={pageNumber} targetWidth={targetPageWidth} />
        ))}
      </div>
    </div>
  );
}

function PdfJsPage({ pdf, pageNumber, targetWidth }) {
  const canvasRef = useRef(null);
  const [textItems, setTextItems] = useState([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [renderScale, setRenderScale] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let renderTask = null;
    setTextItems([]);
    setError('');

    async function renderPage() {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = targetWidth ? targetWidth / baseViewport.width : 1;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;
        const outputScale = Math.max(2, Math.min(window.devicePixelRatio || 1, 4));
        const cssWidth = Math.round(viewport.width);
        const cssHeight = Math.round(viewport.height);
        const renderViewport = page.getViewport({ scale: scale * outputScale });
        canvas.width = Math.ceil(renderViewport.width);
        canvas.height = Math.ceil(renderViewport.height);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.imageSmoothingEnabled = false;
        setSize({ width: cssWidth, height: cssHeight });
        setRenderScale(outputScale);
        renderTask = page.render({
          canvasContext: context,
          viewport: renderViewport,
        });
        const [textContent] = await Promise.all([page.getTextContent(), renderTask.promise]);
        if (cancelled) return;
        const items = (textContent.items || [])
          .filter((item) => String(item.str || '').trim())
          .map((item, index) => {
            const transform = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const angle = Math.atan2(transform[1], transform[0]);
            const fontHeight = Math.hypot(transform[2], transform[3]) || 10;
            const left = transform[4];
            const top = transform[5] - fontHeight;
            return {
              id: `${pageNumber}-${index}`,
              text: item.str,
              left,
              top,
              width: Math.max(item.width * scale, 1),
              height: fontHeight,
              angle,
              fontName: item.fontName,
              hasEOL: Boolean(item.hasEOL),
            };
          });
        setTextItems(items);
      } catch (err) {
        if (!cancelled && err?.name !== 'RenderingCancelledException') {
          setError(err?.message || 'Page render failed');
        }
      }
    }

    renderPage();
    return () => {
      cancelled = true;
      if (renderTask) renderTask.cancel();
    };
  }, [pdf, pageNumber, targetWidth]);

  return (
    <section className="pdf-js-page" data-pdf-page={pageNumber} style={{ width: size.width || undefined, minHeight: size.height || 520 }}>
      <canvas ref={canvasRef} />
      <div className="pdf-js-text-layer" style={{ width: size.width, height: size.height }}>
        {textItems.map((item) => (
          <span
            key={item.id}
            style={{
              left: item.left,
              top: item.top,
              width: item.width,
              height: item.height,
              fontSize: item.height,
              transform: `rotate(${item.angle}rad)`,
              fontFamily: item.fontName || 'sans-serif',
            }}
          >
            {item.text}{item.hasEOL ? '\n' : ' '}
          </span>
        ))}
      </div>
      <span className="pdf-js-page-number" title={`render ${renderScale}x`}>{pageNumber}</span>
      {error && <span className="pdf-js-page-error">{error}</span>}
    </section>
  );
}

function PdfTranslationPopup({ text, popup }) {
  const style = popup.x && popup.y
    ? { left: `${popup.x}px`, top: `${popup.y}px` }
    : {};
  return (
    <section
      className={`pdf-translation-popup ${popup.x && popup.y ? 'anchored' : ''}`}
      style={style}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
    >
      <div className="translation-output">
        {popup.error ? (
          <p className="error-text">{popup.error}</p>
        ) : popup.content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{popup.content}</ReactMarkdown>
        ) : (
          <p className="typing-dot">{text.workbench.translating}</p>
        )}
      </div>
    </section>
  );
}

export { PdfJsViewer, PdfTranslationPopup };

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import { makeCitationId, parseCitationId } from '../utils/citations.js';
import { displayPaperTitle, displayVenue } from '../utils/papers.js';

const MORE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12a2 2 0 1 1 4 0 2 2 0 0 1-4 0Zm5 0a2 2 0 1 1 4 0 2 2 0 0 1-4 0Zm5 0a2 2 0 1 1 4 0 2 2 0 0 1-4 0Z" fill="currentColor"/></svg>';
const TABLE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4V5Zm2 2v3h5V7H6Zm7 0v3h5V7h-5Zm5 5h-5v5h5v-5Zm-7 5v-5H6v5h5Z" fill="currentColor"/></svg>';
const SOURCE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18-6-6 6-6 1.4 1.4L5.8 12l4.6 4.6L9 18Zm6 0-1.4-1.4 4.6-4.6-4.6-4.6L15 6l6 6-6 6Z" fill="currentColor"/></svg>';
const CITATION_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><text x="12" y="12.5" fill="none" stroke="currentColor" stroke-width="1.1" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="900" text-anchor="middle" dominant-baseline="middle">”</text></svg>';
const CITATION_MARKER_RE = /\[\[ref:([^\]\s]+)\]\]/g;
const CITATION_TAG_RE = /<span\b(?=[^>]*\bclass=["'][^"']*\bcitation-tag\b[^"']*["'])(?=[^>]*\bdata-ref=["']([^"']+)["'])[^>]*>[\s\S]*?<\/span>/g;
const CITATION_LINK_RE = /\[[^\]]*?\]\(#easyref-citation:([^\s)"']+)(?:\s+["'][^"']*["'])?\)/g;
const CITATION_ANCHOR_RE = /<a\b(?=[^>]*\bhref=["']#easyref-citation:([^"']+)["'])[^>]*>[\s\S]*?<\/a>/g;
const CITATION_IMAGE_SRC = '/easyref-citation.svg';
const CITATION_IMAGE_RE = /!\[[^\]]*?\]\((?:https?:\/\/[^/\s)"']+)?\/easyref-citation\.svg\?ref=([^\s)"']+)(?:\s+["'][^"']*["'])?\)/g;
const CITATION_IMAGE_TAG_RE = /<img\b(?=[^>]*\bsrc=["'][^"']*\/easyref-citation\.svg\?ref=([^"']+)["'])[^>]*>/g;
function markdownTable(rows, cols) {
  const headers = Array.from({ length: cols }, (_item, index) => `列 ${index + 1}`);
  const divider = Array.from({ length: cols }, () => '---');
  const body = Array.from({ length: Math.max(rows - 1, 1) }, () => Array.from({ length: cols }, () => ' ').join(' | '));
  return `\n| ${headers.join(' | ')} |\n| ${divider.join(' | ')} |\n${body.map((row) => `| ${row} |`).join('\n')}\n`;
}

function insertMarkdown(vditor, markdown) {
  const editorMarkdown = citationMarkersToEditorMarkdown(markdown, {});
  if (typeof vditor?.insertMD === 'function') {
    vditor.insertMD(editorMarkdown);
    return true;
  }
  if (typeof vditor?.insertValue === 'function') {
    vditor.insertValue(editorMarkdown);
    return true;
  }
  const activeElement = document.activeElement;
  if (activeElement?.isContentEditable) {
    document.execCommand('insertText', false, editorMarkdown);
    return true;
  }
  return false;
}

function decodeCitationRef(refId) {
  try {
    return decodeURIComponent(String(refId || ''));
  } catch (_error) {
    return String(refId || '');
  }
}

function stripEditorChrome(markdown) {
  return String(markdown || '')
    .replace(CITATION_IMAGE_RE, (_match, refId) => `[[ref:${decodeCitationRef(refId)}]]`)
    .replace(CITATION_IMAGE_TAG_RE, (_match, refId) => `[[ref:${decodeCitationRef(refId)}]]`)
    .replace(CITATION_LINK_RE, (_match, refId) => `[[ref:${decodeCitationRef(refId)}]]`)
    .replace(CITATION_ANCHOR_RE, (_match, refId) => `[[ref:${decodeCitationRef(refId)}]]`)
    .replace(CITATION_TAG_RE, '[[ref:$1]]')
    .replace(/<span\b(?=[^>]*\bclass=["'][^"']*vditor-citation-token[^"']*["'])(?=[^>]*\bdata-ref-id=["']([^"']+)["'])[^>]*>[\s\S]*?<\/span>/g, '[[ref:$1]]')
    .replace(/<select\s+class=["']vditor-code-language-select["'][\s\S]*?<\/select>/g, '');
}

function escapeMarkdownTitle(value) {
  return String(value || '引用文献')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\s+/g, ' ')
    .trim();
}

function citationEditorLink(refId, citationSources = {}) {
  const source = citationSources?.[refId] || {};
  const title = escapeMarkdownTitle(source.title || '引用文献');
  return `![cite](${CITATION_IMAGE_SRC}?ref=${encodeURIComponent(refId)} "${title}")`;
}

function citationMarkersToEditorMarkdown(markdown, citationSources = {}) {
  return String(markdown || '').replace(CITATION_MARKER_RE, (_match, refId) => citationEditorLink(refId, citationSources));
}

function escapeHintHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function caretRectFromRange(range) {
  const rect = range.getClientRects?.()[0] || range.getBoundingClientRect?.();
  if (rect && (rect.width || rect.height)) return rect;
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  marker.style.cssText = 'display:inline-block;width:0;height:1em;overflow:hidden;';
  const clone = range.cloneRange();
  clone.insertNode(marker);
  const markerRect = marker.getBoundingClientRect();
  marker.remove();
  return markerRect;
}

function caretSnapshot(mount, referenceElement) {
  const selection = window.getSelection?.();
  if (!selection || !selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const root = mount?.querySelector?.('.vditor-wysiwyg, .vditor-ir');
  if (!root || !root.contains(range.startContainer)) return null;

  const beforeRange = range.cloneRange();
  beforeRange.selectNodeContents(root);
  beforeRange.setEnd(range.startContainer, range.startOffset);

  const afterRange = range.cloneRange();
  afterRange.selectNodeContents(root);
  afterRange.setStart(range.endContainer, range.endOffset);

  const rect = caretRectFromRange(range);
  const referenceRect = referenceElement?.getBoundingClientRect?.() || mount.getBoundingClientRect();
  return {
    before: beforeRange.toString(),
    after: afterRange.toString(),
    position: {
      left: Math.max(18, rect.right - referenceRect.left + 2),
      top: Math.max(44, rect.top - referenceRect.top + 1),
    },
  };
}

function sourceTool(language, onToggleSource) {
  return {
    name: 'source-toggle',
    icon: SOURCE_ICON,
    tip: language === 'zh_CN' ? '切换源代码' : 'Switch source',
    click: () => onToggleSource?.(),
  };
}

function tableTool(language, onOpenTableDialog, getEditor) {
  return {
    name: 'table-grid',
    icon: TABLE_ICON,
    tip: language === 'zh_CN' ? '插入表格' : 'Insert table',
    click: (_event, vditor) => onOpenTableDialog?.(
      typeof vditor?.insertMD === 'function' || typeof vditor?.insertValue === 'function'
        ? vditor
        : getEditor?.(),
    ),
  };
}

function citationTool(language, onOpenCitationPicker) {
  return {
    name: 'citation-reference',
    icon: CITATION_ICON,
    tip: language === 'zh_CN' ? '插入文献' : 'Insert Citation',
    click: () => onOpenCitationPicker?.(),
  };
}

function editorToolbar(language, compact, onToggleSource, onOpenTableDialog, getEditor, onOpenCitationPicker) {
  const leadingTools = [sourceTool(language, onToggleSource), '|'];
  const tuckedTools = [
    'list', 'ordered-list', 'check', 'quote',
    'link', tableTool(language, onOpenTableDialog, getEditor), 'code', 'inline-code',
    citationTool(language, onOpenCitationPicker), 'fullscreen',
  ];
  if (compact) {
    return [
      ...leadingTools,
      'undo', 'redo', '|',
      'headings', 'bold', 'italic', 'strike',
      { name: 'more-tools', icon: MORE_ICON, toolbar: tuckedTools },
    ];
  }
  return [
    ...leadingTools,
    'undo', 'redo', '|',
    'headings', 'bold', 'italic', 'strike', '|',
    'list', 'ordered-list', 'check', 'quote', '|',
    'link', tableTool(language, onOpenTableDialog, getEditor), 'code', 'inline-code', '|',
    citationTool(language, onOpenCitationPicker), 'fullscreen',
  ];
}

const VditorMarkdownEditor = forwardRef(function VditorMarkdownEditor({
  value,
  onChange,
  language = 'zh_CN',
  onActivity,
  onKeyDown,
  onToggleSource,
  citationPapers = [],
  citationSources = {},
  onOpenCitation,
  onOpenCitationPicker,
}, ref) {
  const mountRef = useRef(null);
  const editorRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const onActivityRef = useRef(onActivity);
  const onKeyDownRef = useRef(onKeyDown);
  const onToggleSourceRef = useRef(onToggleSource);
  const onOpenCitationRef = useRef(onOpenCitation);
  const onOpenCitationPickerRef = useRef(onOpenCitationPicker);
  const citationPapersRef = useRef(citationPapers);
  const citationSourcesRef = useRef(citationSources);
  const currentValueRef = useRef(stripEditorChrome(value || ''));
  const lastSelectionRangeRef = useRef(null);
  const syncingRef = useRef(false);
  const [compactToolbar, setCompactToolbar] = useState(false);
  const [tableDialog, setTableDialog] = useState({ open: false, rows: 3, cols: 4, editor: null });

  function editorEditableRoot() {
    return mountRef.current?.querySelector?.('.vditor-wysiwyg, .vditor-ir');
  }

  function captureEditorSelection() {
    const root = editorEditableRoot();
    const selection = window.getSelection?.();
    if (!root || !selection?.rangeCount) return false;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return false;
    lastSelectionRangeRef.current = range.cloneRange();
    return true;
  }

  function restoreEditorSelection() {
    const root = editorEditableRoot();
    const range = lastSelectionRangeRef.current;
    const selection = window.getSelection?.();
    if (!root || !range || !selection) return false;
    try {
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return false;
      editorRef.current?.focus?.();
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function captureEditorScroll() {
    const roots = mountRef.current?.querySelectorAll?.('.vditor-content, .vditor-wysiwyg, .vditor-ir, .vditor-reset') || [];
    return Array.from(roots)
      .filter((root) => root.scrollTop || root.scrollLeft)
      .map((root) => ({ root, top: root.scrollTop, left: root.scrollLeft }));
  }

  function restoreEditorScroll(snapshot) {
    if (!snapshot?.length) return;
    const restore = () => {
      snapshot.forEach(({ root, top, left }) => {
        if (!root?.isConnected) return;
        root.scrollTop = top;
        root.scrollLeft = left;
      });
    };
    restore();
    requestAnimationFrame(restore);
    window.setTimeout(restore, 40);
    window.setTimeout(restore, 140);
  }

  function syncEditorValue() {
    const rawValue = editorRef.current?.getValue?.();
    const nextValue = stripEditorChrome(rawValue);
    if (typeof nextValue !== 'string') return;
    const editorValue = citationMarkersToEditorMarkdown(nextValue, citationSourcesRef.current);
    if (rawValue !== editorValue) {
      const scrollSnapshot = captureEditorScroll();
      editorRef.current?.setValue?.(editorValue, true);
      restoreEditorScroll(scrollSnapshot);
    }
    currentValueRef.current = nextValue;
    if (!syncingRef.current) {
      onChangeRef.current(nextValue);
      onActivityRef.current?.();
    }
  }

  function scheduleEditorSync() {
    syncEditorValue();
    window.setTimeout(syncEditorValue, 0);
  }

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onActivityRef.current = onActivity;
  }, [onActivity]);

  useEffect(() => {
    onKeyDownRef.current = onKeyDown;
  }, [onKeyDown]);

  useEffect(() => {
    onToggleSourceRef.current = onToggleSource;
  }, [onToggleSource]);

  useEffect(() => {
    onOpenCitationPickerRef.current = onOpenCitationPicker;
  }, [onOpenCitationPicker]);

  useEffect(() => {
    onOpenCitationRef.current = onOpenCitation;
  }, [onOpenCitation]);

  useEffect(() => {
    citationPapersRef.current = citationPapers;
  }, [citationPapers]);

  useEffect(() => {
    citationSourcesRef.current = citationSources || {};
  }, [citationSources]);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus?.(),
    getValue: () => stripEditorChrome(editorRef.current?.getValue?.() || currentValueRef.current || ''),
    getSelection: () => editorRef.current?.getSelection?.() || '',
    getCursorPosition: () => editorRef.current?.getCursorPosition?.() || { left: 0, top: 0 },
    getCaretSnapshot: (referenceElement) => caretSnapshot(mountRef.current, referenceElement),
    insertMD: (markdown) => {
      const editor = editorRef.current;
      if (!editor?.insertMD) return false;
      const scrollSnapshot = captureEditorScroll();
      restoreEditorSelection();
      editor.insertMD(citationMarkersToEditorMarkdown(markdown, citationSourcesRef.current));
      captureEditorSelection();
      restoreEditorScroll(scrollSnapshot);
      return true;
    },
    scrollToBottom: () => {
      const roots = mountRef.current?.querySelectorAll?.('.vditor-wysiwyg, .vditor-ir, .vditor-content, .vditor-reset') || [];
      roots.forEach((root) => {
        root.scrollTop = root.scrollHeight;
      });
    },
  }), []);

  useEffect(() => {
    if (!mountRef.current) return undefined;
    const mount = mountRef.current;
    const updateToolbarMode = () => {
      const toolbar = mount.querySelector('.vditor-toolbar');
      if (!toolbar) {
        setCompactToolbar(false);
        return;
      }
      const shouldCompact = toolbar.scrollWidth > toolbar.clientWidth + 4;
      setCompactToolbar((current) => (current === shouldCompact ? current : shouldCompact));
    };
    window.setTimeout(updateToolbarMode, 0);
    const observer = new ResizeObserver(updateToolbarMode);
    observer.observe(mount);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!mountRef.current) return undefined;

    const editor = new Vditor(mountRef.current, {
      value: citationMarkersToEditorMarkdown(currentValueRef.current, citationSourcesRef.current),
      mode: 'wysiwyg',
      lang: language,
      height: '100%',
      width: '100%',
      minHeight: 320,
      placeholder: language === 'zh_CN' ? '开始写作...' : 'Start writing...',
      cdn: '/vditor',
      cache: { enable: false },
      counter: { enable: true, type: 'markdown' },
      toolbar: editorToolbar(
        language,
        compactToolbar,
        () => onToggleSourceRef.current?.(),
        (targetEditor) => setTableDialog({ open: true, rows: 3, cols: 4, editor: targetEditor }),
        () => editorRef.current,
        () => {
          captureEditorSelection();
          onOpenCitationPickerRef.current?.();
        },
      ),
      toolbarConfig: { pin: true },
      outline: { enable: false, position: 'left' },
      preview: {
        mode: 'editor',
        delay: 300,
        maxWidth: 920,
        markdown: {
          codeBlockPreview: true,
          mathBlockPreview: true,
          sanitize: true,
        },
        math: { engine: 'KaTeX' },
      },
      hint: {
        delay: 120,
        extend: [{
          key: '[[',
          hint: (value) => {
            const query = String(value || '').replace(/^\[\[/, '').toLowerCase().trim();
            return (citationPapersRef.current || [])
              .filter((paper) => {
                if (!query) return true;
                return `${displayPaperTitle(paper)} ${displayVenue(paper).label} ${paper.pub_year || ''}`.toLowerCase().includes(query);
              })
              .slice(0, 12)
              .map((paper) => ({
                html: `<div class="vditor-citation-hint"><strong>${escapeHintHtml(displayPaperTitle(paper))}</strong><span>${escapeHintHtml([paper.pub_year, displayVenue(paper).label].filter(Boolean).join(' · '))}</span></div>`,
                value: citationEditorLink(makeCitationId({ paperId: paper.id }), citationSourcesRef.current),
              }));
          },
        }],
      },
      input: (nextValue) => {
        const cleanValue = stripEditorChrome(nextValue);
        const editorValue = citationMarkersToEditorMarkdown(cleanValue, citationSourcesRef.current);
        currentValueRef.current = cleanValue;
        if (!syncingRef.current) {
          if (editorValue !== nextValue) {
            syncingRef.current = true;
            const scrollSnapshot = captureEditorScroll();
            window.setTimeout(() => {
              editorRef.current?.setValue?.(editorValue, true);
              restoreEditorScroll(scrollSnapshot);
              queueMicrotask(() => {
                syncingRef.current = false;
              });
            }, 0);
          }
          onChangeRef.current(cleanValue);
          onActivityRef.current?.();
        }
      },
      after: () => {
        editorRef.current = editor;
        const cleanValue = stripEditorChrome(editor.getValue());
        const editorValue = citationMarkersToEditorMarkdown(cleanValue, citationSourcesRef.current);
        if (editorValue !== editor.getValue()) {
          editor.setValue(editorValue, true);
        }
        currentValueRef.current = cleanValue;
        mountRef.current?.querySelectorAll('[data-type="more-tools"], [aria-label="更多"], [aria-label="More"]').forEach((node) => {
          node.removeAttribute('aria-label');
          node.removeAttribute('title');
        });
        window.setTimeout(() => {
          const toolbar = mountRef.current?.querySelector('.vditor-toolbar');
          if (!compactToolbar && toolbar && toolbar.scrollWidth > toolbar.clientWidth + 4) {
            setCompactToolbar(true);
          }
        }, 0);
      },
    });

    const handleKeyDown = (event) => {
      captureEditorSelection();
      onKeyDownRef.current?.(event);
    };
    const handleSelectionChange = () => captureEditorSelection();
    const handleClick = (event) => {
      captureEditorSelection();
      const tag = event.target?.closest?.('.citation-tag, img[src*="/easyref-citation.svg"]');
      if (!tag || !mount.contains(tag)) return;
      event.preventDefault();
      event.stopPropagation();
      const src = tag.getAttribute?.('src') || '';
      const refId = tag.dataset.ref || decodeCitationRef(new URL(src, window.location.origin).searchParams.get('ref') || '');
      if (!refId) return;
      const parsed = parseCitationId(refId);
      const source = citationSourcesRef.current?.[refId] || {};
      onOpenCitationRef.current?.({
        ...parsed,
        ...source,
        refId,
        id: refId,
        paperId: source.paperId || parsed.paperId,
        chunkId: source.chunkId ?? parsed.chunkId,
      });
    };
    const mount = mountRef.current;
    mount.addEventListener('keydown', handleKeyDown, true);
    mount.addEventListener('keyup', handleSelectionChange, true);
    mount.addEventListener('mouseup', handleSelectionChange, true);
    mount.addEventListener('input', handleSelectionChange, true);
    mount.addEventListener('focusin', handleSelectionChange, true);
    mount.addEventListener('click', handleClick, true);

    return () => {
      mount.removeEventListener('keydown', handleKeyDown, true);
      mount.removeEventListener('keyup', handleSelectionChange, true);
      mount.removeEventListener('mouseup', handleSelectionChange, true);
      mount.removeEventListener('input', handleSelectionChange, true);
      mount.removeEventListener('focusin', handleSelectionChange, true);
      mount.removeEventListener('click', handleClick, true);
      editorRef.current = null;
      editor.destroy();
    };
  }, [language, compactToolbar]);

  useEffect(() => {
    const editor = editorRef.current;
    const nextValue = stripEditorChrome(value || '');
    if (!editor) {
      currentValueRef.current = nextValue;
      return;
    }
    if (nextValue === currentValueRef.current) return;

    syncingRef.current = true;
    currentValueRef.current = nextValue;
    editor.setValue(citationMarkersToEditorMarkdown(nextValue, citationSourcesRef.current), true);
    queueMicrotask(() => {
      syncingRef.current = false;
    });
  }, [value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    syncingRef.current = true;
    const scrollSnapshot = captureEditorScroll();
    editor.setValue(citationMarkersToEditorMarkdown(currentValueRef.current, citationSourcesRef.current), true);
    restoreEditorScroll(scrollSnapshot);
    queueMicrotask(() => {
      syncingRef.current = false;
    });
  }, [citationSources]);

  function confirmTableDialog(event) {
    event.preventDefault();
    const rows = Math.max(1, Math.min(20, Number(tableDialog.rows) || 1));
    const cols = Math.max(1, Math.min(12, Number(tableDialog.cols) || 1));
    insertMarkdown(tableDialog.editor || editorRef.current, markdownTable(rows, cols));
    scheduleEditorSync();
    setTableDialog((current) => ({ ...current, open: false }));
  }

  return (
    <div className="vditor-editor-wrap">
      <div ref={mountRef} className="vditor-editor-shell" />
      {tableDialog.open && (
        <div className="vditor-table-dialog-backdrop" onMouseDown={() => setTableDialog((current) => ({ ...current, open: false }))}>
          <form className="vditor-table-dialog" onSubmit={confirmTableDialog} onMouseDown={(event) => event.stopPropagation()}>
            <h3>{language === 'zh_CN' ? '插入表格' : 'Insert Table'}</h3>
            <label>
              <span>{language === 'zh_CN' ? '列' : 'Columns'}</span>
              <input
                autoFocus
                type="number"
                min="1"
                max="12"
                value={tableDialog.cols}
                onChange={(event) => setTableDialog((current) => ({ ...current, cols: event.target.value }))}
              />
            </label>
            <label>
              <span>{language === 'zh_CN' ? '行' : 'Rows'}</span>
              <input
                type="number"
                min="1"
                max="20"
                value={tableDialog.rows}
                onChange={(event) => setTableDialog((current) => ({ ...current, rows: event.target.value }))}
              />
            </label>
            <div>
              <button type="button" onClick={() => setTableDialog((current) => ({ ...current, open: false }))}>
                {language === 'zh_CN' ? '取消' : 'Cancel'}
              </button>
              <button type="submit">{language === 'zh_CN' ? '确定' : 'Confirm'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
});

export default VditorMarkdownEditor;

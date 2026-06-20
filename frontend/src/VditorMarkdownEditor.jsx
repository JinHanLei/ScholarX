import { useEffect, useRef } from 'react';
import Vditor from 'vditor';
import 'vditor/dist/index.css';

const MATH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v2H9l5 6-5 6h10v2H5l6.5-8L5 4Z" fill="currentColor"/></svg>';

export default function VditorMarkdownEditor({ value, onChange, language = 'zh_CN' }) {
  const mountRef = useRef(null);
  const editorRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const currentValueRef = useRef(value || '');
  const syncingRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!mountRef.current) return undefined;

    const editor = new Vditor(mountRef.current, {
      value: currentValueRef.current,
      mode: 'ir',
      lang: language,
      height: '100%',
      width: '100%',
      minHeight: 320,
      placeholder: language === 'zh_CN' ? '开始写作...' : 'Start writing...',
      cdn: '/vditor',
      cache: { enable: false },
      counter: { enable: true, type: 'markdown' },
      toolbar: [
        'headings', 'bold', 'italic', 'strike', '|',
        'list', 'ordered-list', 'check', 'quote', '|',
        'link', 'table', 'code', 'inline-code',
        {
          name: 'math-block',
          icon: MATH_ICON,
          tip: language === 'zh_CN' ? '插入公式块' : 'Insert math block',
          prefix: '\n$$\n',
          suffix: '\n$$\n',
        },
        '|', 'undo', 'redo', 'outline', 'fullscreen',
      ],
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
      input: (nextValue) => {
        currentValueRef.current = nextValue;
        if (!syncingRef.current) onChangeRef.current(nextValue);
      },
      after: () => {
        editorRef.current = editor;
        currentValueRef.current = editor.getValue();
      },
    });

    return () => {
      editorRef.current = null;
      editor.destroy();
    };
  }, [language]);

  useEffect(() => {
    const editor = editorRef.current;
    const nextValue = value || '';
    if (!editor) {
      currentValueRef.current = nextValue;
      return;
    }
    if (nextValue === currentValueRef.current) return;

    syncingRef.current = true;
    currentValueRef.current = nextValue;
    editor.setValue(nextValue, true);
    queueMicrotask(() => {
      syncingRef.current = false;
    });
  }, [value]);

  return <div ref={mountRef} className="vditor-editor-shell" />;
}

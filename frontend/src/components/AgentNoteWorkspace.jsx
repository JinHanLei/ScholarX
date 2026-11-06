import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  FileUp,
  Folder,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import VditorMarkdownEditor from './VditorMarkdownEditor';
import { CitationSearchModal, buildCitationSourceMap } from './CitationReference.jsx';
import { displayPaperTitle, displayVenue } from '../utils/papers.js';

function LibraryFileTree({
  text,
  files,
  activeFile,
  selectedFolderId,
  expandedFolders,
  setExpandedFolders,
  onOpenFile,
  onSelectFolder,
  onContextMenu,
  renamingFileId,
  renamingFileName,
  setRenamingFileName,
  onStartRename,
  onCommitRename,
  activeFileDirty,
}) {
  if (!files.length) return <div className="file-tree-list empty" />;
  const roots = buildFileTree(files);
  return (
    <div className="library-folder-list file-tree-list">
      <FileTreeNodes
        nodes={roots}
        activeFile={activeFile}
        selectedFolderId={selectedFolderId}
        expandedFolders={expandedFolders}
        setExpandedFolders={setExpandedFolders}
        onOpenFile={onOpenFile}
        onSelectFolder={onSelectFolder}
        onContextMenu={onContextMenu}
        renamingFileId={renamingFileId}
        renamingFileName={renamingFileName}
        setRenamingFileName={setRenamingFileName}
        onStartRename={onStartRename}
        onCommitRename={onCommitRename}
        activeFileDirty={activeFileDirty}
      />
    </div>
  );
}

function buildFileTree(files) {
  const nodes = files.map((file) => ({ ...file, children: [] }));
  const byId = new Map(nodes.map((file) => [file.id, file]));
  const roots = [];
  nodes.forEach((file) => {
    const parent = file.parent_id ? byId.get(file.parent_id) : null;
    if (parent) parent.children.push(file);
    else roots.push(file);
  });
  const sortNodes = (items) => items.sort((a, b) => {
    if (a.type === 'folder' && b.type !== 'folder') return -1;
    if (a.type !== 'folder' && b.type === 'folder') return 1;
    return String(a.name || '').localeCompare(String(b.name || ''));
  }).map((item) => ({ ...item, children: sortNodes(item.children || []) }));
  return sortNodes(roots);
}

function isMarkdownLibraryFile(file) {
  return file?.type !== 'folder' && /\.md$/i.test(file?.name || '');
}

function findFirstMarkdownFile(files) {
  const visit = (nodes) => {
    for (const file of nodes) {
      if (isMarkdownLibraryFile(file)) return file;
      if (file.children?.length) {
        const child = visit(file.children);
        if (child) return child;
      }
    }
    return null;
  };
  return visit(buildFileTree(files || []));
}

function FileTreeNodes({
  nodes,
  activeFile,
  selectedFolderId,
  expandedFolders,
  setExpandedFolders,
  onOpenFile,
  onSelectFolder,
  onContextMenu,
  renamingFileId,
  renamingFileName,
  setRenamingFileName,
  onStartRename,
  onCommitRename,
  activeFileDirty,
}) {
  return nodes.map((file) => {
    const isFolder = file.type === 'folder';
    const expanded = expandedFolders.has(file.id);
    const active = isFolder ? selectedFolderId === file.id : activeFile?.id === file.id;
    const renaming = renamingFileId === file.id;
    const dirtyMark = !isFolder && activeFile?.id === file.id
      ? <span className={`file-dirty-mark ${activeFileDirty ? 'dirty' : ''}`} />
      : null;
    const nameNode = renaming ? (
      <input
        className="file-rename-input"
        value={renamingFileName}
        autoFocus
        onChange={(event) => setRenamingFileName(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onBlur={() => onCommitRename(file, renamingFileName)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onCommitRename(file, renamingFileName);
          if (event.key === 'Escape') {
            setRenamingFileName('');
            onStartRename(null);
          }
        }}
      />
    ) : <span>{file.name}</span>;
    return (
      <div className="file-tree-node" key={file.id}>
        <div
          className={`file-tree-item ${active ? 'active' : ''}`}
          onContextMenu={(event) => onContextMenu(event, file)}
          onDoubleClick={() => onStartRename(file)}
        >
          {isFolder ? (
            <div
              className="file-tree-open"
              role="button"
              tabIndex={0}
              onClick={() => {
                if (renaming) return;
                onSelectFolder(file);
                setExpandedFolders((items) => {
                  const next = new Set(items);
                  next.has(file.id) ? next.delete(file.id) : next.add(file.id);
                  return next;
                });
              }}
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Folder size={14} />
              {nameNode}
            </div>
          ) : (
            <div
              className="file-tree-open"
              role="button"
              tabIndex={0}
              onClick={() => {
                if (!renaming) onOpenFile(file);
              }}
            >
              <FileText size={14} />
              {dirtyMark}
              {nameNode}
            </div>
          )}
        </div>
        {isFolder && expanded && Boolean(file.children?.length) && (
          <div className="file-tree-children">
            <FileTreeNodes
              nodes={file.children}
              activeFile={activeFile}
              selectedFolderId={selectedFolderId}
              expandedFolders={expandedFolders}
              setExpandedFolders={setExpandedFolders}
              onOpenFile={onOpenFile}
              onSelectFolder={onSelectFolder}
              onContextMenu={onContextMenu}
              renamingFileId={renamingFileId}
              renamingFileName={renamingFileName}
              setRenamingFileName={setRenamingFileName}
              onStartRename={onStartRename}
              onCommitRename={onCommitRename}
              activeFileDirty={activeFileDirty}
            />
          </div>
        )}
      </div>
    );
  });
}

function markdownHeadingId(text, index) {
  return `scholarx-heading-${index}-${String(text || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '') || 'section'}`;
}

function parseDocumentOutline(content) {
  const items = [];
  let headingIndex = 0;
  String(content || '').split('\n').forEach((line) => {
    const md = line.match(/^(#{1,6})\s+(.+)$/);
    const tex = line.match(/^\\(part|chapter|section|subsection|subsubsection)\*?\{(.+?)\}/);
    if (md) {
      items.push({ id: markdownHeadingId(md[2], headingIndex), level: md[1].length, title: md[2].trim() });
      headingIndex += 1;
    } else if (tex) {
      const levels = { part: 1, chapter: 1, section: 2, subsection: 3, subsubsection: 4 };
      items.push({ id: markdownHeadingId(tex[2], headingIndex), level: levels[tex[1]] || 2, title: tex[2].trim() });
      headingIndex += 1;
    }
  });
  return items;
}

function MarkdownRender({ content }) {
  let headingIndex = 0;
  const renderedContent = String(content || '').split('\n').map((line) => {
    const tex = line.match(/^\\(part|chapter|section|subsection|subsubsection)\*?\{(.+?)\}/);
    if (!tex) return line;
    const marks = { part: '#', chapter: '#', section: '##', subsection: '###', subsubsection: '####' };
    return `${marks[tex[1]] || '##'} ${tex[2]}`;
  }).join('\n');
  const heading = (Tag) => ({ children, ...props }) => {
    const text = React.Children.toArray(children).join('');
    const id = markdownHeadingId(text, headingIndex);
    headingIndex += 1;
    return <Tag id={id} {...props}>{children}</Tag>;
  };
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: heading('h1'),
        h2: heading('h2'),
        h3: heading('h3'),
        h4: heading('h4'),
        h5: heading('h5'),
        h6: heading('h6'),
      }}
    >
      {renderedContent}
    </ReactMarkdown>
  );
}

function FileOutline({ text, content, onJump }) {
  const outline = parseDocumentOutline(content);
  if (!outline.length) return <div className="file-outline-list empty" />;
  return (
    <div className="file-outline-list">
      {outline.map((item) => (
        <button
          key={item.id}
          style={{ '--outline-indent': `${Math.min(40, Math.max(0, item.level - 1) * 10)}px` }}
          onClick={() => onJump(item.id)}
        >
          {item.title}
        </button>
      ))}
    </div>
  );
}

function WritingWizard({
  text,
  wizard,
  busy,
  onChange,
  onNext,
  onPrevious,
  onCancel,
  onUploadPdf,
}) {
  const steps = text.agent.wizardSteps || [];
  const step = wizard?.step || 0;
  const references = wizard?.references || [];
  const missingPdfCount = references.filter((paper) => !paper.pdf_url).length;
  const citationStyles = ['GB/T 7714', 'APA', 'MLA', 'IEEE'];
  const activeTitle = [
    text.agent.wizardReferenceTitle,
    text.agent.wizardPdfTitle,
    text.agent.wizardOutlineTitle,
    text.agent.wizardCitationTitle,
    text.agent.wizardDraftTitle,
  ][step];

  return (
    <section className="writing-wizard">
      <header className="writing-wizard-head">
        <div>
          <h3>{text.agent.writingWizard}</h3>
          <p>{text.agent.writingWizardDesc}</p>
        </div>
        <button className="icon-button" onClick={onCancel} aria-label={text.agent.wizardCancel} title={text.agent.wizardCancel}>
          <X size={17} />
        </button>
      </header>
      <div className="writing-wizard-steps">
        {steps.map((label, index) => (
          <button
            key={label}
            type="button"
            className={`${index === step ? 'active' : ''} ${index < step ? 'done' : ''}`}
            onClick={() => onChange({ step: index })}
          >
            {index < step ? <Check size={14} /> : <span>{index + 1}</span>}
            {label}
          </button>
        ))}
      </div>
      <div className="writing-wizard-panel">
        <h4>{activeTitle}</h4>
        {step === 0 && (
          <>
            <div className="wizard-field-grid">
              <label>
                {text.agent.wizardDomain}
                <input value={wizard.domain || ''} onChange={(event) => onChange({ domain: event.target.value })} />
              </label>
              <label>
                {text.agent.wizardTargetVenue}
                <input value={wizard.targetVenue || ''} placeholder={text.agent.wizardNoVenue} onChange={(event) => onChange({ targetVenue: event.target.value })} />
              </label>
            </div>
            <div className="wizard-reference-list">
              {references.map((paper, index) => (
                <article key={paper.id}>
                  <strong>P{index + 1}. {displayPaperTitle(paper)}</strong>
                  <span>{displayVenue(paper).label} · {paper.pub_year || '-'}</span>
                  <em className={paper.pdf_url ? 'ready' : ''}>{paper.pdf_url ? text.agent.wizardPdfReady : text.agent.wizardMissingPdf}</em>
                </article>
              ))}
            </div>
          </>
        )}
        {step === 1 && (
          <div className="wizard-pdf-list">
            {references.map((paper) => (
              <article key={paper.id}>
                <div>
                  {paper.pdf_url ? <Check size={17} /> : <FileUp size={17} />}
                  <span>{displayPaperTitle(paper)}</span>
                </div>
                {paper.pdf_url ? (
                  <em className="ready">{text.agent.wizardPdfReady}</em>
                ) : (
                  <label className="secondary-button">
                    <Upload size={14} /> {text.agent.wizardUploadPdf}
                    <input
                      type="file"
                      accept="application/pdf"
                      onChange={(event) => {
                        onUploadPdf(paper, event.target.files?.[0]);
                        event.target.value = '';
                      }}
                    />
                  </label>
                )}
              </article>
            ))}
          </div>
        )}
        {step === 2 && (
          <textarea
            className="wizard-outline-editor"
            value={wizard.outline || ''}
            onChange={(event) => onChange({ outline: event.target.value })}
          />
        )}
        {step === 3 && (
          <div className="wizard-citation-grid">
            {citationStyles.map((style) => (
              <label key={style} className={wizard.citationStyle === style ? 'active' : ''}>
                <input
                  type="radio"
                  name="citation-style"
                  checked={wizard.citationStyle === style}
                  onChange={() => onChange({ citationStyle: style })}
                />
                {style}
              </label>
            ))}
          </div>
        )}
        {step === 4 && (
          <div className="wizard-summary">
            <p><strong>{text.agent.wizardDomain}</strong><span>{wizard.domain}</span></p>
            <p><strong>{text.agent.wizardTargetVenue}</strong><span>{wizard.targetVenue || text.agent.wizardNoVenue}</span></p>
            <p><strong>{text.agent.references}</strong><span>{references.length}</span></p>
            <p><strong>{text.agent.wizardMissingPdf}</strong><span>{missingPdfCount}</span></p>
            <p><strong>{text.agent.wizardCitationTitle}</strong><span>{wizard.citationStyle}</span></p>
          </div>
        )}
      </div>
      <footer className="writing-wizard-actions">
        <button className="secondary-button" onClick={onPrevious} disabled={busy || step === 0}>{text.agent.wizardPrev}</button>
        <button className="primary-button" onClick={onNext} disabled={busy}>
          {step === 4 ? text.agent.wizardStart : text.agent.wizardNext}
        </button>
      </footer>
    </section>
  );
}

function AgentNoteWorkspace({
  text,
  library,
  files,
  activeFile,
  activeFileDraft,
  activeFileDirty,
  selectedFolderId,
  expandedFolders,
  setExpandedFolders,
  sidebarMode,
  setSidebarMode,
  sidebarCollapsed,
  setSidebarCollapsed,
  sourceMode,
  setSourceMode,
  editorRef,
  renamingFileId,
  renamingFileName,
  setRenamingFileName,
  onOpenFile,
  onSelectFolder,
  onContextMenu,
  onBlankContextMenu,
  onStartRename,
  onCommitRename,
  onCreateFile,
  onExportFolder,
  onClose,
  onSave,
  onInsertMarkdownTemplate,
  onChangeDraft,
  onRequestCompletion,
  papers,
  onOpenCitation,
  aiEditing,
  editorLanguage,
}) {
  const vditorEditorRef = useRef(null);
  const editorShellRef = useRef(null);
  const completionTimerRef = useRef(null);
  const completionRequestRef = useRef(0);
  const [autoCompleteEnabled, setAutoCompleteEnabled] = useState(false);
  const [completionGhost, setCompletionGhost] = useState(null);
  const [completionLoading, setCompletionLoading] = useState(false);
  const [noteSidebarWidth, setNoteSidebarWidth] = useState(156);
  const [citationPickerOpen, setCitationPickerOpen] = useState(false);
  const noteDividerDraggedRef = useRef(false);
  const citationSources = useMemo(() => buildCitationSourceMap({ papers: papers || [] }), [papers]);

  function clearCompletion() {
    completionRequestRef.current += 1;
    window.clearTimeout(completionTimerRef.current);
    setCompletionGhost(null);
    setCompletionLoading(false);
  }

  function completionSnapshot() {
    if (!activeFile || aiEditing) return null;
    const selection = window.getSelection?.();
    if (selection && !selection.isCollapsed) return null;
    if (sourceMode) {
      const textarea = editorRef.current;
      const start = textarea?.selectionStart ?? activeFileDraft.length;
      const end = textarea?.selectionEnd ?? start;
      if (start !== end) return null;
      return {
        mode: 'source',
        start,
        end,
        before: activeFileDraft.slice(0, start),
        after: activeFileDraft.slice(end),
        position: { left: 22, top: 22 },
      };
    }
    const editor = vditorEditorRef.current;
    if (!editor) return null;
    const caret = editor.getCaretSnapshot?.(editorShellRef.current);
    if (!caret) return null;
    return {
      mode: 'vditor',
      before: caret.before,
      after: caret.after,
      position: caret.position,
    };
  }

  async function triggerCompletion() {
    if (!autoCompleteEnabled || !activeFile || !onRequestCompletion) return;
    const snapshot = completionSnapshot();
    if (!snapshot) return;
    const requestId = completionRequestRef.current + 1;
    completionRequestRef.current = requestId;
    setCompletionLoading(true);
    const updateGhost = (nextText) => {
      if (completionRequestRef.current !== requestId || !autoCompleteEnabled) return;
      const cleanText = String(nextText || '').replace(/\[(?:P|p)\d+\]/g, '').trimStart();
      if (!cleanText) return;
      setCompletionGhost({ ...snapshot, text: cleanText, loading: false });
    };
    const textResult = await onRequestCompletion({
      before: snapshot.before,
      after: snapshot.after,
      documentText: snapshot.mode === 'source'
        ? `${snapshot.before}${snapshot.after}`
        : (vditorEditorRef.current?.getValue?.() || activeFileDraft),
      fileName: activeFile.name,
      onDelta: updateGhost,
    });
    if (completionRequestRef.current !== requestId || !autoCompleteEnabled || !textResult) {
      setCompletionLoading(false);
      return;
    }
    updateGhost(textResult);
    setCompletionLoading(false);
  }

  function scheduleCompletion() {
    if (!autoCompleteEnabled) return;
    completionRequestRef.current += 1;
    window.clearTimeout(completionTimerRef.current);
    setCompletionGhost(null);
    setCompletionLoading(false);
    completionTimerRef.current = window.setTimeout(triggerCompletion, 850);
  }

  function acceptCompletion() {
    if (!completionGhost?.text) return false;
    if (completionGhost.mode === 'source') {
      const start = completionGhost.start ?? activeFileDraft.length;
      const end = completionGhost.end ?? start;
      const nextDraft = `${activeFileDraft.slice(0, start)}${completionGhost.text}${activeFileDraft.slice(end)}`;
      onChangeDraft(nextDraft);
      window.setTimeout(() => {
        editorRef.current?.focus();
        const nextPosition = start + completionGhost.text.length;
        editorRef.current?.setSelectionRange(nextPosition, nextPosition);
      }, 0);
    } else {
      vditorEditorRef.current?.insertMD?.(completionGhost.text);
    }
    clearCompletion();
    return true;
  }

  function currentEditorValue() {
    return sourceMode
      ? activeFileDraft
      : (vditorEditorRef.current?.getValue?.() || activeFileDraft);
  }

  function handleSaveFile() {
    onSave(activeFileDraft);
  }

  function toggleSourceMode() {
    const nextValue = currentEditorValue();
    if (nextValue !== activeFileDraft) onChangeDraft(nextValue);
    setSourceMode((value) => !value);
  }

  function insertCitationMarker(_paper, marker) {
    if (!activeFile || !marker) return;
    if (sourceMode) {
      const textarea = editorRef.current;
      const start = textarea?.selectionStart ?? activeFileDraft.length;
      const end = textarea?.selectionEnd ?? start;
      const nextDraft = `${activeFileDraft.slice(0, start)}${marker}${activeFileDraft.slice(end)}`;
      onChangeDraft(nextDraft);
      window.setTimeout(() => {
        textarea?.focus();
        textarea?.setSelectionRange(start + marker.length, start + marker.length);
      }, 0);
    } else if (!vditorEditorRef.current?.insertMD?.(marker)) {
      onChangeDraft(`${activeFileDraft}${marker}`);
    }
    setCitationPickerOpen(false);
  }

  function startNoteSidebarDrag(event) {
    if (sidebarCollapsed) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = noteSidebarWidth;
    noteDividerDraggedRef.current = false;
    function onMove(moveEvent) {
      const delta = moveEvent.clientX - startX;
      if (Math.abs(delta) > 3) noteDividerDraggedRef.current = true;
      setNoteSidebarWidth(Math.max(118, Math.min(292, startWidth + delta)));
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function handleNoteSidebarToggle(event) {
    if (noteDividerDraggedRef.current) {
      event.preventDefault();
      noteDividerDraggedRef.current = false;
      return;
    }
    setSidebarCollapsed((value) => !value);
  }

  useEffect(() => () => window.clearTimeout(completionTimerRef.current), []);

  useEffect(() => {
    clearCompletion();
  }, [activeFile?.id, sourceMode, autoCompleteEnabled]);

  useEffect(() => {
    if (!activeFile || !aiEditing) return;
    const frame = requestAnimationFrame(() => {
      if (sourceMode) {
        const textarea = editorRef.current;
        if (textarea) textarea.scrollTop = textarea.scrollHeight;
        return;
      }
      vditorEditorRef.current?.scrollToBottom?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeFile?.id, activeFileDraft, sourceMode, aiEditing]);

  useEffect(() => {
    if (!activeFile) return undefined;
    const scrollEditorToBottom = () => {
      if (sourceMode) {
        const textarea = editorRef.current;
        if (textarea) textarea.scrollTop = textarea.scrollHeight;
        return;
      }
      vditorEditorRef.current?.scrollToBottom?.();
    };
    const frame = requestAnimationFrame(scrollEditorToBottom);
    const timers = [80, 220, 520, 900].map((delay) => window.setTimeout(scrollEditorToBottom, delay));
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [activeFile?.id, sourceMode]);

  return (
    <section className={`agent-note-workspace ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <div
        className="agent-note-body"
        style={{
          gridTemplateColumns: sidebarCollapsed
            ? '6px minmax(0, 1fr)'
            : `${noteSidebarWidth}px 6px minmax(0, 1fr)`,
        }}
      >
        {!sidebarCollapsed && (
          <aside className="agent-note-tree" onContextMenu={onBlankContextMenu}>
            <div className="file-sidebar-tabs compact">
              <button className={sidebarMode === 'files' ? 'active' : ''} onClick={() => setSidebarMode('files')}>{text.workbench.filesTab}</button>
              <button className={sidebarMode === 'outline' ? 'active' : ''} onClick={() => setSidebarMode('outline')}>{text.workbench.outlineTab}</button>
            </div>
            <div className="agent-note-tree-content">
              {sidebarMode === 'files' ? (
                <LibraryFileTree
                  text={text}
                  files={files}
                  activeFile={activeFile}
                  selectedFolderId={selectedFolderId}
                  expandedFolders={expandedFolders}
                  setExpandedFolders={setExpandedFolders}
                  onOpenFile={onOpenFile}
                  onSelectFolder={onSelectFolder}
                  onContextMenu={onContextMenu}
                  renamingFileId={renamingFileId}
                  renamingFileName={renamingFileName}
                  setRenamingFileName={setRenamingFileName}
                  onStartRename={onStartRename}
                  onCommitRename={onCommitRename}
                  activeFileDirty={activeFileDirty}
                />
              ) : (
                <FileOutline text={text} content={activeFileDraft} onJump={(id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
              )}
            </div>
            <div className="agent-note-sidebar-actions">
              <button
                className={`agent-note-autocomplete ${autoCompleteEnabled ? 'active' : ''}`}
                disabled={!activeFile}
                onClick={() => setAutoCompleteEnabled((value) => !value)}
                title={autoCompleteEnabled ? text.workbench.autocompleteOn : text.workbench.autocomplete}
                aria-label={autoCompleteEnabled ? text.workbench.autocompleteOn : text.workbench.autocomplete}
                aria-pressed={autoCompleteEnabled}
              >
                <Sparkles size={13} /> {text.workbench.autocomplete}
              </button>
              <button className={`agent-note-save ${activeFileDirty ? 'active' : ''}`} disabled={!activeFile} onClick={handleSaveFile} title={text.common.save}>
                <Check size={13} /> {text.common.save}
              </button>
            </div>
          </aside>
        )}
        <button
          type="button"
          className="agent-note-divider"
          onMouseDown={startNoteSidebarDrag}
          onClick={handleNoteSidebarToggle}
          aria-label={sidebarCollapsed ? text.workbench.filesTab : text.common.cancel}
        />
        <section className="agent-note-editor" ref={editorShellRef}>
          {completionGhost && (
            <section
              className={`inline-completion-ghost ${completionLoading ? 'loading' : ''}`}
              style={completionGhost?.position ? { left: completionGhost.position.left, top: completionGhost.position.top } : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={acceptCompletion}
              aria-label={text.workbench.autocompleteHint}
            >
              <div className="inline-completion-head"><span>{text.workbench.autocompleteHint}</span></div>
              {completionGhost.text && <pre>{completionGhost.text}</pre>}
            </section>
          )}
          {activeFile ? (
            <>
              {sourceMode ? (
                <>
                  <div className="agent-note-source-toolbar">
                    <button
                      type="button"
                      className="agent-note-source-toggle active"
                      disabled={!activeFile}
                      onClick={toggleSourceMode}
                      title={text.workbench.toggleEditor}
                      aria-label={text.workbench.toggleEditor}
                    >
                      {'</>'}
                    </button>
                  </div>
                  <textarea
                    ref={editorRef}
                    className="typora-editor compact"
                    value={activeFileDraft}
                    onChange={(event) => {
                      onChangeDraft(event.target.value);
                      scheduleCompletion();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Tab' && completionGhost?.text) {
                        event.preventDefault();
                        acceptCompletion();
                      }
                    }}
                    spellCheck={false}
                  />
                </>
              ) : (
                <VditorMarkdownEditor
                  ref={vditorEditorRef}
                  value={activeFileDraft}
                  onChange={onChangeDraft}
                  onActivity={scheduleCompletion}
                  onToggleSource={toggleSourceMode}
                  onKeyDown={(event) => {
                    if (event.key === 'Tab' && completionGhost?.text) {
                      event.preventDefault();
                      acceptCompletion();
                    }
                  }}
                  citationPapers={papers || []}
                  citationSources={citationSources}
                  onOpenCitation={onOpenCitation}
                  onOpenCitationPicker={() => setCitationPickerOpen(true)}
                  language={editorLanguage}
                />
              )}
            </>
          ) : (
            <div className="file-editor-empty compact">
              <FileText size={24} />
              <strong>{text.workbench.fileEmpty}</strong>
            </div>
          )}
          <div className="agent-note-counter">
            {activeFile ? activeFileDraft.length : 0}
          </div>
        </section>
      </div>
      {citationPickerOpen && (
        <CitationSearchModal
          text={text}
          papers={papers || []}
          onPick={insertCitationMarker}
          onOpen={onOpenCitation}
          onClose={() => setCitationPickerOpen(false)}
        />
      )}
    </section>
  );
}

export { AgentNoteWorkspace, WritingWizard, findFirstMarkdownFile };

import React, { useEffect, useRef, useState } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileText,
  History,
  Pencil,
  Plus,
  Puzzle,
  Send,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { AgentNoteWorkspace, WritingWizard } from './AgentNoteWorkspace.jsx';
import { CitationMarkdown, buildCitationSourceMap } from './CitationReference.jsx';
import useClickOutside from '../hooks/useClickOutside.js';
import { chatBelongsToLibrary, chatLibraryId, hasUserMessages } from '../utils/chat.js';

async function copyTextToClipboard(text) {
  const value = String(text || '');
  if (!value) return;
  try {
    await navigator.clipboard?.writeText(value);
    if (navigator.clipboard?.writeText) return;
  } catch (_error) {
    // fall through to textarea fallback
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function AgentChat({
  text,
  messages,
  busy,
  selectedCount,
  skills,
  activeSkillIds,
  onInstallSkill,
  onUninstallSkill,
  onToggleSkill,
  onSend,
  onStop,
  draft,
  setDraft,
  sessions,
  activeChatId,
  libraries,
  activeLibrary,
  collapsed,
  onSelectChat,
  onNewChat,
  editingMessageIndex,
  editingMessageDraft,
  setEditingMessageDraft,
  onEditMessage,
  onResendMessage,
  onCancelEdit,
  onDeleteMessage,
  onDeleteChat,
  onExecuteAction,
  onOpenNotes,
  onOpenPaperRef,
  onOpenCitationReference,
  papers,
  paperContextActive,
  noteOpen,
  writingWizard,
  onUpdateWritingWizard,
  onNextWritingWizardStep,
  onPreviousWritingWizardStep,
  onCancelWritingWizard,
  onUploadWizardPdf,
  noteLibrary,
  noteFiles,
  activeFile,
  activeFileDraft,
  activeFileDirty,
  selectedFileFolderId,
  expandedFileFolders,
  setExpandedFileFolders,
  fileSidebarMode,
  setFileSidebarMode,
  fileSidebarCollapsed,
  setFileSidebarCollapsed,
  fileSourceMode,
  setFileSourceMode,
  fileEditorRef,
  renamingFileId,
  renamingFileName,
  setRenamingFileName,
  onOpenFile,
  onSelectFileFolder,
  onFileContextMenu,
  onBlankFileContextMenu,
  onStartRenameFile,
  onCommitRenameFile,
  onCreateMarkdownFile,
  onExportCurrentFileFolder,
  onCloseNotes,
  onSaveActiveFile,
  onInsertMarkdownTemplate,
  onChangeActiveFileDraft,
  onRequestMarkdownCompletion,
  aiFileEditing,
  editorLanguage,
}) {
  const subtitle = paperContextActive
    ? (text.agent.currentPaperContext || '参考当前论文')
    : selectedCount
    ? `${text.agent.selectedPrefix}${selectedCount}${text.agent.selectedSuffix}`
    : activeSkillIds.length
      ? `${text.agent.skillActivePrefix}${activeSkillIds.length}${text.agent.skillActiveSuffix}`
      : text.agent.context;
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const historyActionsRef = useRef(null);
  const historyPopoverRef = useRef(null);
  const exportMenuRef = useRef(null);
  const composerTextareaRef = useRef(null);
  const messageEndRef = useRef(null);
  const hasStreamingMessage = messages.some((message) => message.streaming);
  const historySearch = historyQuery.trim().toLowerCase();
  const filteredSessions = sessions
    .filter(hasUserMessages)
    .filter((chat) => (
      !historySearch
      || (chat.title || '').toLowerCase().includes(historySearch)
      || (chat.messages || []).some((message) => String(message.content || '').toLowerCase().includes(historySearch))
    ));
  const libraryIds = new Set((libraries || []).map((library) => library.id));
  const historyGroups = (libraries || [])
    .map((library) => ({
      library,
      chats: filteredSessions.filter((chat) => chatBelongsToLibrary(chat, library.id)),
    }))
    .filter((group) => group.chats.length || !historySearch || activeLibrary?.id === group.library.id);
  const unassignedChats = filteredSessions.filter((chat) => !chatLibraryId(chat) || !libraryIds.has(chatLibraryId(chat)));
  useClickOutside([historyActionsRef, historyPopoverRef], historyOpen, () => setHistoryOpen(false));
  useClickOutside(exportMenuRef, exportMenuOpen, () => setExportMenuOpen(false));
  useEffect(() => {
    const textarea = composerTextareaRef.current;
    if (!textarea) return;
    const maxHeight = Math.max(48, Math.floor(window.innerHeight * 0.25) - 28);
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [draft, noteOpen, writingWizard]);
  useEffect(() => {
    if (noteOpen || writingWizard) return;
    const frame = requestAnimationFrame(() => {
      messageEndRef.current?.scrollIntoView({ block: 'end' });
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, busy, noteOpen, writingWizard]);
  const composerPlaceholder = noteOpen
    ? (text.agent.fileEditPlaceholder || '告诉我如何修改这个文件')
    : (text.agent.paperQuestionPlaceholder || '论文问题尽管问');

  return (
    <aside className={`agent-pane deepseek-pane ${collapsed ? 'collapsed' : ''}`}>
      <div className="deep-chat-main">
        <header className="deep-chat-header">
          <div className="deep-chat-title-row">
            <button
              className={`agent-mode-switch ${noteOpen ? 'files' : 'agent'}`}
              title={noteOpen ? text.agent.title : text.workbench.fileLibrary}
              aria-label={noteOpen ? text.agent.title : text.workbench.fileLibrary}
              disabled={!noteOpen && !noteLibrary}
              onClick={() => (noteOpen ? onCloseNotes() : onOpenNotes?.())}
            >
              {noteOpen ? <FileText size={17} /> : <Bot size={17} />}
            </button>
            <div>
              <h2>{noteOpen ? text.workbench.fileLibrary : text.agent.title}</h2>
              {!noteOpen && <p>{subtitle}</p>}
            </div>
          </div>
          {noteOpen ? (
            <div className="deep-chat-actions">
              <button className="icon-button" title={text.workbench.newMarkdown} aria-label={text.workbench.newMarkdown} onClick={onCreateMarkdownFile} disabled={!noteLibrary}>
                <Plus size={17} />
              </button>
              <div
                className="agent-export-dropdown"
                ref={exportMenuRef}
                onMouseEnter={() => {
                  if (noteLibrary) setExportMenuOpen(true);
                }}
              >
                <button
                  className="icon-button"
                  title={text.workbench.downloadZip || text.workbench.exportAll}
                  aria-label={text.workbench.downloadZip || text.workbench.exportAll}
                  onClick={() => setExportMenuOpen((value) => !value)}
                  disabled={!noteLibrary}
                >
                  <Download size={17} />
                </button>
                {exportMenuOpen && (
                  <div
                    className="agent-export-menu"
                    onMouseDown={(event) => {
                      if (event.target === event.currentTarget) setExportMenuOpen(false);
                    }}
                  >
                    {[
                      ['raw', text.workbench.downloadZipRaw || '原始 Markdown'],
                      ['apa', 'APA'],
                      ['mla', 'MLA'],
                      ['gbt', 'GB/T'],
                      ['latex', 'LaTeX'],
                    ].map(([format, label]) => (
                      <button
                        key={format}
                        type="button"
                        onClick={() => {
                          setExportMenuOpen(false);
                          onExportCurrentFileFolder?.(format);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="deep-chat-actions" ref={historyActionsRef}>
              <button className="icon-button" onClick={() => setHistoryOpen(!historyOpen)} aria-label={text.agent.history}><History size={18} /></button>
              <button className="icon-button" onClick={() => setSkillsOpen(true)} aria-label={text.agent.skills} title={text.agent.skills}><Puzzle size={18} /></button>
              <button className="icon-button" onClick={onNewChat} aria-label={text.agent.newChat}><Plus size={18} /></button>
            </div>
          )}
        </header>
        {historyOpen && (
          <section className="history-popover" ref={historyPopoverRef}>
            <input placeholder="Search" value={historyQuery} onChange={(e) => setHistoryQuery(e.target.value)} />
            <div className="chat-history-list grouped">
              {historyGroups.map(({ library, chats }) => (
                <section className="chat-history-group" key={library.id}>
                  <h3>
                    <span>{library.name}</span>
                    <small>{chats.length}</small>
                  </h3>
                  {chats.length ? chats.map((chat) => (
                    <div className={`chat-history-item ${chat.id === activeChatId ? 'active' : ''}`} key={chat.id}>
                      <button
                        className="chat-history-open"
                        onClick={() => {
                          onSelectChat(chat);
                          setHistoryOpen(false);
                        }}
                      >
                        {chat.title || text.agent.newChat}
                      </button>
                      <button className="chat-history-delete" title={text.agent.deleteChat} aria-label={text.agent.deleteChat} onClick={() => onDeleteChat(chat.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )) : (
                    <div className="chat-history-empty">{text.agent.emptyLibraryHistory}</div>
                  )}
                </section>
              ))}
              {unassignedChats.length > 0 && (
                <section className="chat-history-group">
                  <h3>
                    <span>{text.agent.unassignedHistory}</span>
                    <small>{unassignedChats.length}</small>
                  </h3>
                  {unassignedChats.map((chat) => (
                    <div className={`chat-history-item ${chat.id === activeChatId ? 'active' : ''}`} key={chat.id}>
                      <button
                        className="chat-history-open"
                        onClick={() => {
                          onSelectChat(chat);
                          setHistoryOpen(false);
                        }}
                      >
                        {chat.title || text.agent.newChat}
                      </button>
                      <button className="chat-history-delete" title={text.agent.deleteChat} aria-label={text.agent.deleteChat} onClick={() => onDeleteChat(chat.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </section>
              )}
            </div>
          </section>
        )}
        {skillsOpen && (
          <SkillModal
            text={text}
            skills={skills}
            activeSkillIds={activeSkillIds}
            onInstall={onInstallSkill}
            onUninstall={onUninstallSkill}
            onToggle={onToggleSkill}
            onClose={() => setSkillsOpen(false)}
          />
        )}
        {noteOpen ? (
          <AgentNoteWorkspace
            text={text}
            library={noteLibrary}
            files={noteFiles}
            activeFile={activeFile}
            activeFileDraft={activeFileDraft}
            activeFileDirty={activeFileDirty}
            selectedFolderId={selectedFileFolderId}
            expandedFolders={expandedFileFolders}
            setExpandedFolders={setExpandedFileFolders}
            sidebarMode={fileSidebarMode}
            setSidebarMode={setFileSidebarMode}
            sidebarCollapsed={fileSidebarCollapsed}
            setSidebarCollapsed={setFileSidebarCollapsed}
            sourceMode={fileSourceMode}
            setSourceMode={setFileSourceMode}
            editorRef={fileEditorRef}
            renamingFileId={renamingFileId}
            renamingFileName={renamingFileName}
            setRenamingFileName={setRenamingFileName}
            onOpenFile={onOpenFile}
            onSelectFolder={onSelectFileFolder}
            onContextMenu={onFileContextMenu}
            onBlankContextMenu={onBlankFileContextMenu}
            onStartRename={onStartRenameFile}
            onCommitRename={onCommitRenameFile}
            onCreateFile={onCreateMarkdownFile}
            onExportFolder={onExportCurrentFileFolder}
            onClose={onCloseNotes}
            onSave={onSaveActiveFile}
            onInsertMarkdownTemplate={onInsertMarkdownTemplate}
            onChangeDraft={onChangeActiveFileDraft}
            onRequestCompletion={onRequestMarkdownCompletion}
            papers={papers}
            onOpenCitation={onOpenCitationReference}
            aiEditing={aiFileEditing}
            editorLanguage={editorLanguage}
          />
        ) : writingWizard ? (
          <WritingWizard
            text={text}
            wizard={writingWizard}
            busy={busy || aiFileEditing}
            onChange={onUpdateWritingWizard}
            onNext={onNextWritingWizardStep}
            onPrevious={onPreviousWritingWizardStep}
            onCancel={onCancelWritingWizard}
            onUploadPdf={onUploadWizardPdf}
          />
        ) : (
        <div className="deep-message-list">
          {messages.map((message, index) => (
            <article key={`${message.role}-${index}`} className={`deep-message ${message.role}`}>
              <div className="message-avatar">{message.role === 'user' ? <User size={16} /> : <Bot size={16} />}</div>
              <div className="message-content-wrap">
                {message.role === 'assistant' && !message.error && Boolean(message.trace?.length) && (
                  <ThoughtProcess text={text} trace={message.trace || []} streaming={Boolean(message.streaming)} />
                )}
                {editingMessageIndex === index ? (
                  <div className="message-editor">
                    <textarea value={editingMessageDraft} onChange={(event) => setEditingMessageDraft(event.target.value)} />
                    <div className="message-editor-actions">
                      <button onClick={onCancelEdit}>{text.common.cancel}</button>
                      <button
                        disabled={
                          busy
                          || !editingMessageDraft.trim()
                          || editingMessageDraft.trim() === String(message.content || '').trim()
                        }
                        onClick={onResendMessage}
                      >
                        {text.agent.resend}
                      </button>
                    </div>
                  </div>
                ) : (message.role === 'user' || message.content || message.error || !message.streaming) ? (
                  <div className={`message-bubble markdown-body ${message.error ? 'error' : ''}`}>
                    <CitationMarkdown
                      content={message.content || ''}
                      sources={buildCitationSourceMap({
                        papers,
                        paperRefs: message.paper_refs || [],
                        evidence: message.pdf_evidence || [],
                      })}
                      onOpen={onOpenCitationReference}
                    />
                  </div>
                ) : null}
                {message.role === 'assistant' && !message.error && Boolean(message.tool_actions?.length) && (
                  <div className="message-tool-actions">
                    {message.tool_actions.map((action) => (
                      <button
                        key={action.id || `${action.type}-${action.label}`}
                        className="secondary-button"
                        onClick={() => onExecuteAction(action)}
                      >
                        {action.type === 'open_file' ? <FileText size={14} /> : <Copy size={14} />}
                        {action.label || action.type}
                      </button>
                    ))}
                  </div>
                )}
                {editingMessageIndex !== index && (
                  <div className="message-actions">
                    {message.role === 'user' && <button onClick={() => onEditMessage(index, message.content)}><Pencil size={13} /> 编辑</button>}
                    {message.role === 'assistant' && (
                      <button
                        onClick={() => copyTextToClipboard(message.content || '')}
                        disabled={!message.content}
                      >
                        <Copy size={13} /> 复制
                      </button>
                    )}
                    <button onClick={() => onDeleteMessage(index)}><Trash2 size={13} /> 删除</button>
                  </div>
                )}
              </div>
            </article>
          ))}
          {busy && !hasStreamingMessage && (
            <article className="deep-message assistant">
              <div className="message-avatar"><Bot size={16} /></div>
              <div className="message-bubble thinking" aria-live="polite">
                <span>{text.agent.thinking}</span>
                <span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>
              </div>
            </article>
          )}
          <div ref={messageEndRef} />
        </div>
        )}
        <div className="deep-composer">
          <textarea
            ref={composerTextareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={composerPlaceholder}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend(draft);
              }
            }}
          />
          <button
            className={`send-button ${hasStreamingMessage ? 'stop' : ''}`}
            disabled={hasStreamingMessage ? false : busy || !draft.trim()}
            onClick={() => (hasStreamingMessage ? onStop() : onSend(draft))}
            aria-label={hasStreamingMessage ? text.agent.stop : text.agent.send}
            title={hasStreamingMessage ? text.agent.stop : text.agent.send}
          >
            {hasStreamingMessage ? <X size={18} /> : <Send size={18} />}
          </button>
        </div>
      </div>
    </aside>
  );
}

function ThoughtProcess({ text, trace = [], streaming = false }) {
  const [expanded, setExpanded] = useState(false);
  const latest = trace[trace.length - 1] || {};
  const currentText = latest.detail || latest.title || latest.stage || text.agent.thinking;
  const statusText = streaming ? text.agent.thinking : text.agent.thinkingDone;

  return (
    <section className={`thought-process ${streaming ? 'running' : 'done'} ${expanded ? 'expanded' : ''}`}>
      <button
        type="button"
        className="thought-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="thought-status">{statusText}</span>
        {!expanded && (
          <span className="thought-current" key={`${trace.length}-${latest.stage || 'step'}`}>
            <span>{streaming ? currentText : text.agent.thinkingDone}</span>
          </span>
        )}
      </button>
      {expanded && (
        <div className="thought-detail-list">
          {trace.map((item, itemIndex) => (
            <div className="thought-detail-item" key={`${item.stage || 'step'}-${itemIndex}`}>
              <span>{itemIndex + 1}. {item.title || item.stage || `Step ${itemIndex + 1}`}</span>
              <small>{item.detail || ''}</small>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MessageMetaSection({ title, count, variant = '', children }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className={`message-citations ${variant} ${expanded ? 'expanded' : ''}`}>
      <button
        type="button"
        className="message-citations-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <strong>{title}</strong>
        {Number.isFinite(count) && <span>{count}</span>}
      </button>
      {expanded && (
        <div className="message-citations-body">
          {children}
        </div>
      )}
    </section>
  );
}

function SkillModal({ text, skills, activeSkillIds, onInstall, onUninstall, onToggle, onClose }) {
  return (
    <div className="modal-backdrop light" onClick={onClose}>
      <section className="modal skill-modal" role="dialog" aria-modal="true" aria-labelledby="skill-modal-title" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2 id="skill-modal-title">{text.agent.skills}</h2>
            <p>{text.agent.skillActivePrefix}{activeSkillIds.length}{text.agent.skillActiveSuffix}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onClose}><X size={18} /></button>
        </header>
        <div className="skill-list">
          {skills.map((skill) => {
            const enabled = activeSkillIds.includes(skill.id);
            return (
              <article className={`skill-item ${skill.installed ? 'installed' : ''}`} key={skill.id}>
                <div className="skill-item-main">
                  <div>
                    <h3>{skill.name}</h3>
                    <p>{skill.description}</p>
                  </div>
                  <span>{skill.category || 'skill'}</span>
                </div>
                <div className="skill-actions">
                  <label className="skill-toggle">
                    <input
                      type="checkbox"
                      disabled={!skill.installed}
                      checked={enabled}
                      onChange={(event) => onToggle(skill.id, event.target.checked)}
                    />
                    <span>{text.agent.enable}</span>
                  </label>
                  {skill.installed ? (
                    <button className="secondary-button" onClick={() => onUninstall(skill)}>{text.agent.uninstall}</button>
                  ) : (
                    <button className="primary-button" onClick={() => onInstall(skill)}><Puzzle size={17} /> {text.agent.install}</button>
                  )}
                </div>
                {skill.source_url && (
                  <a className="skill-source" href={skill.source_url} target="_blank" rel="noreferrer">{skill.source_url}</a>
                )}
              </article>
            );
          })}
          {!skills.length && <p className="library-empty">{text.agent.skillEmpty}</p>}
        </div>
      </section>
    </div>
  );
}

export default AgentChat;

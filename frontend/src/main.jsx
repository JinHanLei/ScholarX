import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import AgentChat from './components/AgentChat.jsx';
import { findFirstMarkdownFile } from './components/AgentNoteWorkspace.jsx';
import {
  AddPaperModal,
  AssociatePaperModal,
  FolderModal,
  LibraryCreateProgress,
  LibraryModal,
  PaperDetailsModal,
  PdfMismatchModal,
  RenamePaperModal,
  ShareLibraryModal,
  TagCheckboxes,
  TagFilterMenu,
  TagMenu,
  TagModal,
} from './components/LibraryModals.jsx';
import { FileContextMenu, LibraryTree } from './components/LibrarySidebar.jsx';
import { ContextMenu, PaginationBar, SortButton } from './components/PaperTableControls.jsx';
import { AuthPage, HomePage, ModelSelectionModal, TrashPage, WritingMemoryModal } from './components/Pages.jsx';
import { Avatar, ProfilePage } from './components/profile/index.js';
import { PdfJsViewer, PdfTranslationPopup } from './components/PdfViewer.jsx';
import useClickOutside from './hooks/useClickOutside.js';
import COPY from './i18n/copy.js';
import { API, api, downloadApiFile, streamApi } from './utils/api.js';
import { chatBelongsToLibrary, chatLibraryId, hasUserMessages, mergeChatTrace } from './utils/chat.js';
import { parseCitationId } from './utils/citations.js';
import { initialLlmSettings, isInvalidModelId } from './utils/models.js';
import {
  ROOT_FOLDER_MARKER,
  displayPaperAbstract,
  displayPaperTitle,
  displayVenue,
  folderAncestors,
  formatDateOnly,
  formatAuthors,
  isUnmatchedUploadedPaper,
  normalizeFolderPath,
} from './utils/papers.js';
import {
  emptyFilters,
  emptyTableFilters,
  hasScopeFilter,
  normalizeTableSorts,
  normalizeRanks,
  normalizeVenues,
  parseRankToken,
  primaryTableSort,
  rankParam,
  serializeTableSorts,
  splitScopeDraft,
  venueParam,
} from './utils/tableFilters.js';
import {
  buildCreativeDraftPrompt,
  buildMainDraftPrompt,
  buildOutlineMarkdown,
  chooseReferencePapers,
  compactText,
  inferWritingDomain,
  isCreativeWritingTask,
  isPlanningWritingTask,
  markdownFileNameFromPrompt,
  selectedChatPaperIds,
  targetVenueFromPrompt,
} from './utils/writing.js';
import {
  ArrowRight,
  ArrowUpDown,
  BarChart3,
  Bot,
  BookMarked,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  FileText,
  FileUp,
  Folder,
  Download,
  GraduationCap,
  History,
  Home,
  HelpCircle,
  KeyRound,
  Languages,
  Library,
  LogOut,
  LayoutDashboard,
  MoreVertical,
  Pencil,
  Plus,
  Puzzle,
  Rocket,
  Search,
  Send,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
  Trophy,
  Upload,
  User,
  Users,
  X,
} from 'lucide-react';
import './styles.css';
import ResearchWorkbench from './components/research/ResearchWorkbench.jsx';
import { ResearchErrorBoundary } from './components/research/shared.jsx';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'http://localhost:8000';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const DEFAULT_COLUMNS = { left: 1.05, middle: 3, right: 3 };
const PAPER_VIEW_STATE_KEY = 'scholarx.paperViewState';
const LAYOUT_PRESETS = {
  default: {
    columns: DEFAULT_COLUMNS,
    leftCollapsed: false,
    rightCollapsed: false,
    filesOpen: false,
    fileSidebarCollapsed: false,
  },
  reading: {
    columns: DEFAULT_COLUMNS,
    leftCollapsed: false,
    rightCollapsed: false,
    filesOpen: true,
    fileSidebarCollapsed: false,
  },
  immersive: {
    columns: DEFAULT_COLUMNS,
    leftCollapsed: true,
    rightCollapsed: false,
    filesOpen: true,
    fileSidebarCollapsed: true,
  },
};

function readStoredLayoutPreset() {
  try {
    const stored = localStorage.getItem('scholarx.layoutPreset') || 'default';
    return LAYOUT_PRESETS[stored] ? stored : 'default';
  } catch {
    return 'default';
  }
}

function columnsFromStorage() {
  try {
    const stored = JSON.parse(localStorage.getItem('scholarx.columns') || 'null');
    if (!stored) return DEFAULT_COLUMNS;
    if (stored.left === 1 && stored.middle === 4 && stored.right === 2) return DEFAULT_COLUMNS;
    if (stored.left === 1.15 && stored.middle === 4 && stored.right === 2) return DEFAULT_COLUMNS;
    return stored;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

function readStoredLayoutState() {
  try {
    const stored = JSON.parse(localStorage.getItem('scholarx.layoutState') || 'null');
    if (stored && typeof stored === 'object') {
      return {
        preset: LAYOUT_PRESETS[stored.preset] ? stored.preset : readStoredLayoutPreset(),
        columns: stored.columns || columnsFromStorage(),
        leftCollapsed: Boolean(stored.leftCollapsed),
        rightCollapsed: Boolean(stored.rightCollapsed),
        filesOpen: Boolean(stored.filesOpen),
        fileSidebarCollapsed: Boolean(stored.fileSidebarCollapsed),
      };
    }
  } catch {
    // fall through to legacy layout preset
  }
  const presetName = readStoredLayoutPreset();
  return { preset: presetName, ...LAYOUT_PRESETS[presetName] };
}

function readStoredJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function readStoredActiveLibraryId() {
  const stored = readStoredJson('scholarx.activeLibrary', null);
  return stored?.id ?? null;
}

function normalizeStoredTableFilters(value) {
  const fallback = emptyTableFilters();
  if (!value || typeof value !== 'object') return fallback;
  const page = Number(value.page);
  const pageSize = Number(value.page_size);
  const sorts = normalizeTableSorts(value);
  const primary = sorts[0] || { column: '', dir: '' };
  return {
    ...fallback,
    ...value,
    venues: Array.isArray(value.venues) ? value.venues : fallback.venues,
    ranks: Array.isArray(value.ranks) ? value.ranks : fallback.ranks,
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : fallback.page,
    page_size: Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : fallback.page_size,
    sorts,
    sort_by: primary.column,
    sort_dir: primary.dir,
  };
}

function readStoredPaperViewStates() {
  const stored = readStoredJson(PAPER_VIEW_STATE_KEY, {});
  return stored && typeof stored === 'object' ? stored : {};
}

function readStoredPaperViewState(libraryId) {
  if (!libraryId) return null;
  const state = readStoredPaperViewStates()[String(libraryId)];
  if (!state || typeof state !== 'object') return null;
  return {
    ...state,
    filters: normalizeStoredTableFilters(state.filters),
    scrollTop: Math.max(0, Number(state.scrollTop) || 0),
  };
}

function writeStoredPaperViewState(libraryId, patch) {
  if (!libraryId) return;
  const key = String(libraryId);
  const states = readStoredPaperViewStates();
  const current = states[key] && typeof states[key] === 'object' ? states[key] : {};
  states[key] = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  };
  try {
    localStorage.setItem(PAPER_VIEW_STATE_KEY, JSON.stringify(states));
  } catch {
    // Ignore storage quota/private-mode failures; the visible state remains usable.
  }
}

const supabase = import.meta.env.VITE_EASYREF_LEGACY === 'true' && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  })
  : null;

function createInitialChat(text = COPY.zh, library = null) {
  return {
    id: crypto.randomUUID(),
    title: text.agent.newChat,
    createdAt: new Date().toISOString(),
    libraryId: library?.id ?? null,
    libraryName: library?.name || '',
    messages: [],
  };
}

function viewFromPath(pathname = window.location.pathname) {
  if (pathname === '/scholarx' || pathname === '/easyref' || pathname === '/demo') return 'scholarx';
  if (pathname === '/profile') return 'profile';
  if (pathname === '/trash') return 'trash';
  return 'home';
}

function migrateLegacyStorageKeys() {
  if (typeof window === 'undefined') return;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith('easyref.')) continue;
      const nextKey = `scholarx.${key.slice('easyref.'.length)}`;
      if (window.localStorage.getItem(nextKey) === null) {
        window.localStorage.setItem(nextKey, window.localStorage.getItem(key) || '');
      }
    }
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

migrateLegacyStorageKeys();

function App() {
  const [view, setView] = useState(() => viewFromPath());
  const [locale, setLocaleState] = useState(() => localStorage.getItem('scholarx.locale') || 'zh');
  function setLocale(nextLocale) {
    localStorage.setItem('scholarx.locale', nextLocale);
    setLocaleState(nextLocale);
  }
  const text = COPY[locale];
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [libraries, setLibraries] = useState([]);
  const initialLayoutStateRef = useRef(null);
  if (!initialLayoutStateRef.current) {
    initialLayoutStateRef.current = readStoredLayoutState();
  }
  const [libraryOrder, setLibraryOrder] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('scholarx.libraryOrder') || '[]');
    } catch {
      return [];
    }
  });
  const [activeLibrary, setActiveLibrary] = useState(null);
  const [libraryPapers, setLibraryPapers] = useState([]);
  const [libraryFiles, setLibraryFiles] = useState([]);
  const [fileWorkbenchOpen, setFileWorkbenchOpen] = useState(() => initialLayoutStateRef.current.filesOpen);
  const [activeFile, setActiveFile] = useState(null);
  const [activeFileDraft, setActiveFileDraft] = useState('');
  const [selectedFileFolderId, setSelectedFileFolderId] = useState(null);
  const [expandedFileFolders, setExpandedFileFolders] = useState(new Set());
  const [fileSidebarMode, setFileSidebarMode] = useState('files');
  const [fileSidebarCollapsed, setFileSidebarCollapsed] = useState(() => initialLayoutStateRef.current.fileSidebarCollapsed);
  const [fileSourceMode, setFileSourceMode] = useState(false);
  const [fileContextMenu, setFileContextMenu] = useState(null);
  const [renamingFileId, setRenamingFileId] = useState(null);
  const [renamingFileName, setRenamingFileName] = useState('');
  const [writingWizard, setWritingWizard] = useState(null);
  const [aiFileEditing, setAiFileEditing] = useState(false);
  const fileEditorRef = useRef(null);
  const [paperTotal, setPaperTotal] = useState(0);
  const paperTableWrapRef = useRef(null);
  const pdfReturnListStateRef = useRef(null);
  const pendingPaperScrollRestoreRef = useRef(null);
  const paperScrollSaveFrameRef = useRef(0);
  const [libraryTotals, setLibraryTotals] = useState({});
  const [filters, setFilters] = useState(emptyFilters());
  const [tableFilters, setTableFilters] = useState(emptyTableFilters());
  const tableSortKey = serializeTableSorts(tableFilters);
  const [selected, setSelected] = useState(new Set());
  const [selectedAll, setSelectedAll] = useState(false);
  const [selectedExcluded, setSelectedExcluded] = useState(new Set());
  const [citationExportStatus, setCitationExportStatus] = useState({ total: 0, ready: 0, pending: 0, failed: 0, exportable: false });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const noticeTimerRef = useRef(null);
  const userMenuRef = useRef(null);
  const tagFilterRef = useRef(null);
  const [libraryModalOpen, setLibraryModalOpen] = useState(false);
  const [sharingLibrary, setSharingLibrary] = useState(null);
  const [addPaperModalOpen, setAddPaperModalOpen] = useState(false);
  const [pdfViewer, setPdfViewer] = useState(null);
  const [pdfTranslateEnabled, setPdfTranslateEnabled] = useState(false);
  const [translationPopup, setTranslationPopup] = useState(null);
  const translationRequestRef = useRef(0);
  const translationPopupRef = useRef(null);
  const translationRangeRef = useRef(null);
  const lastTranslatedSelectionRef = useRef('');
  const pdfViewerRef = useRef(null);
  const [pendingPdfUpload, setPendingPdfUpload] = useState(null);
  const [associatingPaper, setAssociatingPaper] = useState(null);
  const [detailPaper, setDetailPaper] = useState(null);
  const [renamingPaper, setRenamingPaper] = useState(null);
  const [renamingPaperTitle, setRenamingPaperTitle] = useState('');
  const [libraryCreateStatus, setLibraryCreateStatus] = useState(null);
  const [libraryCreateBackgrounded, setLibraryCreateBackgrounded] = useState(false);
  const [pdfTask, setPdfTask] = useState(null);
  const [pdfTaskBackgrounded, setPdfTaskBackgrounded] = useState(false);
  const completedPdfTaskRef = useRef(new Set());
  const [editingLibrary, setEditingLibrary] = useState(null);
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [editingTag, setEditingTag] = useState(null);
  const [folderModalLibrary, setFolderModalLibrary] = useState(null);
  const [expandedLibraries, setExpandedLibraries] = useState(new Set());
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [memoryModalOpen, setMemoryModalOpen] = useState(false);
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [llmSettings, setLlmSettings] = useState(initialLlmSettings);
  const [availableModels, setAvailableModels] = useState([]);
  const [modelListLoading, setModelListLoading] = useState(false);
  const [modelListError, setModelListError] = useState('');
  const [writingPreferenceDraft, setWritingPreferenceDraft] = useState('');
  const [writingPreferenceRules, setWritingPreferenceRules] = useState({});
  const [contextMenu, setContextMenu] = useState(null);
  const chatAbortControllerRef = useRef(null);
  const inlineCompletionAbortRef = useRef(null);
  const layoutMenuRef = useRef(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editingMessageIndex, setEditingMessageIndex] = useState(null);
  const [editingMessageDraft, setEditingMessageDraft] = useState('');
  const [layoutPreset, setLayoutPreset] = useState(() => initialLayoutStateRef.current.preset || 'default');
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const [columns, setColumns] = useState(() => initialLayoutStateRef.current.columns || DEFAULT_COLUMNS);
  const [leftPaneCollapsed, setLeftPaneCollapsed] = useState(() => initialLayoutStateRef.current.leftCollapsed);
  const [rightPaneCollapsed, setRightPaneCollapsed] = useState(() => initialLayoutStateRef.current.rightCollapsed);
  const [chatSessions, setChatSessions] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('scholarx.chatSessions') || '[]');
      return saved.length ? saved : [createInitialChat()];
    } catch {
      return [createInitialChat()];
    }
  });
  const [activeChatId, setActiveChatId] = useState(() => chatSessions[0]?.id);
  const [skills, setSkills] = useState([]);
  const [activeSkillIds, setActiveSkillIds] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('scholarx.activeSkillIds') || '[]');
    } catch {
      return [];
    }
  });

  const user = session?.user || null;
  const userEmail = user?.email || localStorage.getItem('scholarx.localUser') || '';
  const activeLibraryId = activeLibrary?.id ?? null;
  const activeChat = chatSessions.find((chat) => chat.id === activeChatId)
    || chatSessions.find((chat) => chatBelongsToLibrary(chat, activeLibraryId))
    || chatSessions[0]
    || createInitialChat(text, activeLibrary);
  const messages = activeChat.messages || [];
  const activeFileDirty = Boolean(activeFile && activeFileDraft !== (activeFile.content_text || ''));
  const installedSkills = useMemo(() => skills.filter((skill) => skill.installed), [skills]);
  const enabledSkillIds = useMemo(
    () => activeSkillIds.filter((skillId) => installedSkills.some((skill) => skill.id === skillId)),
    [activeSkillIds, installedSkills],
  );
  const layoutOptions = [
    { id: 'default', label: text.common.layoutDefault, description: text.common.layoutDefaultDesc },
    { id: 'reading', label: text.common.layoutReading, description: text.common.layoutReadingDesc },
    { id: 'immersive', label: text.common.layoutImmersive, description: text.common.layoutImmersiveDesc },
  ];

  function updateActiveChat(updater) {
    setChatSessions((sessions) => sessions.map((chat) => (
      chat.id === activeChat.id
        ? {
          ...chat,
          ...updater(chat),
          libraryId: activeLibrary?.id ?? chat.libraryId ?? null,
          libraryName: activeLibrary?.name || chat.libraryName || '',
        }
        : chat
    )));
  }

  async function loadLibraries() {
    try {
      const qs = userEmail ? `?owner=${encodeURIComponent(userEmail)}` : '';
      const data = await api(`/libraries${qs}`);
      setLibraries(data.libraries);
      setLibraryTotals((totals) => {
        const next = { ...totals };
        (data.libraries || []).forEach((library) => {
          if (Number(library.paper_count || 0) > 0) next[library.id] = Number(library.paper_count || 0);
        });
        return next;
      });
      setError('');
      if (!activeLibrary && data.libraries.length) {
        const storedLibraryId = readStoredActiveLibraryId();
        const nextLibrary = data.libraries.find((library) => String(library.id) === String(storedLibraryId))
          || data.libraries[0];
        const storedViewState = readStoredPaperViewState(nextLibrary.id);
        if (storedViewState?.filters) {
          setTableFilters(storedViewState.filters);
          pendingPaperScrollRestoreRef.current = storedViewState.scrollTop || 0;
        }
        setActiveLibrary(nextLibrary);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadStats() {
    try {
      setStats(await api('/stats'));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadSkills() {
    try {
      const data = await api('/skills');
      setSkills(data.skills || []);
      setActiveSkillIds((ids) => ids.filter((skillId) => (data.skills || []).some((skill) => skill.id === skillId && skill.installed)));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadLibraryPapers(id = activeLibrary?.id, nextFilters = tableFilters) {
    if (!id) return;
    try {
      const primarySort = primaryTableSort(nextFilters);
      const qs = new URLSearchParams({
        keyword: nextFilters.keyword || '',
        venue: venueParam(nextFilters),
        venues: venueParam(nextFilters),
        year_from: nextFilters.year_from || '',
        year_to: nextFilters.year_to || '',
        rank: rankParam(nextFilters),
        status: nextFilters.status || '',
        tag: nextFilters.tag || '',
        folder: nextFilters.folder || '',
        page: nextFilters.page || 1,
        page_size: nextFilters.page_size || 25,
        sort: serializeTableSorts(nextFilters),
        sort_by: primarySort.column,
        sort_dir: primarySort.dir,
      });
      const data = await api(`/libraries/${id}/papers?${qs.toString()}`);
      setLibraryPapers(data.papers);
      setPaperTotal(data.total || data.papers.length);
      if (!nextFilters.folder && !nextFilters.keyword && !hasScopeFilter(nextFilters) && !nextFilters.tag && !nextFilters.status) {
        setLibraryTotals((totals) => ({ ...totals, [id]: data.total || data.papers.length }));
      }
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadLibraryFiles(id = activeLibrary?.id) {
    if (!id) return [];
    const data = await api(`/libraries/${id}/files`);
    const files = data.files || [];
    setLibraryFiles(files);
    return files;
  }

  function schedulePaperScrollRestore(scrollTop) {
    const targetTop = Math.max(0, Number(scrollTop) || 0);
    pendingPaperScrollRestoreRef.current = targetTop;
    const restore = () => {
      const wrap = paperTableWrapRef.current;
      if (!wrap) return;
      wrap.scrollTop = Math.min(targetTop, Math.max(0, wrap.scrollHeight - wrap.clientHeight));
      pendingPaperScrollRestoreRef.current = null;
    };
    requestAnimationFrame(() => {
      restore();
      window.setTimeout(restore, 40);
      window.setTimeout(restore, 160);
    });
  }

  function snapshotPaperViewState(libraryId = activeLibrary?.id) {
    if (!libraryId) return null;
    const scrollTop = paperTableWrapRef.current?.scrollTop ?? readStoredPaperViewState(libraryId)?.scrollTop ?? 0;
    return {
      libraryId,
      filters: tableFilters,
      scrollTop,
    };
  }

  function handlePaperTableScroll(event) {
    if (!activeLibrary?.id || pdfViewer) return;
    const scrollTop = event.currentTarget.scrollTop;
    if (paperScrollSaveFrameRef.current) cancelAnimationFrame(paperScrollSaveFrameRef.current);
    paperScrollSaveFrameRef.current = requestAnimationFrame(() => {
      paperScrollSaveFrameRef.current = 0;
      writeStoredPaperViewState(activeLibrary.id, { filters: tableFilters, scrollTop });
    });
  }

  function fileDraftKey(fileId = activeFile?.id) {
    return fileId ? `scholarx.fileDraft.${fileId}` : '';
  }

  function confirmUnsavedFileExit() {
    return !activeFileDirty || window.confirm(text.workbench.unsavedExit);
  }

  useEffect(() => {
    loadStats();
    loadSkills();
  }, []);

  useEffect(() => {
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => {
        setSession(data.session);
        setAuthReady(true);
      });
      const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession);
        setAuthReady(true);
      });
      return () => listener.subscription.unsubscribe();
    }
    const localUser = localStorage.getItem('scholarx.localUser');
    setSession(localUser ? { user: { email: localUser } } : null);
    setAuthReady(true);
  }, []);

  useEffect(() => {
    if (userEmail) loadLibraries();
  }, [userEmail]);

  useEffect(() => {
    if (!pdfTask?.id || !['running', 'queued'].includes(pdfTask.status)) return undefined;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const data = await api(`/tasks/${pdfTask.id}`);
        if (!cancelled) setPdfTask(data.task);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }, 850);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pdfTask?.id, pdfTask?.status]);

  useEffect(() => {
    if (!pdfTask?.id || !['done', 'partial', 'error'].includes(pdfTask.status)) return;
    if (completedPdfTaskRef.current.has(pdfTask.id)) return;
    completedPdfTaskRef.current.add(pdfTask.id);
    setBusy(false);
    setLibraryCreateStatus(pdfTask.status === 'error' ? 'error' : 'done');
    const resultLibrary = pdfTask.result?.library || (pdfTask.library_id ? { id: pdfTask.library_id, name: pdfTask.library_name } : null);
    Promise.resolve()
      .then(async () => {
        await loadLibraries();
        if (resultLibrary?.id) {
          const nextFilters = emptyTableFilters();
          setActiveLibrary(resultLibrary);
          setExpandedLibraries((items) => new Set([...items, resultLibrary.id]));
          setTableFilters(nextFilters);
          resetSelection();
          await loadLibraryPapers(resultLibrary.id, nextFilters);
        }
      })
      .finally(() => {
        const done = pdfTask.done || 0;
        const total = pdfTask.total || 0;
        const failed = pdfTask.failed || 0;
        const message = failed
          ? (locale === 'zh' ? `PDF 处理完成：${done}/${total}，失败 ${failed}` : `PDF task finished: ${done}/${total}, failed ${failed}`)
          : (locale === 'zh' ? `PDF 处理完成：${done}/${total}` : `PDF task finished: ${done}/${total}`);
        showNotice(message);
        window.setTimeout(() => {
          setLibraryCreateStatus(null);
          setPdfTaskBackgrounded(true);
        }, 900);
      });
  }, [pdfTask?.id, pdfTask?.status]);

  useEffect(() => {
    if (activeLibrary?.id) loadLibraryPapers(activeLibrary.id, tableFilters);
  }, [activeLibrary?.id, tableFilters.page, tableFilters.page_size, tableSortKey]);

  useEffect(() => {
    if (!activeLibrary?.id || pdfViewer) return;
    const storedViewState = readStoredPaperViewState(activeLibrary.id);
    const targetTop = pendingPaperScrollRestoreRef.current ?? storedViewState?.scrollTop ?? 0;
    schedulePaperScrollRestore(targetTop);
  }, [activeLibrary?.id, libraryPapers.length, paperTotal, pdfViewer]);

  useEffect(() => {
    if (!activeLibrary?.id) return;
    const storedScrollTop = readStoredPaperViewState(activeLibrary.id)?.scrollTop || 0;
    writeStoredPaperViewState(activeLibrary.id, {
      filters: tableFilters,
      scrollTop: paperTableWrapRef.current?.scrollTop ?? storedScrollTop,
    });
  }, [activeLibrary?.id, tableFilters]);

  useEffect(() => () => {
    if (paperScrollSaveFrameRef.current) cancelAnimationFrame(paperScrollSaveFrameRef.current);
  }, []);

  useEffect(() => {
    if (!activeLibrary?.id) {
      localStorage.removeItem('scholarx.activeLibrary');
      return;
    }
    localStorage.setItem('scholarx.activeLibrary', JSON.stringify({
      id: activeLibrary.id,
      name: activeLibrary.name || '',
    }));
  }, [activeLibrary?.id, activeLibrary?.name]);

  useEffect(() => {
    if (userEmail) localStorage.setItem('scholarx.userEmail', userEmail);
    else localStorage.removeItem('scholarx.userEmail');
  }, [userEmail]);

  useEffect(() => {
    if (!activeLibrary?.id) {
      setLibraryFiles([]);
      setActiveFile(null);
      setActiveFileDraft('');
      return;
    }
    loadLibraryFiles(activeLibrary.id).then((files) => {
      if (activeFile && activeFile.library_id !== activeLibrary.id) {
        setActiveFile(null);
        setActiveFileDraft('');
        return;
      }
      if (activeFile) {
        const fresh = files.find((file) => file.id === activeFile.id);
        if (fresh) {
          setActiveFile(fresh);
          setActiveFileDraft(fresh.content_text || '');
        }
      }
    }).catch((err) => setError(err.message));
  }, [activeLibrary?.id]);

  useEffect(() => {
    if (!fileWorkbenchOpen || activeFile || activeFileDirty) return;
    const firstMarkdownFile = findFirstMarkdownFile(libraryFiles);
    if (!firstMarkdownFile) return;
    selectLibraryFileWithoutPrompt(firstMarkdownFile);
  }, [fileWorkbenchOpen, libraryFiles, activeFile?.id, activeFileDirty]);

  useEffect(() => {
    localStorage.setItem('scholarx.chatSessions', JSON.stringify(chatSessions.filter(hasUserMessages).slice(0, 30)));
  }, [chatSessions]);

  useEffect(() => {
    localStorage.setItem('scholarx.columns', JSON.stringify(columns));
  }, [columns]);

  useEffect(() => {
    localStorage.setItem('scholarx.layoutPreset', layoutPreset);
    localStorage.setItem('scholarx.layoutState', JSON.stringify({
      preset: layoutPreset,
      columns,
      leftCollapsed: leftPaneCollapsed,
      rightCollapsed: rightPaneCollapsed,
      filesOpen: fileWorkbenchOpen,
      fileSidebarCollapsed,
    }));
  }, [layoutPreset, columns, leftPaneCollapsed, rightPaneCollapsed, fileWorkbenchOpen, fileSidebarCollapsed]);

  useEffect(() => {
    localStorage.setItem('scholarx.libraryOrder', JSON.stringify(libraryOrder));
  }, [libraryOrder]);

  useEffect(() => {
    localStorage.setItem('scholarx.activeSkillIds', JSON.stringify(enabledSkillIds));
  }, [enabledSkillIds]);

  useEffect(() => {
    localStorage.setItem('scholarx.llmSettings', JSON.stringify(llmSettings));
  }, [llmSettings]);

  useEffect(() => {
    if (!activeFile?.id || !activeFileDirty) return;
    localStorage.setItem(fileDraftKey(activeFile.id), activeFileDraft);
  }, [activeFile?.id, activeFileDraft, activeFileDirty]);

  useEffect(() => {
    function handleBeforeUnload(event) {
      if (!activeFileDirty) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [activeFileDirty]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      if (!fileWorkbenchOpen || !activeFile) return;
      event.preventDefault();
      saveActiveFile();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fileWorkbenchOpen, activeFile?.id, activeFileDraft]);

  useEffect(() => {
    setTranslationPopup(null);
    translationRangeRef.current = null;
    lastTranslatedSelectionRef.current = '';
  }, [pdfViewer?.paperId, pdfViewer?.url]);

  useEffect(() => {
    translationPopupRef.current = translationPopup;
  }, [translationPopup]);

  function pdfElementFromNode(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return element?.closest?.('.pdf-js-text-layer') || null;
  }

  function isPdfTextRange(range) {
    if (!range) return false;
    const startLayer = pdfElementFromNode(range.startContainer);
    const endLayer = pdfElementFromNode(range.endContainer);
    return Boolean(startLayer && endLayer && pdfViewerRef.current?.contains(startLayer) && pdfViewerRef.current?.contains(endLayer));
  }

  function pdfPopupPositionFromRange(range) {
    if (!range || !isPdfTextRange(range)) return null;
    const rect = range.getBoundingClientRect();
    const viewerRect = pdfViewerRef.current?.getBoundingClientRect();
    if (!viewerRect || !rect || rect.width <= 0 || rect.height <= 0) return null;
    const outside = rect.bottom < viewerRect.top
      || rect.top > viewerRect.bottom
      || rect.right < viewerRect.left
      || rect.left > viewerRect.right;
    if (outside) return null;
    const popupWidth = 320;
    const margin = 10;
    const minX = viewerRect.left + margin;
    const maxX = Math.max(minX, viewerRect.right - popupWidth - margin);
    const x = Math.min(Math.max(rect.left + rect.width / 2 - popupWidth / 2, minX), maxX);
    const belowY = rect.bottom + 8;
    const y = belowY < viewerRect.bottom - 76
      ? belowY
      : Math.max(viewerRect.top + margin, rect.top - 18);
    return { x, y };
  }

  useEffect(() => {
    if (!pdfViewer || !pdfTranslateEnabled) return undefined;
    let timer = null;
    const handleSelection = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const selection = window.getSelection();
        const anchorElement = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE
          ? selection.anchorNode
          : selection?.anchorNode?.parentElement;
        if (anchorElement?.closest?.('.pdf-translation-popup')) return;
        const selectedText = String(selection?.toString() || '').trim();
        if (selectedText.length < 2) return;
        const range = selection.rangeCount ? selection.getRangeAt(0) : null;
        if (!isPdfTextRange(range)) return;
        const position = pdfPopupPositionFromRange(range);
        if (!position) return;
        translationRangeRef.current = range.cloneRange();
        if (selectedText === lastTranslatedSelectionRef.current && translationPopupRef.current) {
          setTranslationPopup((current) => current ? { ...current, ...position } : current);
          return;
        }
        lastTranslatedSelectionRef.current = selectedText;
        translatePdfText(selectedText, position);
      }, 80);
    };
    document.addEventListener('mouseup', handleSelection);
    document.addEventListener('keyup', handleSelection);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mouseup', handleSelection);
      document.removeEventListener('keyup', handleSelection);
    };
  }, [pdfViewer, pdfTranslateEnabled, locale]);

  useEffect(() => {
    if (!pdfViewer || !translationPopup) return undefined;
    let frame = 0;
    const updatePopupPosition = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const position = pdfPopupPositionFromRange(translationRangeRef.current);
        if (!position) {
          clearPdfTranslationPopup({ keepSelection: true });
          return;
        }
        setTranslationPopup((current) => current ? { ...current, ...position } : current);
      });
    };
    document.addEventListener('scroll', updatePopupPosition, true);
    window.addEventListener('resize', updatePopupPosition);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('scroll', updatePopupPosition, true);
      window.removeEventListener('resize', updatePopupPosition);
    };
  }, [pdfViewer, translationPopup]);

  const selectedIds = [...selected];
  const selectedKey = selectedIds.join(',');
  const selectedExcludedKey = [...selectedExcluded].join(',');
  const selectedCount = selectedAll
    ? Math.max(0, Number(paperTotal || 0) - selectedExcluded.size)
    : selected.size;
  const tagDefinitions = activeLibrary?.filters_json?.tag_definitions || activeLibrary?.filters_json?.tags || [];
  const visiblePapers = useMemo(() => libraryPapers, [libraryPapers]);
  const orderedLibraries = useMemo(() => {
    if (!libraryOrder.length) return libraries;
    const order = new Map(libraryOrder.map((id, index) => [id, index]));
    return libraries
      .map((library, index) => ({ library, index }))
      .sort((a, b) => {
        const aOrder = order.has(a.library.id) ? order.get(a.library.id) : -1;
        const bOrder = order.has(b.library.id) ? order.get(b.library.id) : -1;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.index - b.index;
      })
      .map((item) => item.library);
  }, [libraries, libraryOrder]);

  useEffect(() => {
    if (!authReady || !activeLibrary?.id) return;
    const currentChat = chatSessions.find((chat) => chat.id === activeChatId);
    if (currentChat && chatBelongsToLibrary(currentChat, activeLibrary.id)) return;
    const libraryChats = chatSessions.filter((chat) => chatBelongsToLibrary(chat, activeLibrary.id));
    const latestChat = libraryChats.find(hasUserMessages) || libraryChats[0];
    if (latestChat) {
      setActiveChatId(latestChat.id);
      setDraft('');
      setEditingMessageIndex(null);
      setEditingMessageDraft('');
      return;
    }
    const nextChat = createInitialChat(text, activeLibrary);
    setChatSessions((sessions) => [nextChat, ...sessions]);
    setActiveChatId(nextChat.id);
    setDraft('');
    setEditingMessageIndex(null);
    setEditingMessageDraft('');
  }, [authReady, activeLibrary?.id]);

  function navigate(nextView) {
    const path = { scholarx: '/scholarx', profile: '/profile', trash: '/trash', home: '/' }[nextView] || '/';
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setView(nextView);
  }

  useEffect(() => {
    function handlePopState() {
      setView(viewFromPath());
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  function openLibraryModal() {
    if (pdfTask && ['running', 'partial'].includes(pdfTask.status)) {
      setPdfTaskBackgrounded(false);
      return;
    }
    setFilters(emptyFilters());
    setEditingLibrary(null);
    setLibraryModalOpen(true);
  }

  function pinLibraryToTop(libraryId) {
    const ids = orderedLibraries.map((library) => library.id);
    const index = ids.indexOf(libraryId);
    if (index <= 0) return;
    const nextIds = [libraryId, ...ids.filter((id) => id !== libraryId)];
    setLibraryOrder(nextIds);
  }

  useClickOutside(userMenuRef, userMenuOpen, () => setUserMenuOpen(false));
  useClickOutside(tagFilterRef, tagFilterOpen, () => setTagFilterOpen(false));
  useClickOutside(layoutMenuRef, layoutMenuOpen, () => setLayoutMenuOpen(false));

  function resetSelection() {
    setSelected(new Set());
    setSelectedAll(false);
    setSelectedExcluded(new Set());
  }

  function showNotice(message) {
    setNotice(message);
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 2200);
  }

  async function loadWritingPreferences() {
    if (!userEmail) return;
    try {
      const data = await api(`/writing-preferences?user_key=${encodeURIComponent(userEmail || 'local')}`);
      const rules = data.preferences?.style_rules_json || {};
      setWritingPreferenceRules(rules);
      setWritingPreferenceDraft(
        typeof rules.memory_text === 'string'
          ? rules.memory_text
          : Array.isArray(rules.memories)
            ? rules.memories.join('\n')
            : '',
      );
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadWritingPreferences();
  }, [userEmail]);

  async function saveWritingPreference() {
    const cleanPreference = writingPreferenceDraft.trim();
    try {
      const { memories: _legacyMemories, ...restRules } = writingPreferenceRules || {};
      const nextRules = { ...restRules, memory_text: cleanPreference };
      const data = await api('/writing-preferences', {
        method: 'PUT',
        body: {
          user_key: userEmail || 'local',
          style_rules_json: nextRules,
        },
      });
      const rules = data.preferences?.style_rules_json || nextRules;
      setWritingPreferenceRules(rules);
      setWritingPreferenceDraft(typeof rules.memory_text === 'string' ? rules.memory_text : cleanPreference);
      showNotice(text.user.memorySaved);
    } catch (err) {
      setError(err.message);
    }
  }

  function openLibraryFile(file) {
    if (!file) return;
    if (file.type === 'folder') {
      setSelectedFileFolderId(file.id);
      setExpandedFileFolders((items) => new Set([...items, file.id]));
      return;
    }
    if (!confirmUnsavedFileExit()) return;
    selectLibraryFileWithoutPrompt(file);
  }

  function selectLibraryFileWithoutPrompt(file) {
    if (!file || file.type === 'folder') return;
    const localDraft = localStorage.getItem(fileDraftKey(file.id));
    setActiveFile(file);
    setActiveFileDraft(localDraft ?? file.content_text ?? '');
    setSelectedFileFolderId(file.parent_id || null);
    setFileWorkbenchOpen(true);
  }

  async function openLibraryFileById(libraryId, fileId) {
    if (!libraryId || !fileId) return;
    const files = await loadLibraryFiles(libraryId);
    const file = files.find((item) => Number(item.id) === Number(fileId));
    if (file) openLibraryFile(file);
  }

  async function createMarkdownFile(parentId = selectedFileFolderId, options = {}) {
    if (!activeLibrary) return;
    const data = await api(`/libraries/${activeLibrary.id}/files`, {
      method: 'POST',
      body: {
        name: options.name || '',
        type: 'markdown',
        content: options.content || '',
        parent_id: parentId || null,
        metadata: options.metadata || {},
      },
    });
    await loadLibraryFiles(activeLibrary.id);
    if (options.open !== false) openLibraryFile(data.file);
    return data.file;
  }

  async function createLibraryFolderSilently(name, parentId = selectedFileFolderId, metadata = {}) {
    if (!activeLibrary) return null;
    const data = await api(`/libraries/${activeLibrary.id}/files`, {
      method: 'POST',
      body: {
        name: name || 'New Folder',
        type: 'folder',
        parent_id: parentId || null,
        metadata,
      },
    });
    await loadLibraryFiles(activeLibrary.id);
    setSelectedFileFolderId(data.file.id);
    setExpandedFileFolders((items) => new Set([...items, data.file.id]));
    return data.file;
  }

  async function saveLibraryFileContent(file, content) {
    if (!activeLibrary || !file) return null;
    const data = await api(`/libraries/${activeLibrary.id}/files/${file.id}`, {
      method: 'PATCH',
      body: { content },
    });
    setLibraryFiles((files) => files.map((item) => (item.id === data.file.id ? data.file : item)));
    setActiveFile((current) => (current?.id === data.file.id ? data.file : current));
    setActiveFileDraft(data.file?.content_text || '');
    localStorage.removeItem(fileDraftKey(data.file.id));
    return data.file;
  }

  async function createLibraryFolder(parentId = selectedFileFolderId) {
    if (!activeLibrary) return;
    const name = window.prompt(text.workbench.newFolder, 'New Folder');
    if (!name?.trim()) return;
    const data = await api(`/libraries/${activeLibrary.id}/files`, {
      method: 'POST',
      body: {
        name: name.trim(),
        type: 'folder',
        parent_id: parentId || null,
      },
    });
    await loadLibraryFiles(activeLibrary.id);
    setSelectedFileFolderId(data.file.id);
    setExpandedFileFolders((items) => new Set([...items, data.file.id]));
  }

  async function saveActiveFile(nextContent = activeFileDraft) {
    if (!activeLibrary || !activeFile) return;
    const data = await api(`/libraries/${activeLibrary.id}/files/${activeFile.id}`, {
      method: 'PATCH',
      body: { content: nextContent },
    });
    setActiveFile(data.file);
    setActiveFileDraft(data.file?.content_text || '');
    setLibraryFiles((files) => files.map((file) => (file.id === data.file.id ? data.file : file)));
    localStorage.removeItem(fileDraftKey(data.file.id));
    showNotice(text.workbench.fileSaved);
  }

  function startRenamingFile(file) {
    if (!file) {
      setRenamingFileId(null);
      setRenamingFileName('');
      return;
    }
    setRenamingFileId(file.id);
    setRenamingFileName(file.name || '');
  }

  async function renameLibraryFile(file, nextName) {
    if (!activeLibrary || !file) return;
    const name = String(nextName ?? renamingFileName ?? '').trim();
    setRenamingFileId(null);
    setRenamingFileName('');
    if (!name || name === file.name) return;
    const data = await api(`/libraries/${activeLibrary.id}/files/${file.id}`, {
      method: 'PATCH',
      body: { name },
    });
    setLibraryFiles((files) => files.map((item) => (item.id === data.file.id ? data.file : item)));
    if (activeFile?.id === data.file.id) setActiveFile(data.file);
  }

  function insertMarkdownTemplate(template, selectionOffset = 0) {
    if (!activeFile) return;
    const textarea = fileEditorRef.current;
    const start = textarea?.selectionStart ?? activeFileDraft.length;
    const end = textarea?.selectionEnd ?? start;
    const before = activeFileDraft.slice(0, start);
    const selectedText = activeFileDraft.slice(start, end);
    const after = activeFileDraft.slice(end);
    const text = typeof template === 'function' ? template(selectedText) : template;
    const next = `${before}${text}${after}`;
    setActiveFileDraft(next);
    window.setTimeout(() => {
      fileEditorRef.current?.focus();
      const position = start + Math.max(0, selectionOffset);
      fileEditorRef.current?.setSelectionRange(position, position);
    }, 0);
  }

  function getActiveMarkdownSelection() {
    const textarea = fileEditorRef.current;
    if (textarea && typeof textarea.selectionStart === 'number') {
      return {
        start: textarea.selectionStart,
        end: textarea.selectionEnd ?? textarea.selectionStart,
        text: activeFileDraft.slice(textarea.selectionStart, textarea.selectionEnd ?? textarea.selectionStart),
      };
    }
    const selectedText = compactText(window.getSelection?.()?.toString?.() || '');
    if (!selectedText) return { start: activeFileDraft.length, end: activeFileDraft.length, text: '' };
    const start = activeFileDraft.indexOf(selectedText);
    if (start < 0) return { start: activeFileDraft.length, end: activeFileDraft.length, text: selectedText };
    return { start, end: start + selectedText.length, text: selectedText };
  }

  async function deleteLibraryFile(file) {
    if (!activeLibrary || !file) return;
    if (!window.confirm(text.common.confirmDelete)) return;
    await api(`/libraries/${activeLibrary.id}/files/${file.id}`, { method: 'DELETE' });
    await loadLibraryFiles(activeLibrary.id);
    if (activeFile?.id === file.id) {
      setActiveFile(null);
      setActiveFileDraft('');
      localStorage.removeItem(fileDraftKey(file.id));
    }
    if (selectedFileFolderId === file.id) setSelectedFileFolderId(file.parent_id || null);
  }

  function normalizedCitationExportFormat(format) {
    const value = String(format || 'raw').toLowerCase();
    return ['apa', 'mla', 'gbt', 'latex'].includes(value) ? value : '';
  }

  function exportLibraryFile(file, format = 'raw') {
    if (!activeLibrary || !file || file.type === 'folder') return;
    const citationFormat = normalizedCitationExportFormat(format);
    const qs = citationFormat ? `?citation_format=${encodeURIComponent(citationFormat)}` : '';
    window.open(`${API}/libraries/${activeLibrary.id}/files/${file.id}/export${qs}`, '_blank', 'noopener,noreferrer');
  }

  function exportCurrentFileFolder(format = 'raw') {
    if (!activeLibrary) return;
    const citationFormat = normalizedCitationExportFormat(format);
    const params = new URLSearchParams();
    if (selectedFileFolderId) params.set('folder_id', selectedFileFolderId);
    if (citationFormat) params.set('citation_format', citationFormat);
    const qs = params.toString() ? `?${params.toString()}` : '';
    window.open(`${API}/libraries/${activeLibrary.id}/files/export${qs}`, '_blank', 'noopener,noreferrer');
  }

  function isFileDescendantOf(file, folderId, files) {
    const byId = new Map(files.map((item) => [item.id, item]));
    let parentId = file.parent_id;
    const seen = new Set();
    while (parentId && !seen.has(parentId)) {
      if (Number(parentId) === Number(folderId)) return true;
      seen.add(parentId);
      parentId = byId.get(parentId)?.parent_id;
    }
    return false;
  }


  function closeFileWorkbench() {
    if (!confirmUnsavedFileExit()) return;
    setActiveFile(null);
    setActiveFileDraft('');
    setFileWorkbenchOpen(false);
  }

  async function executeAgentAction(action) {
    if (!action?.type) return;
    if (action.type === 'copy_tag_to_folder') {
      const libraryId = action.library_id || activeLibrary?.id;
      if (!libraryId) return;
      const data = await api(`/libraries/${libraryId}/folders/copy-tag`, {
        method: 'POST',
        body: { tag: action.tag, folder: action.folder || action.tag },
      });
      showNotice(`${text.table.copySuccess} · ${data.copied || 0}`);
      await loadLibraries();
      if (activeLibrary?.id === libraryId) {
        await loadLibraryPapers(libraryId, tableFilters);
      }
      return;
    }
    if (action.type === 'open_file') {
      await openLibraryFileById(action.library_id || activeLibrary?.id, action.file_id);
    }
  }

  function clearPdfTranslationPopup(options = {}) {
    translationRequestRef.current += 1;
    translationRangeRef.current = null;
    lastTranslatedSelectionRef.current = '';
    setTranslationPopup(null);
    if (!options.keepSelection) {
      window.getSelection?.()?.removeAllRanges?.();
    }
  }

  async function translatePdfText(sourceText, position = null) {
    const source = String(sourceText || '').trim();
    if (!source || source.length < 2) return;
    const requestId = translationRequestRef.current + 1;
    translationRequestRef.current = requestId;
    setTranslationPopup({
      source,
      content: '',
      loading: true,
      error: '',
      x: position?.x ?? null,
      y: position?.y ?? null,
    });
    try {
      await streamApi('/translate/stream', {
        text: source,
        target_language: locale === 'zh' ? '中文' : 'English',
        llm: llmSettings,
        context: {
          paper_title: pdfViewer?.title || '',
          paper_id: pdfViewer?.paperId || null,
        },
      }, (event, data) => {
        if (translationRequestRef.current !== requestId) return;
        if (event === 'delta') {
          setTranslationPopup((current) => current ? { ...current, content: `${current.content || ''}${data.content || ''}`, loading: true } : current);
        }
        if (event === 'done') {
          setTranslationPopup((current) => current ? { ...current, loading: false } : current);
        }
        if (event === 'error') {
          setTranslationPopup((current) => current ? { ...current, loading: false, error: data.error || '翻译失败' } : current);
        }
      });
    } catch (err) {
      if (translationRequestRef.current === requestId) {
        setTranslationPopup((current) => current ? { ...current, loading: false, error: err.message || '翻译失败' } : current);
      }
    }
  }

  function isPaperSelected(paperId) {
    return selectedAll ? !selectedExcluded.has(paperId) : selected.has(paperId);
  }

  function togglePaperSelection(paperId, checked) {
    if (selectedAll) {
      const next = new Set(selectedExcluded);
      checked ? next.delete(paperId) : next.add(paperId);
      setSelectedExcluded(next);
      return;
    }
    const next = new Set(selected);
    checked ? next.add(paperId) : next.delete(paperId);
    setSelected(next);
  }

  function toggleSelectAllLibrary() {
    if (selectedAll) {
      resetSelection();
      return;
    }
    setSelected(new Set());
    setSelectedExcluded(new Set());
    setSelectedAll(true);
  }

  function citationSelectionPayload(extra = {}) {
    const filtersPayload = {
      keyword: tableFilters.keyword || '',
      venue: venueParam(tableFilters),
      venues: venueParam(tableFilters),
      year_from: tableFilters.year_from || '',
      year_to: tableFilters.year_to || '',
      rank: rankParam(tableFilters),
      status: tableFilters.status || '',
      tag: tableFilters.tag || '',
      folder: tableFilters.folder || '',
    };
    return selectedAll
      ? { ...extra, ...filtersPayload, all: true, excluded_ids: [...selectedExcluded] }
      : { ...extra, paper_ids: [...selected] };
  }

  useEffect(() => {
    let cancelled = false;
    async function loadCitationStatus() {
      if (!activeLibrary || selectedCount === 0) {
        setCitationExportStatus({ total: 0, ready: 0, pending: 0, failed: 0, exportable: false });
        return;
      }
      try {
        const data = await api(`/libraries/${activeLibrary.id}/papers/citations/status`, {
          method: 'POST',
          body: citationSelectionPayload(),
        });
        if (!cancelled) setCitationExportStatus(data);
      } catch {
        if (!cancelled) setCitationExportStatus({ total: selectedCount, ready: 0, pending: selectedCount, failed: 0, exportable: false });
      }
    }
    loadCitationStatus();
    const timer = selectedCount ? window.setInterval(loadCitationStatus, 5000) : null;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [activeLibrary?.id, selectedAll, selectedKey, selectedExcludedKey, selectedCount]);

  function openEditLibrary(library) {
    setEditingLibrary(library);
    setFilters({
      ...(library.filters_json || emptyFilters()),
      folders: library.filters_json?.folders || [],
    });
    setLibraryModalOpen(true);
  }

  function openContextMenu(event, type, target) {
    event.preventDefault();
    setContextMenu({ type, target, x: event.clientX, y: event.clientY });
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  async function createLibrary(payload) {
    setBusy(true);
    setLibraryCreateStatus('running');
    setLibraryCreateBackgrounded(false);
    setLibraryModalOpen(false);
    try {
      let data;
      if (payload.source === 'pdf') {
        const form = new FormData();
        form.append('name', payload.name);
        form.append('description', payload.description || '');
        form.append('owner_name', userEmail || 'local');
        Array.from(payload.files || []).forEach((file) => form.append('files', file));
        data = await api('/libraries/from-pdfs?async=1', { method: 'POST', body: form });
        setPdfTask(data.task);
        setPdfTaskBackgrounded(false);
        if (data.library) {
          await loadLibraries();
          setActiveLibrary(data.library);
          setExpandedLibraries((items) => new Set([...items, data.library.id]));
        }
        navigate('scholarx');
        return;
      } else {
        data = await api('/libraries', {
          method: 'POST',
          body: {
            ...payload,
            seed: true,
            filters: payload,
            owner_name: userEmail || 'local',
            llm: llmSettings,
          },
        });
      }
      await loadLibraries();
      setActiveLibrary(data.library);
      setExpandedLibraries((items) => new Set([...items, data.library.id]));
      const nextFilters = emptyTableFilters();
      setTableFilters(nextFilters);
      resetSelection();
      await loadLibraryPapers(data.library.id, nextFilters);
      if (data.search_summary?.strategy?.endsWith('abstract_filter')) {
        const usedBroadSearch = data.search_summary.strategy === 'broad_abstract_filter';
        const reviewCount = data.search_summary.needs_review || 0;
        showNotice(locale === 'zh'
          ? `${usedBroadSearch ? '扩展检索' : '初始检索'} ${data.search_summary.candidates} 篇，加入 ${data.search_summary.added} 篇${reviewCount ? `，其中 ${reviewCount} 篇待确认` : ''}`
          : `${usedBroadSearch ? 'Expanded' : 'Initial'} search found ${data.search_summary.candidates}; added ${data.search_summary.added}${reviewCount ? `, ${reviewCount} need review` : ''}`);
      }
      setLibraryCreateStatus('done');
      navigate('scholarx');
      window.setTimeout(() => setLibraryCreateStatus(null), 900);
    } catch (err) {
      setLibraryCreateStatus('error');
      setError(err.message);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function searchAndAddPapers(paperIds) {
    if (!activeLibrary || !paperIds.length) return;
    setBusy(true);
    try {
      await api(`/libraries/${activeLibrary.id}/papers`, { method: 'POST', body: { paper_ids: paperIds } });
      await loadLibraries();
      await loadLibraryPapers(activeLibrary.id, { ...tableFilters, page: 1 });
      setAddPaperModalOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function uploadPdfsToActiveLibrary(files) {
    if (!activeLibrary || !files?.length) return;
    setBusy(true);
    try {
      const form = new FormData();
      Array.from(files).forEach((file) => form.append('files', file));
      const data = await api(`/libraries/${activeLibrary.id}/uploads/pdf?async=1`, { method: 'POST', body: form });
      setPdfTask(data.task);
      setPdfTaskBackgrounded(false);
      setAddPaperModalOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function storePdfForPaper(paper, file) {
    if (!activeLibrary || !file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const upload = await api(`/libraries/${activeLibrary.id}/papers/${paper.id}/pdf`, { method: 'POST', body: form });
      await loadLibraryPapers(activeLibrary.id, tableFilters);
      setDetailPaper((current) => (current?.id === paper.id ? { ...current, pdf_url: upload.pdf_url || current.pdf_url } : current));
      setPendingPdfUpload(null);
    } finally {
      setBusy(false);
    }
  }

  async function uploadPdfForPaper(paper, file) {
    if (!activeLibrary || !file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const check = await api(`/libraries/${activeLibrary.id}/papers/${paper.id}/pdf/check`, { method: 'POST', body: form });
      setPendingPdfUpload({ paper, file, check });
    } finally {
      setBusy(false);
    }
  }

  async function associatePaperToDblp(sourcePaper, targetPaperId) {
    if (!activeLibrary || !sourcePaper || !targetPaperId) return;
    setBusy(true);
    try {
      await api(`/libraries/${activeLibrary.id}/papers/${sourcePaper.id}/associate`, {
        method: 'POST',
        body: { target_paper_id: targetPaperId },
      });
      await loadLibraries();
      await loadLibraryPapers(activeLibrary.id, tableFilters);
      setAssociatingPaper(null);
      showNotice(locale === 'zh' ? 'PDF 已重新链接' : 'PDF relinked');
    } finally {
      setBusy(false);
    }
  }

  async function downloadLibraryPapers(format) {
    if (!activeLibrary || selectedCount === 0) return;
    const primarySort = primaryTableSort(tableFilters);
    await downloadApiFile(
      `/libraries/${activeLibrary.id}/papers/export`,
      {
        method: 'POST',
        body: citationSelectionPayload({
          format,
          sort: serializeTableSorts(tableFilters),
          sort_by: primarySort.column,
          sort_dir: primarySort.dir,
        }),
      },
      `scholarx-papers.${format === 'xlsx' ? 'xlsx' : 'csv'}`,
    );
  }

  async function exportSelectedCitations(format) {
    if (!activeLibrary || selectedCount === 0 || !citationExportStatus.exportable) return;
    await downloadApiFile(
      `/libraries/${activeLibrary.id}/papers/citations/export`,
      {
        method: 'POST',
        body: citationSelectionPayload({ format }),
      },
      `scholarx-citations.${format === 'bib' ? 'bib' : 'txt'}`,
    );
  }

  async function retrySelectedCitations() {
    if (!activeLibrary || selectedCount === 0) return;
    const data = await api(`/libraries/${activeLibrary.id}/papers/citations/retry`, {
      method: 'POST',
      body: citationSelectionPayload(),
    });
    setCitationExportStatus(data.citation_status || { total: selectedCount, ready: 0, pending: selectedCount, failed: 0, exportable: false });
    showNotice(`${text.workbench.citationFetching}: ${data.retrying || 0}`);
  }

  async function updateLibrary(payload) {
    if (!editingLibrary) return;
    setBusy(true);
    setLibraryModalOpen(false);
    const oldLibrary = editingLibrary;
    try {
      const preservedTagDefinitions = activeLibrary?.id === oldLibrary.id
        ? tagDefinitions
        : oldLibrary.filters_json?.tag_definitions || oldLibrary.filters_json?.tags || [];
      const sharedWith = payload.shared_with ?? oldLibrary.filters_json?.shared_with ?? [];
      const filtersJson = {
        ...(oldLibrary.filters_json || {}),
        ...(payload.filters || {}),
        shared_with: sharedWith,
        tag_definitions: preservedTagDefinitions,
        folders: payload.folders || oldLibrary.filters_json?.folders || [],
      };
      const data = await api(`/libraries/${oldLibrary.id}`, {
        method: 'PATCH',
        body: {
          name: payload.name || oldLibrary.name,
          description: payload.description || '',
          mode: oldLibrary.mode || 'static',
          is_shared: Boolean(sharedWith.length),
          filters: filtersJson,
        },
      });
      setLibraries((items) => items.map((item) => (item.id === data.library.id ? data.library : item)));
      if (activeLibrary?.id === data.library.id) setActiveLibrary(data.library);
      setEditingLibrary(null);
      showNotice(locale === 'zh' ? '论文库信息已保存' : 'Library info saved');
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function updateLibrarySharing(library, sharedWith) {
    if (!library) return;
    setBusy(true);
    try {
      const filtersJson = {
        ...(library.filters_json || {}),
        shared_with: sharedWith,
      };
      const data = await api(`/libraries/${library.id}`, {
        method: 'PATCH',
        body: {
          name: library.name,
          description: library.description || '',
          mode: 'static',
          filters: filtersJson,
          is_shared: Boolean(sharedWith.length),
        },
      });
      setLibraries((items) => items.map((item) => (item.id === data.library.id ? data.library : item)));
      if (activeLibrary?.id === data.library.id) setActiveLibrary(data.library);
      setSharingLibrary(null);
      showNotice(locale === 'zh' ? '共享设置已保存' : 'Sharing settings saved');
    } finally {
      setBusy(false);
    }
  }

  async function syncLibrary(library) {
    if (!library) return;
    setBusy(true);
    try {
      const data = await api(`/libraries/${library.id}/sync`, { method: 'POST', body: {} });
      await loadLibraries();
      await loadLibraryPapers(library.id);
      showNotice(locale === 'zh' ? `检索已更新，新增 ${data.added || 0} 篇` : `Search refreshed, ${data.added || 0} added`);
    } finally {
      setBusy(false);
    }
  }

  async function enrichPaper(paper) {
    setBusy(true);
    try {
      await api(`/papers/${paper.id}/details`, { method: 'POST', body: {} });
      await loadLibraryPapers();
    } finally {
      setBusy(false);
    }
  }

  async function removePaper(paper) {
    if (!activeLibrary) return;
    await api(`/libraries/${activeLibrary.id}/papers/${paper.id}`, { method: 'DELETE' });
    await loadLibraryPapers();
  }

  function openPaperPdf(paper, title = displayPaperTitle(paper)) {
    const snapshot = snapshotPaperViewState();
    pdfReturnListStateRef.current = snapshot;
    if (snapshot) writeStoredPaperViewState(snapshot.libraryId, snapshot);
    setPdfViewer({ url: paper.pdf_url, title, paperId: paper.id });
  }

  function scrollPaperRowIntoView(paperId, { flash = true } = {}) {
    window.setTimeout(() => {
      const wrap = paperTableWrapRef.current;
      const row = wrap?.querySelector(`[data-paper-id="${paperId}"]`);
      if (!wrap || !row) return;
      const wrapRect = wrap.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const rowTop = rowRect.top - wrapRect.top + wrap.scrollTop;
      const targetTop = Math.max(0, rowTop - (wrap.clientHeight - rowRect.height) / 2);
      wrap.scrollTo({ top: targetTop, behavior: 'smooth' });
      if (!flash) return;
      row.classList.add('citation-target-flash');
      window.setTimeout(() => row.classList.remove('citation-target-flash'), 1300);
    }, 0);
  }

  function openCitationReference(reference) {
    const parsed = parseCitationId(reference?.refId || reference?.id);
    const paperId = reference?.paperId || reference?.paper_id || parsed.paperId;
    if (!paperId) return;
    const paper = libraryPapers.find((item) => Number(item.id) === Number(paperId));
    const chunkId = reference?.chunkId ?? reference?.chunk_id ?? parsed.chunkId;
    const page = reference?.page || reference?.page_number || reference?.pageNumber || null;
    const quote = reference?.chunkText || reference?.text || reference?.snippet || reference?.chunk || '';
    if (!chunkId && !page) {
      scrollPaperRowIntoView(paperId);
      return;
    }
    if (paper?.pdf_url || reference?.pdfUrl || reference?.pdf_url) {
      const url = paper?.pdf_url || reference.pdfUrl || reference.pdf_url;
      const snapshot = snapshotPaperViewState();
      pdfReturnListStateRef.current = snapshot;
      if (snapshot) writeStoredPaperViewState(snapshot.libraryId, snapshot);
      setPdfViewer({
        url,
        title: reference?.title || (paper ? displayPaperTitle(paper) : ''),
        paperId,
        target: {
          page,
          chunkId,
          quote,
        },
      });
      return;
    }
    scrollPaperRowIntoView(paperId);
  }

  function closePaperPdf() {
    clearPdfTranslationPopup();
    const returnState = pdfReturnListStateRef.current
      || readStoredPaperViewState(activeLibrary?.id);
    setPdfViewer(null);
    if (returnState?.filters) setTableFilters(returnState.filters);
    schedulePaperScrollRestore(returnState?.scrollTop || 0);
    pdfReturnListStateRef.current = null;
  }

  function openRenamePaperModal(paper) {
    setRenamingPaper(paper);
    setRenamingPaperTitle(displayPaperTitle(paper));
  }

  function openPaperDetails(paper) {
    setDetailPaper(paper);
  }

  async function savePaperDetails(payload) {
    if (!activeLibrary || !detailPaper) return;
    setBusy(true);
    try {
      const data = await api(`/libraries/${activeLibrary.id}/papers/${detailPaper.id}`, {
        method: 'PATCH',
        body: {
          title: payload.title,
          authors: payload.authors,
          pub_year: payload.pub_year,
          venue: payload.venue,
          abstract: payload.abstract,
        },
      });
      const updatedPaper = data.paper || {
        ...detailPaper,
        title: payload.title.trim(),
        authors: payload.authors,
        pub_year: payload.pub_year,
        abstract: payload.abstract.trim(),
        abstract_source: payload.abstract?.trim() ? 'manual' : '',
        metadata_json: { ...(detailPaper.metadata_json || {}), manual_venue: payload.venue.trim() },
      };
      setLibraryPapers((papers) => papers.map((paper) => (
        paper.id === detailPaper.id ? updatedPaper : paper
      )));
      setDetailPaper(updatedPaper);
      showNotice(text.table.detailsSaved);
    } finally {
      setBusy(false);
    }
  }

  async function unlinkPaperPdf() {
    if (!activeLibrary || !detailPaper?.pdf_url) return;
    setBusy(true);
    try {
      const data = await api(`/libraries/${activeLibrary.id}/papers/${detailPaper.id}/pdf`, { method: 'DELETE' });
      const updatedPaper = data.paper || {
        ...detailPaper,
        dblp_key: null,
        authors: [],
        pub_year: null,
        pub_url: '',
        doi_url: '',
        paper_details: {},
        ref_venue: null,
        venue_name: null,
        venue_abbr: null,
        main_venue_abbr: null,
        main_venue_name: null,
        rank: null,
        abstract: '',
        abstract_source: '',
        detail_snippet: '',
        bib: '',
        metadata_json: { ...(detailPaper.metadata_json || {}), index_unlinked_at: new Date().toISOString() },
      };
      setLibraryPapers((papers) => papers.map((paper) => (
        paper.id === detailPaper.id ? updatedPaper : paper
      )));
      setDetailPaper(updatedPaper);
      showNotice(text.table.pdfUnlinked);
    } finally {
      setBusy(false);
    }
  }

  async function renameUploadedPaper() {
    if (!activeLibrary || !renamingPaper) return;
    const nextTitle = renamingPaperTitle.trim();
    if (!nextTitle || nextTitle === displayPaperTitle(renamingPaper)) return;
    setBusy(true);
    try {
      const data = await api(`/libraries/${activeLibrary.id}/papers/${renamingPaper.id}`, {
        method: 'PATCH',
        body: { title: nextTitle },
      });
      const updatedTitle = data.title || nextTitle;
      setLibraryPapers((papers) => papers.map((paper) => (
        paper.id === renamingPaper.id ? { ...paper, title: updatedTitle } : paper
      )));
      setRenamingPaper(null);
      setRenamingPaperTitle('');
      showNotice(text.table.renameSuccess);
    } finally {
      setBusy(false);
    }
  }

  async function deleteLibrary(library) {
    if (!library) return;
    const confirmed = window.confirm(text.library.deleteConfirm);
    if (!confirmed) return;
    setBusy(true);
    try {
      await api(`/libraries/${library.id}`, { method: 'DELETE' });
      const nextLibraries = libraries.filter((item) => item.id !== library.id);
      setLibraries(nextLibraries);
      if (activeLibrary?.id === library.id) {
        const nextActive = nextLibraries[0] || null;
        setActiveLibrary(nextActive);
        setLibraryPapers([]);
        setPaperTotal(0);
        resetSelection();
        setPdfViewer(null);
        if (nextActive) await loadLibraryPapers(nextActive.id);
      }
      await loadLibraries();
    } finally {
      setBusy(false);
    }
  }

  function openLibraryFolder(library, folder = '') {
    const nextFilters = { ...tableFilters, folder, page: 1 };
    setExpandedLibraries((items) => new Set([...items, library.id]));
    setExpandedFolders((items) => new Set([...items, ...folderAncestors(folder)]));
    setActiveLibrary(library);
    setActiveFile(null);
    setActiveFileDraft('');
    setFileWorkbenchOpen(false);
    setTableFilters(nextFilters);
    resetSelection();
    setPdfViewer(null);
    setAssociatingPaper(null);
    loadLibraryPapers(library.id, nextFilters);
  }

  function openLibraryFiles(library) {
    if (!library) return;
    if (!confirmUnsavedFileExit()) return;
    setExpandedLibraries((items) => new Set([...items, library.id]));
    setActiveLibrary(library);
    setActiveFile(null);
    setActiveFileDraft('');
    setSelectedFileFolderId(null);
    setFileWorkbenchOpen(true);
    setAssociatingPaper(null);
    resetSelection();
  }

  function openFileWorkbenchForLayout(library) {
    if (!library) return;
    setExpandedLibraries((items) => new Set([...items, library.id]));
    setActiveLibrary(library);
    setSelectedFileFolderId(null);
    setFileWorkbenchOpen(true);
    setAssociatingPaper(null);
    resetSelection();
  }

  function selectChat(chat) {
    const targetLibraryId = chatLibraryId(chat);
    if (targetLibraryId && activeLibrary?.id !== targetLibraryId) {
      const targetLibrary = orderedLibraries.find((library) => library.id === targetLibraryId)
        || libraries.find((library) => library.id === targetLibraryId);
      if (targetLibrary) openLibraryFolder(targetLibrary);
    }
    setActiveChatId(chat.id);
    setDraft('');
    setEditingMessageIndex(null);
    setEditingMessageDraft('');
  }

  async function setPaperTags(paper, tags) {
    if (!activeLibrary) return;
    await api(`/libraries/${activeLibrary.id}/papers/${paper.id}`, { method: 'PATCH', body: { tags } });
    const autoFolder = [...tagDefinitions].reverse().find((tag) => tag.auto_folder && tags.includes(tag.name))?.name;
    setLibraryPapers((papers) => papers.map((item) => (
      item.id === paper.id
        ? { ...item, tags_json: tags, user_columns_json: autoFolder ? { ...(item.user_columns_json || {}), folder: autoFolder } : item.user_columns_json }
        : item
    )));
    if (tableFilters.folder && autoFolder && tableFilters.folder !== autoFolder) {
      await loadLibraryPapers(activeLibrary.id, tableFilters);
    }
  }

  async function moveSelectedToFolder(folder) {
    if (!activeLibrary || selectedCount === 0) return;
    const data = await api(`/libraries/${activeLibrary.id}/papers/move`, {
      method: 'POST',
      body: selectedAll
        ? { action: 'move', folder, current_folder: tableFilters.folder, all: true, excluded_ids: [...selectedExcluded] }
        : { action: 'move', folder, current_folder: tableFilters.folder, paper_ids: [...selected] },
    });
    showNotice(`${text.table.moveSuccess} · ${data.moved || 0}`);
    resetSelection();
    await loadLibraryPapers(activeLibrary.id, tableFilters);
  }

  async function copySelectedToFolder(folder) {
    if (!activeLibrary || selectedCount === 0) return;
    const data = await api(`/libraries/${activeLibrary.id}/papers/move`, {
      method: 'POST',
      body: selectedAll
        ? { action: 'copy', folder, current_folder: tableFilters.folder, all: true, excluded_ids: [...selectedExcluded] }
        : { action: 'copy', folder, current_folder: tableFilters.folder, paper_ids: [...selected] },
    });
    showNotice(`${text.table.copySuccess} · ${data.copied || 0}`);
    resetSelection();
    await loadLibraryPapers(activeLibrary.id, tableFilters);
  }

  async function movePaperToFolder(paper, folder) {
    if (!activeLibrary) return;
    const data = await api(`/libraries/${activeLibrary.id}/papers/move`, {
      method: 'POST',
      body: { action: 'move', folder, current_folder: tableFilters.folder, paper_ids: [paper.id] },
    });
    showNotice(`${text.table.moveSuccess} · ${data.moved || 0}`);
    await loadLibraryPapers(activeLibrary.id, tableFilters);
  }

  async function copyPaperToFolder(paper, folder) {
    if (!activeLibrary) return;
    const data = await api(`/libraries/${activeLibrary.id}/papers/move`, {
      method: 'POST',
      body: { action: 'copy', folder, current_folder: tableFilters.folder, paper_ids: [paper.id] },
    });
    showNotice(`${text.table.copySuccess} · ${data.copied || 0}`);
    await loadLibraryPapers(activeLibrary.id, tableFilters);
  }

  async function deleteFolder(library, folder) {
    if (!window.confirm(text.table.deleteFolderConfirm)) return;
    const data = await api(`/libraries/${library.id}/folders`, {
      method: 'DELETE',
      body: { folder },
    });
    setLibraries((items) => items.map((item) => (item.id === data.library.id ? data.library : item)));
    if (activeLibrary?.id === data.library.id) {
      setActiveLibrary(data.library);
      const parent = folder.split('/').slice(0, -1).join('/');
      const currentFolder = tableFilters.folder;
      const nextFolder = currentFolder === folder || currentFolder.startsWith(`${folder}/`) ? parent : currentFolder;
      const nextFilters = { ...tableFilters, folder: nextFolder, page: 1 };
      setTableFilters(nextFilters);
      resetSelection();
      await loadLibraryPapers(data.library.id, nextFilters);
    }
    setExpandedFolders((items) => new Set([...items].filter((item) => item !== folder && !item.startsWith(`${folder}/`))));
  }

  async function addFolder(library, folderName, parentFolder = '') {
    const nextName = normalizeFolderPath(folderName);
    if (!nextName) return;
    const folderPath = normalizeFolderPath([parentFolder, nextName].filter(Boolean).join('/'));
    const filtersJson = library.filters_json || {};
    const folders = [...new Set([...(filtersJson.folders || []), folderPath])];
    const data = await api(`/libraries/${library.id}`, {
      method: 'PATCH',
      body: { filters: { ...filtersJson, folders } },
    });
    setLibraries((items) => items.map((item) => (item.id === data.library.id ? data.library : item)));
    if (activeLibrary?.id === data.library.id) {
      setActiveLibrary(data.library);
    }
    setExpandedLibraries((items) => new Set([...items, library.id]));
    setExpandedFolders((items) => new Set([...items, parentFolder]));
    setFolderModalLibrary(null);
  }

  function openFolderModal(library, parentFolder = '') {
    setFolderModalLibrary({ library, parentFolder });
  }

  function openTagModal(tag = null) {
    setEditingTag(tag);
    setTagFilterOpen(false);
    setTagModalOpen(true);
  }

  async function openModelModal() {
    setModelModalOpen(true);
    setUserMenuOpen(false);
    setModelListLoading(true);
    setModelListError('');
    try {
      const data = await api('/llm/models');
      const models = data.models || [];
      const preferredModel = data.default_model || '';
      setAvailableModels(models);
      setLlmSettings((settings) => ({
        mode: settings.mode || 'single',
        model: !isInvalidModelId(settings.model) && models.some((model) => model.id === settings.model)
          ? settings.model
          : preferredModel,
        protocol: '',
      }));
      if (data.error) setModelListError(data.error);
    } catch (err) {
      setAvailableModels([]);
      setModelListError(err.message || text.user.modelLoadFailed);
    } finally {
      setModelListLoading(false);
    }
  }

  function saveModelSettings(nextSettings) {
    const fallbackModel = availableModels[0]?.id || '';
    setLlmSettings({
      mode: nextSettings.mode || 'single',
      model: isInvalidModelId(nextSettings.model) ? fallbackModel : nextSettings.model,
      protocol: '',
    });
    setModelModalOpen(false);
    showNotice(text.user.modelSaved);
  }

  function applyLayoutPreset(nextPreset, options = {}) {
    const preset = LAYOUT_PRESETS[nextPreset] || LAYOUT_PRESETS.default;
    if (!preset.filesOpen && fileWorkbenchOpen && !confirmUnsavedFileExit()) return;
    if (preset.filesOpen && !fileWorkbenchOpen && activeLibrary && !confirmUnsavedFileExit()) return;

    setLayoutPreset(nextPreset);
    if (options.persist !== false) {
      localStorage.setItem('scholarx.layoutPreset', nextPreset);
    }
    setLayoutMenuOpen(false);
    setColumns(preset.columns);
    setLeftPaneCollapsed(preset.leftCollapsed);
    setRightPaneCollapsed(preset.rightCollapsed);
    setFileSidebarCollapsed(preset.fileSidebarCollapsed);
    setFileSidebarMode('files');

    if (preset.filesOpen) {
      if (activeLibrary && !fileWorkbenchOpen) {
        openFileWorkbenchForLayout(activeLibrary);
      } else {
        setFileWorkbenchOpen(true);
      }
      return;
    }

    if (fileWorkbenchOpen) {
      setActiveFile(null);
      setActiveFileDraft('');
      setFileWorkbenchOpen(false);
    }
  }

  async function saveTagDefinition(tag) {
    if (!activeLibrary) return;
    const oldName = editingTag?.name;
    const nextDefinitions = oldName
      ? tagDefinitions.map((item) => (item.name === oldName ? tag : item))
      : [...tagDefinitions.filter((item) => item.name !== tag.name), tag];
    const filtersJson = activeLibrary.filters_json || {};
    const folders = tag.auto_folder
      ? [...new Set([...(filtersJson.folders || []), tag.name])]
      : filtersJson.folders || [];
    const nextLibrary = {
      ...activeLibrary,
      filters_json: { ...filtersJson, folders, tag_definitions: nextDefinitions },
    };
    await api(`/libraries/${activeLibrary.id}`, {
      method: 'PATCH',
      body: { filters: nextLibrary.filters_json },
    });
    if (oldName && oldName !== tag.name) {
      const changedPapers = libraryPapers
        .filter((paper) => (paper.tags_json || []).includes(oldName))
        .map((paper) => ({
          ...paper,
          tags_json: (paper.tags_json || []).map((item) => (item === oldName ? tag.name : item)),
        }));
      await Promise.all(changedPapers.map((paper) => (
        api(`/libraries/${activeLibrary.id}/papers/${paper.id}`, {
          method: 'PATCH',
          body: { tags: paper.tags_json },
        })
      )));
      setLibraryPapers((papers) => papers.map((paper) => changedPapers.find((item) => item.id === paper.id) || paper));
    }
    setActiveLibrary(nextLibrary);
    setLibraries((items) => items.map((item) => (item.id === nextLibrary.id ? nextLibrary : item)));
    await loadLibraryPapers(activeLibrary.id, tableFilters);
    setTagModalOpen(false);
    setEditingTag(null);
  }

  async function applyTagFilter(tag) {
    const nextFilters = { ...tableFilters, tag, page: 1 };
    setTableFilters(nextFilters);
    setTagFilterOpen(false);
  }

  function updateStreamingAssistant(updater) {
    updateActiveChat((chat) => {
      const nextMessages = [...(chat.messages || [])];
      const index = nextMessages.findLastIndex((message) => message.role === 'assistant' && message.streaming);
      if (index === -1) return {};
      nextMessages[index] = { ...nextMessages[index], ...updater(nextMessages[index]) };
      return { messages: nextMessages };
    });
  }

  function currentChatPaperIds() {
    return selectedChatPaperIds({ selectedAll, selectedIds, pdfViewer });
  }

  async function startWritingWizard(userMessage) {
    const targetVenue = targetVenueFromPrompt(userMessage);
    const domain = inferWritingDomain(userMessage, activeLibrary);
    let candidatePapers = libraryPapers;
    try {
      const data = await api(`/libraries/${activeLibrary.id}/papers?${new URLSearchParams({ page: 1, page_size: 120 }).toString()}`);
      candidatePapers = data.papers || libraryPapers;
    } catch {
      candidatePapers = libraryPapers;
    }
    const references = chooseReferencePapers(candidatePapers, userMessage, targetVenue);
    setWritingWizard({
      prompt: userMessage,
      step: 0,
      domain,
      targetVenue,
      references,
      citationStyle: 'GB/T 7714',
      outline: buildOutlineMarkdown({
        prompt: userMessage,
        library: activeLibrary,
        domain,
        references,
        citationStyle: 'GB/T 7714',
      }),
      status: '',
    });
  }

  async function streamMarkdownToFile(file, prompt, paperIds = [], options = {}) {
    if (!activeLibrary || !file) return;
    const abortController = new AbortController();
    chatAbortControllerRef.current = abortController;
    setChatBusy(true);
    setAiFileEditing(true);
    setFileWorkbenchOpen(true);
    setFileSourceMode(false);
    let generated = options.initialContent || '';
    setActiveFileDraft(generated);
    try {
      updateActiveChat((chat) => ({
        messages: [
          ...(chat.messages || []),
          {
            role: 'assistant',
            content: `${text.agent.fileCreated}：\`${file.name}\`\n\n正在写入文件...`,
            streaming: true,
            trace: [],
            paper_refs: [],
            pdf_evidence: [],
          },
        ],
      }));
      await streamApi('/chat/stream', {
        message: prompt,
        library_id: activeLibrary.id,
        paper_ids: paperIds,
        skill_ids: enabledSkillIds,
        user_key: userEmail || 'local',
        llm: llmSettings,
      }, (event, data) => {
        if (event === 'trace') {
          updateStreamingAssistant((message) => ({ trace: [...(message.trace || []), data] }));
        } else if (event === 'refs') {
          updateStreamingAssistant(() => ({ paper_refs: data.paper_refs || [] }));
        } else if (event === 'evidence') {
          updateStreamingAssistant(() => ({ pdf_evidence: data.pdf_evidence || [] }));
        } else if (event === 'delta') {
          generated += data.content || '';
          setActiveFileDraft(generated);
        } else if (event === 'done') {
          generated = data.answer || generated;
          setActiveFileDraft(generated);
          const toolActions = [{
            id: `open-file-${file.id}`,
            type: 'open_file',
            label: text.agent.wizardOpenFile,
            library_id: activeLibrary.id,
            file_id: file.id,
          }];
          updateStreamingAssistant((message) => ({
            content: `${text.agent.fileCreated}：\`${file.name}\`\n\n${options.doneMessage || '内容已写入文件库。'}`,
            provider: data.provider,
            protocol: data.protocol,
            model: data.model,
            paper_refs: data.paper_refs || [],
            pdf_evidence: data.pdf_evidence || [],
            retrieval_plan: data.retrieval_plan || {},
            trace: mergeChatTrace(message.trace || [], data.trace || []),
            tool_actions: toolActions,
            streaming: false,
          }));
        } else if (event === 'error') {
          throw new Error(data.error || '请求失败');
        }
      }, { signal: abortController.signal });
      await saveLibraryFileContent(file, generated);
      showNotice(`${text.workbench.fileSaved} · ${file.name}`);
    } catch (err) {
      if (abortController.signal.aborted || err?.name === 'AbortError') {
        updateStreamingAssistant((message) => ({
          content: message.content || text.agent.stopped,
          streaming: false,
        }));
      } else {
        updateStreamingAssistant(() => ({
          content: `${text.agent.requestFailed}${err.message}`,
          error: true,
          streaming: false,
        }));
      }
    } finally {
      if (chatAbortControllerRef.current === abortController) {
        chatAbortControllerRef.current = null;
      }
      setChatBusy(false);
      setAiFileEditing(false);
    }
  }

  async function createAndStreamCreativeFile(userMessage, paperIds = currentChatPaperIds()) {
    if (!activeLibrary) {
      await requestChatAnswer(userMessage);
      return;
    }
    const fileName = markdownFileNameFromPrompt(userMessage, 'draft');
    const file = await createMarkdownFile(selectedFileFolderId, {
      name: fileName,
      content: '',
      open: true,
      metadata: { source: 'agent_creative_task', prompt: userMessage },
    });
    if (!file) return;
    const references = libraryPapers.filter((paper) => paperIds.includes(paper.id));
    await streamMarkdownToFile(file, buildCreativeDraftPrompt(userMessage, file.name, references), paperIds, {
      doneMessage: '生成完成，已停在当前文件。',
    });
  }

  async function updateWizardPdf(paper, file) {
    if (!paper || !file) return;
    await storePdfForPaper(paper, file);
    const data = await api(`/libraries/${activeLibrary.id}/papers?${new URLSearchParams({ page: 1, page_size: 120 }).toString()}`);
    setLibraryPapers(data.papers || []);
    setWritingWizard((wizard) => {
      if (!wizard) return wizard;
      return {
        ...wizard,
        references: (wizard.references || []).map((item) => (
          item.id === paper.id ? { ...item, pdf_url: paper.pdf_url || 'uploaded' } : item
        )),
      };
    });
  }

  function updateWritingWizard(patch) {
    setWritingWizard((wizard) => (wizard ? { ...wizard, ...patch } : wizard));
  }

  async function nextWritingWizardStep() {
    const wizard = writingWizard;
    if (!wizard) return;
    if (wizard.step === 1 && (wizard.references || []).some((paper) => !paper.pdf_url)) {
      showNotice(text.agent.wizardNeedPdf);
      return;
    }
    if (wizard.step < 4) {
      setWritingWizard({ ...wizard, step: wizard.step + 1 });
      return;
    }
    const folder = await createLibraryFolderSilently(
      markdownFileNameFromPrompt(wizard.prompt, 'writing').replace(/\.md$/i, ''),
      selectedFileFolderId,
      { source: 'writing_wizard', prompt: wizard.prompt },
    );
    const outlineContent = wizard.outline || buildOutlineMarkdown({
      prompt: wizard.prompt,
      library: activeLibrary,
      domain: wizard.domain,
      references: wizard.references,
      citationStyle: wizard.citationStyle,
    });
    await createMarkdownFile(folder?.id || selectedFileFolderId, {
      name: 'outline.md',
      content: outlineContent,
      open: false,
      metadata: { source: 'writing_wizard_outline' },
    });
    const mainFile = await createMarkdownFile(folder?.id || selectedFileFolderId, {
      name: markdownFileNameFromPrompt(wizard.prompt, 'main-draft'),
      content: '',
      open: true,
      metadata: { source: 'writing_wizard_main', prompt: wizard.prompt },
    });
    setWritingWizard(null);
    await streamMarkdownToFile(
      mainFile,
      buildMainDraftPrompt({
        prompt: wizard.prompt,
        domain: wizard.domain,
        references: wizard.references,
        outline: outlineContent,
        citationStyle: wizard.citationStyle,
      }),
      (wizard.references || []).map((paper) => paper.id),
      { doneMessage: '主文档已根据大纲生成，outline.md 已存入同一文件夹。' },
    );
  }

  function previousWritingWizardStep() {
    setWritingWizard((wizard) => (
      wizard ? { ...wizard, step: Math.max(0, wizard.step - 1) } : wizard
    ));
  }

  async function requestMarkdownInlineCompletion({ before = '', after = '', documentText = '', fileName = '', onDelta }) {
    if (!activeLibrary || !activeFile) return '';
    const paperIds = currentChatPaperIds();
    const selectedPaperLines = paperIds.length
      ? libraryPapers
        .filter((paper) => paperIds.includes(paper.id))
        .map((paper) => `- ${displayPaperTitle(paper)} | ${displayVenue(paper).label} | ${paper.pub_year || ''}`)
        .join('\n')
      : '未指定选中论文。';
    const prompt = [
      '你是正文续写自动补全器，负责续写光标后的一小段正文。',
      '根据用户上下文的风格输出后续文字，不要寒暄，不要解释。',
      '输出长度控制在半句到 1 句话，30字以内。',
      `光标前 100 字：\n${before.slice(-100)}`,
      `光标后 100 字：\n${after.slice(0, 100)}`,
      '要求：像用户正在写的原文一样自然接上；如果光标后已有文字，补全内容必须能和后文顺滑衔接。',
    ].join('\n\n');
    const abortController = new AbortController();
    inlineCompletionAbortRef.current?.abort();
    inlineCompletionAbortRef.current = abortController;
    setAiFileEditing(true);
    let generated = '';
    try {
      await streamApi('/chat/stream', {
        message: prompt,
        library_id: activeLibrary.id,
        paper_ids: paperIds,
        skill_ids: enabledSkillIds,
        user_key: userEmail || 'local',
        llm: llmSettings,
      }, (event, data) => {
        if (event === 'delta') {
          generated += data.content || '';
          onDelta?.(generated.replace(/\[(?:P|p)\d+\]/g, '').trimStart());
        } else if (event === 'done') {
          generated = data.answer || generated;
        } else if (event === 'error') {
          throw new Error(data.error || '请求失败');
        }
      }, { signal: abortController.signal });
      return String(generated || '').replace(/\[(?:P|p)\d+\]/g, '').trim();
    } catch (err) {
      if (!(abortController.signal.aborted || err?.name === 'AbortError')) setError(err.message);
      return '';
    } finally {
      if (inlineCompletionAbortRef.current === abortController) {
        inlineCompletionAbortRef.current = null;
      }
      setAiFileEditing(false);
    }
  }

  async function sendChatMessage(value) {
    if (chatAbortControllerRef.current) return;
    if (!value.trim()) return;
    const userMessage = value.trim();
    setDraft('');
    setEditingMessageIndex(null);
    setEditingMessageDraft('');
    updateActiveChat((chat) => ({
      title: chat.title === text.agent.newChat ? userMessage.slice(0, 36) : chat.title,
      messages: [...(chat.messages || []), { role: 'user', content: userMessage }],
    }));
    const paperIds = currentChatPaperIds();
    if (!fileWorkbenchOpen && isPlanningWritingTask(userMessage) && !paperIds.length && activeLibrary) {
      await startWritingWizard(userMessage);
      updateActiveChat((chat) => ({
        messages: [
          ...(chat.messages || []),
          { role: 'assistant', content: `已打开${text.agent.writingWizard}。`, tool_actions: [] },
        ],
      }));
      return;
    }
    if (!fileWorkbenchOpen && isCreativeWritingTask(userMessage) && activeLibrary) {
      await createAndStreamCreativeFile(userMessage, paperIds);
      return;
    }
    await requestChatAnswer(userMessage);
  }

  async function requestChatAnswer(userMessage) {
    const chatPaperIds = currentChatPaperIds();
    const requestBody = {
      message: userMessage,
      library_id: activeLibrary?.id,
      paper_ids: chatPaperIds,
      skill_ids: enabledSkillIds,
      user_key: userEmail || 'local',
      llm: llmSettings,
    };

    const abortController = new AbortController();
    chatAbortControllerRef.current = abortController;
    setChatBusy(true);
    try {
      updateActiveChat((chat) => ({
        messages: [
          ...(chat.messages || []),
          { role: 'assistant', content: '', streaming: true, trace: [], paper_refs: [], pdf_evidence: [] },
        ],
      }));
      await streamApi('/chat/stream', requestBody, (event, data) => {
        if (event === 'trace') {
          updateStreamingAssistant((message) => ({ trace: [...(message.trace || []), data] }));
        } else if (event === 'refs') {
          updateStreamingAssistant(() => ({ paper_refs: data.paper_refs || [] }));
        } else if (event === 'evidence') {
          updateStreamingAssistant(() => ({ pdf_evidence: data.pdf_evidence || [] }));
        } else if (event === 'plan') {
          updateStreamingAssistant(() => ({ retrieval_plan: data.retrieval_plan || {} }));
        } else if (event === 'tool_actions') {
          updateStreamingAssistant(() => ({ tool_actions: data.tool_actions || [] }));
        } else if (event === 'delta') {
          updateStreamingAssistant((message) => ({ content: `${message.content || ''}${data.content || ''}` }));
        } else if (event === 'done') {
          const toolActions = data.tool_actions || [];
          updateStreamingAssistant((message) => ({
            content: data.answer,
            provider: data.provider,
            protocol: data.protocol,
            model: data.model,
            paper_refs: data.paper_refs || [],
            pdf_evidence: data.pdf_evidence || [],
            retrieval_plan: data.retrieval_plan || {},
            trace: mergeChatTrace(message.trace || [], data.trace || []),
            tool_actions: toolActions,
            streaming: false,
          }));
          toolActions.filter((action) => action.type === 'open_file').forEach((action) => {
            executeAgentAction(action).catch((err) => setError(err.message));
          });
        } else if (event === 'error') {
          throw new Error(data.error || '请求失败');
        }
      }, { signal: abortController.signal });
    } catch (err) {
      if (abortController.signal.aborted || err?.name === 'AbortError') {
        updateActiveChat((chat) => ({
          messages: (chat.messages || []).map((message) => (
            message.role === 'assistant' && message.streaming
              ? { ...message, content: message.content || text.agent.stopped, streaming: false }
              : message
          )),
        }));
      } else {
        updateActiveChat((chat) => ({
          messages: (chat.messages || []).map((message) => (
            message.role === 'assistant' && message.streaming
              ? { ...message, content: `${text.agent.requestFailed}${err.message}`, error: true, streaming: false }
              : message
          )),
        }));
      }
    } finally {
      if (chatAbortControllerRef.current === abortController) {
        chatAbortControllerRef.current = null;
      }
      setChatBusy(false);
    }
  }

  function stopChatGeneration() {
    const controller = chatAbortControllerRef.current;
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
  }

  function startNewChat() {
    const existingDraft = chatSessions.find((chat) => (
      chatBelongsToLibrary(chat, activeLibraryId) && !hasUserMessages(chat)
    ));
    if (existingDraft) {
      setActiveChatId(existingDraft.id);
      setDraft('');
      setEditingMessageIndex(null);
      setEditingMessageDraft('');
      return;
    }
    const next = createInitialChat(text, activeLibrary);
    setChatSessions((sessions) => [next, ...sessions]);
    setActiveChatId(next.id);
    setDraft('');
    setEditingMessageIndex(null);
    setEditingMessageDraft('');
  }

  function startEditMessage(index, content) {
    setEditingMessageIndex(index);
    setEditingMessageDraft(content);
  }

  async function resendEditedMessage() {
    if (editingMessageIndex === null) return;
    const originalMessage = activeChat.messages?.[editingMessageIndex];
    const nextContent = editingMessageDraft.trim();
    if (!nextContent || originalMessage?.role !== 'user' || nextContent === String(originalMessage.content || '').trim()) {
      return;
    }
    updateActiveChat((chat) => ({
      title: editingMessageIndex === 1 && chat.title !== text.agent.newChat ? nextContent.slice(0, 36) : chat.title,
      messages: [
        ...(chat.messages || []).slice(0, editingMessageIndex),
        { ...originalMessage, content: nextContent },
      ],
    }));
    setEditingMessageIndex(null);
    setEditingMessageDraft('');
    await requestChatAnswer(nextContent);
  }

  function deleteMessage(indexToDelete) {
    updateActiveChat((chat) => ({
      messages: (chat.messages || []).filter((_message, index) => index !== indexToDelete),
    }));
  }

  function deleteChat(chatId) {
    setChatSessions((sessions) => {
      const remaining = sessions.filter((chat) => chat.id !== chatId);
      if (chatId !== activeChat.id) return remaining;
      const nextChat = remaining.find((chat) => chatBelongsToLibrary(chat, activeLibraryId));
      if (nextChat) {
        setActiveChatId(nextChat.id);
        return remaining;
      }
      const draftChat = createInitialChat(text, activeLibrary);
      setActiveChatId(draftChat.id);
      return [draftChat, ...remaining];
    });
    setDraft('');
    setEditingMessageIndex(null);
    setEditingMessageDraft('');
  }

  async function installSkill(skill) {
    const data = await api(`/skills/${skill.id}/install`, { method: 'POST' });
    setSkills((items) => items.map((item) => (item.id === skill.id ? data.skill : item)));
    setActiveSkillIds((ids) => [...new Set([...ids, skill.id])]);
  }

  async function uninstallSkill(skill) {
    await api(`/skills/${skill.id}/uninstall`, { method: 'POST' });
    setSkills((items) => items.map((item) => (item.id === skill.id ? { ...item, installed: false, installed_at: null } : item)));
    setActiveSkillIds((ids) => ids.filter((skillId) => skillId !== skill.id));
  }

  function toggleSkill(skillId, checked) {
    setActiveSkillIds((ids) => (
      checked ? [...new Set([...ids, skillId])] : ids.filter((item) => item !== skillId)
    ));
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    localStorage.removeItem('scholarx.localUser');
    setSession(null);
    navigate('home');
  }

  if (!authReady) {
    return <main className="loading-screen"><Sparkles size={28} /><p>Loading ScholarX...</p></main>;
  }

  if (view !== 'home' && !userEmail) {
    return (
      <AuthPage
        text={text}
        locale={locale}
        setLocale={setLocale}
        onHome={() => navigate('home')}
        onAuthed={async (nextSession) => {
          if (supabase) {
            await supabase.auth.getSession();
          }
          setSession(nextSession);
          navigate('scholarx');
        }}
        supabase={supabase}
      />
    );
  }

  if (view === 'home') {
    return (
      <HomePage
        text={text}
        locale={locale}
        setLocale={setLocale}
        stats={stats}
        userEmail={userEmail}
        onDemo={() => navigate('scholarx')}
        onSignOut={signOut}
      />
    );
  }

  if (view === 'profile') {
    return (
      <ProfilePage
        text={text}
        user={user}
        userEmail={userEmail}
        onBack={() => navigate('scholarx')}
        supabase={supabase}
      />
    );
  }

  if (view === 'trash') {
    return (
      <TrashPage
        text={text}
        userEmail={userEmail}
        onBack={() => navigate('scholarx')}
      />
    );
  }

  return (
    <main
      className="app-shell"
      style={{
        gridTemplateColumns: `${leftPaneCollapsed ? '0px' : `minmax(0, ${columns.left}fr)`} 6px minmax(0, ${columns.middle}fr) 6px ${rightPaneCollapsed ? '0px' : `minmax(0, ${columns.right}fr)`}`,
      }}
    >
      <aside className={`library-pane ${leftPaneCollapsed ? 'collapsed' : ''}`}>
        <div className="brand-row">
          <div>
            <button className="workbench-logo" onClick={() => navigate('home')}>ScholarX</button>
            <p className="workbench-index-meta">
              {stats
                ? (
                  <>
                    <span>{text.workbench.indexedPrefix}{Number(stats.papers || 0).toLocaleString()}{text.workbench.indexedSuffix}</span>
                    {stats.dblp_inserted_at && <span>{text.workbench.updatedAt}{formatDateOnly(stats.dblp_inserted_at)}</span>}
                  </>
                )
                : text.brand.fallback}
            </p>
          </div>
          <div className="pane-tools layout-menu-wrap" ref={layoutMenuRef}>
            <button
              className={`icon-button layout-menu-trigger ${layoutMenuOpen ? 'active' : ''}`}
              title={text.common.layoutMenu}
              aria-label={text.common.layoutMenu}
              aria-haspopup="menu"
              aria-expanded={layoutMenuOpen}
              onClick={() => setLayoutMenuOpen((open) => !open)}
            >
              <LayoutDashboard size={17} />
            </button>
            {layoutMenuOpen && (
              <div className="layout-menu" role="menu">
                {layoutOptions.map((option) => (
                  <button
                    key={option.id}
                    className={layoutPreset === option.id ? 'active' : ''}
                    role="menuitemradio"
                    aria-checked={layoutPreset === option.id}
                    onClick={() => applyLayoutPreset(option.id)}
                  >
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                    {layoutPreset === option.id && <Check size={15} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}
        <button className="primary-button add-library-button" onClick={openLibraryModal} disabled={busy && !pdfTask}>
          <Plus size={17} /> {pdfTask && ['running', 'queued'].includes(pdfTask.status) ? (locale === 'zh' ? '后台任务处理中' : 'Background task') : text.library.add}
        </button>

        <section className="library-list">
          {orderedLibraries.map((library) => (
            <LibraryTree
              key={library.id}
              library={library}
              activeLibrary={activeLibrary}
              activeFolder={tableFilters.folder}
              paperTotal={libraryTotals[library.id] ?? library.paper_count ?? 0}
              text={text}
              locale={locale}
              expandedLibraries={expandedLibraries}
              expandedFolders={expandedFolders}
              setExpandedLibraries={setExpandedLibraries}
              setExpandedFolders={setExpandedFolders}
              onOpenFolder={openLibraryFolder}
              onOpenFiles={openLibraryFiles}
              onEditLibrary={openEditLibrary}
              onShareLibrary={(targetLibrary) => setSharingLibrary(targetLibrary)}
              onContextMenu={openContextMenu}
            />
          ))}
          {!libraries.length && <p className="library-empty">{text.library.empty}</p>}
        </section>
        <div className="sidebar-user-wrap" ref={userMenuRef}>
          {userMenuOpen && (
            <div className="sidebar-user-menu">
              <button onClick={() => navigate('profile')}><User size={15} /> {text.user.profile}</button>
              <button onClick={openModelModal}><SlidersHorizontal size={15} /> {text.user.modelSelect}</button>
              <button onClick={() => {
                setMemoryModalOpen(true);
                setUserMenuOpen(false);
              }}>
                <BookOpen size={15} /> {text.user.writingMemory}
              </button>
              <button onClick={() => navigate('trash')}><Trash2 size={15} /> {text.user.trash}</button>
              <button onClick={signOut}><LogOut size={15} /> {text.common.signOut}</button>
            </div>
          )}
          <button className="sidebar-user-card" onClick={() => setUserMenuOpen((open) => !open)}>
            <Avatar user={user} size={38} />
            <span className="sidebar-user-details">
              <strong>{userEmail || 'local'}</strong>
              <span>{text.brand.name}</span>
            </span>
            <ChevronDown size={16} />
          </button>
        </div>
      </aside>

      <ColumnCollapseToggle
        side="left"
        columns={columns}
        setColumns={setColumns}
        collapsed={leftPaneCollapsed}
        onToggle={() => setLeftPaneCollapsed((collapsed) => !collapsed)}
      />

      <section className="paper-pane">
        <header className={`paper-compact-header ${pdfViewer ? 'pdf-mode' : ''}`}>
          {pdfViewer && (
            <button className="secondary-button pdf-back-button" onClick={closePaperPdf}>
              <ChevronLeft size={16} /> {text.workbench.closePdf}
            </button>
          )}
          <div className="paper-header-title">
            <h2>
              {pdfViewer?.title || activeLibrary?.name || text.workbench.catalogFallback}
            </h2>
            {!pdfViewer && (
              <p>{`${paperTotal} ${text.workbench.papersLoaded} · ${selectedCount} ${text.workbench.selected}`}</p>
            )}
          </div>
          {pdfViewer ? (
            <div className="pdf-header-actions">
              <button
                className={`secondary-button pdf-translate-toggle ${pdfTranslateEnabled ? 'active' : ''}`}
                title={pdfTranslateEnabled ? text.workbench.translateSelectionOn : text.workbench.translateSelection}
                onClick={() => {
                  setPdfTranslateEnabled((enabled) => !enabled);
                  clearPdfTranslationPopup();
                }}
              >
                <Languages size={16} /> {text.workbench.translateSelection}
              </button>
            </div>
          ) : (
            <div className="paper-header-actions">
              <button className="icon-button add-paper-button" title={text.workbench.addPapers} aria-label={text.workbench.addPapers} onClick={() => setAddPaperModalOpen(true)} disabled={!activeLibrary}>
                <Plus size={18} />
              </button>
            </div>
          )}
        </header>

        {filtersOpen && !pdfViewer && (
          <div className="modal-backdrop light" onClick={() => setFiltersOpen(false)}>
            <section className="filter-popover" onClick={(event) => event.stopPropagation()}>
              <header>
                <h2>{text.workbench.filters}</h2>
                <button className="icon-button" onClick={() => setFiltersOpen(false)}><X size={17} /></button>
              </header>
              <div className="excel-filter-bar">
          <label>
            <span className="label-with-help">{text.table.titleFilter}<KeywordHelp text={text} /></span>
            <input value={tableFilters.keyword} onChange={(e) => setTableFilters({ ...tableFilters, keyword: e.target.value })} />
          </label>
          <div className="field-block">
            <span>{text.modal.scope}</span>
            <ScopeTokenInput value={tableFilters} onChange={(scope) => setTableFilters((current) => ({ ...current, ...scope, page: 1 }))} text={text} />
          </div>
          <label>
            <span>{text.table.yearFrom}</span>
            <input value={tableFilters.year_from} onChange={(e) => setTableFilters({ ...tableFilters, year_from: e.target.value })} />
          </label>
          <label>
            <span>{text.table.yearTo}</span>
            <input value={tableFilters.year_to} onChange={(e) => setTableFilters({ ...tableFilters, year_to: e.target.value })} />
          </label>
          <label>
            <span>{text.table.folder}</span>
            <select value={tableFilters.folder} onChange={(e) => setTableFilters({ ...tableFilters, folder: e.target.value, page: 1 })}>
              <option value="">{text.table.rootFolder}</option>
              <option value="__all__">{text.table.allFolders}</option>
              {(activeLibrary?.filters_json?.folders || []).map((folder) => <option key={folder} value={folder}>{folder}</option>)}
            </select>
          </label>
          <button className="secondary-button" onClick={() => {
            const next = { ...tableFilters, page: 1 };
            setTableFilters(next);
            loadLibraryPapers(activeLibrary?.id, next);
            setFiltersOpen(false);
          }}>
            <SlidersHorizontal size={16} /> {text.workbench.filters}
          </button>
          <select
            className="folder-move-select"
            value=""
            disabled={!selectedCount}
            onChange={(e) => moveSelectedToFolder(e.target.value === '__root__' ? '' : e.target.value)}
            title={text.table.moveToFolder}
          >
            <option value="">{text.table.moveToFolder}</option>
            <option value="__root__" disabled={!tableFilters.folder}>{text.table.rootFolder}</option>
            {(activeLibrary?.filters_json?.folders || []).map((folder) => (
              <option key={folder} value={folder} disabled={folder === tableFilters.folder}>{folder}</option>
            ))}
          </select>
          <select
            className="folder-move-select"
            value=""
            disabled={!selectedCount}
            onChange={(e) => copySelectedToFolder(e.target.value === '__root__' ? '' : e.target.value)}
            title={text.table.copyToFolder}
          >
            <option value="">{text.table.copyToFolder}</option>
            <option value="__root__" disabled={!tableFilters.folder}>{text.table.rootFolder}</option>
            {(activeLibrary?.filters_json?.folders || []).map((folder) => (
              <option key={folder} value={folder} disabled={folder === tableFilters.folder}>{folder}</option>
            ))}
          </select>
          <button className="icon-button" title={text.workbench.clearFilters} aria-label={text.workbench.clearFilters} onClick={() => {
            const next = emptyTableFilters();
            setTableFilters(next);
            loadLibraryPapers(activeLibrary?.id, next);
            setFiltersOpen(false);
          }}>
            <X size={17} />
          </button>
              </div>
            </section>
          </div>
        )}

        {pdfViewer ? (
          <div
            ref={pdfViewerRef}
            className="pdf-viewer"
            onMouseDown={(event) => {
              if (!translationPopup) return;
              if (event.target.closest?.('.pdf-translation-popup')) return;
              clearPdfTranslationPopup();
            }}
          >
            <PdfJsViewer text={text} url={pdfViewer.url} title={pdfViewer.title} target={pdfViewer.target} />
            {translationPopup && (
              <PdfTranslationPopup
                text={text}
                popup={translationPopup}
              />
            )}
          </div>
        ) : (
          <>
            <div className="paper-table-wrap" ref={paperTableWrapRef} onScroll={handlePaperTableScroll}>
              <table className="paper-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={selectedAll}
                        aria-label={selectedAll ? text.table.clearSelection : text.table.selectAllLibrary}
                        title={selectedAll ? text.table.clearSelection : text.table.selectAllLibrary}
                        onChange={toggleSelectAllLibrary}
                      />
                    </th>
                    <th><SortButton label={text.table.paper} column="title" tableFilters={tableFilters} setTableFilters={setTableFilters} /></th>
                    <th><SortButton label={text.table.year} column="year" tableFilters={tableFilters} setTableFilters={setTableFilters} /></th>
                    <th><SortButton label={text.table.rank} column="rank" tableFilters={tableFilters} setTableFilters={setTableFilters} /></th>
                    <th><SortButton label={text.table.venue} column="venue" tableFilters={tableFilters} setTableFilters={setTableFilters} /></th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePapers.map((paper) => {
                    const paperUrl = paper.doi_url || paper.pub_url || paper.dblp_url || '';
                    const paperTitle = displayPaperTitle(paper);
                    const venue = displayVenue(paper);
                    const abstract = displayPaperAbstract(paper);
                    return (
                      <tr
                        key={paper.id}
                        data-paper-id={paper.id}
                        className={isPaperSelected(paper.id) ? 'selected' : ''}
                        onContextMenu={(event) => openContextMenu(event, 'paper', paper)}
                      >
                        <td>
                          <input
                            type="checkbox"
                            aria-label={paperTitle}
                            checked={isPaperSelected(paper.id)}
                            onChange={(e) => togglePaperSelection(paper.id, e.target.checked)}
                          />
                        </td>
                        <td className="title-cell">
                          <div className="title-line">
                            {paperUrl ? (
                              <a className="title-link" href={paperUrl} target="_blank" rel="noreferrer">{paperTitle}</a>
                            ) : (
                              <strong>{paperTitle}</strong>
                            )}
                            {paper.pdf_url && (
                              <button
                                className="pdf-pill"
                                onClick={() => openPaperPdf(paper, paperTitle)}
                                title={text.workbench.viewPdf}
                              >
                                <FileText size={13} /> {text.workbench.viewPdf}
                              </button>
                            )}
                            {paper.pdf_url && isUnmatchedUploadedPaper(paper) && (
                              <button
                                className="associate-pill"
                                onClick={() => setAssociatingPaper(paper)}
                                title={text.workbench.associatePaper}
                              >
                                <Search size={13} /> {text.table.associate}
                              </button>
                            )}
                            {!paper.pdf_url && (
                              <label className="pdf-add-pill" title={text.table.uploadPdf} aria-label={text.table.uploadPdf}>
                                <Plus size={13} />
                                <input
                                  type="file"
                                  accept="application/pdf"
                                  onChange={(event) => {
                                    uploadPdfForPaper(paper, event.target.files?.[0]);
                                    event.target.value = '';
                                  }}
                                />
                              </label>
                            )}
                          </div>
                          <span>{formatAuthors(paper.authors)}</span>
                          {abstract && (
                            <p className="paper-abstract" title={abstract}>
                              <strong>{text.table.abstract}</strong>
                              {abstract}
                            </p>
                          )}
                        </td>
                        <td>{paper.pub_year || '-'}</td>
                        <td><span className={`rank rank-${paper.rank || 'none'}`}>{paper.rank || '-'}</span></td>
                        <td><span className="venue-display" title={venue.title}>{venue.label}</span></td>
                        <td><button className="icon-button danger" title={text.table.remove} aria-label={text.table.remove} onClick={() => removePaper(paper)}><Trash2 size={17} /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!visiblePapers.length && (
                <div className="empty-state">
                  <Sparkles size={28} />
                  <p>{text.workbench.empty}</p>
                </div>
              )}
            </div>
            <PaginationBar
              text={text}
              tableFilters={tableFilters}
              total={paperTotal}
              onChange={(next) => setTableFilters(next)}
              onDownload={downloadLibraryPapers}
              selectedCount={selectedCount}
              citationStatus={citationExportStatus}
              onExport={exportSelectedCitations}
              onRetryCitations={retrySelectedCitations}
            />
          </>
        )}
        {notice && <div className="paper-toast">{notice}</div>}
      </section>

      <ColumnCollapseToggle
        side="right"
        columns={columns}
        setColumns={setColumns}
        collapsed={rightPaneCollapsed}
        onToggle={() => setRightPaneCollapsed((collapsed) => !collapsed)}
      />

      <AgentChat
        text={text}
        messages={messages}
        busy={chatBusy}
        selectedCount={selectedCount}
        skills={skills}
        activeSkillIds={enabledSkillIds}
        onInstallSkill={installSkill}
        onUninstallSkill={uninstallSkill}
        onToggleSkill={toggleSkill}
        onSend={sendChatMessage}
        onStop={stopChatGeneration}
        draft={draft}
        setDraft={setDraft}
        sessions={chatSessions}
        activeChatId={activeChat.id}
        libraries={orderedLibraries}
        activeLibrary={activeLibrary}
        collapsed={rightPaneCollapsed}
        onSelectChat={selectChat}
        onNewChat={startNewChat}
        editingMessageIndex={editingMessageIndex}
        editingMessageDraft={editingMessageDraft}
        setEditingMessageDraft={setEditingMessageDraft}
        onEditMessage={startEditMessage}
        onResendMessage={resendEditedMessage}
        onCancelEdit={() => {
          setEditingMessageIndex(null);
          setEditingMessageDraft('');
        }}
        onDeleteMessage={deleteMessage}
        onDeleteChat={deleteChat}
        onExecuteAction={executeAgentAction}
        onOpenNotes={() => activeLibrary && openLibraryFiles(activeLibrary)}
        onOpenPaperRef={(paperRef) => {
          if (paperRef?.pdf_url) {
            const snapshot = snapshotPaperViewState();
            pdfReturnListStateRef.current = snapshot;
            if (snapshot) writeStoredPaperViewState(snapshot.libraryId, snapshot);
            setPdfViewer({ url: paperRef.pdf_url, title: paperRef.title, paperId: paperRef.paper_id });
          }
        }}
        onOpenCitationReference={openCitationReference}
        papers={libraryPapers}
        paperContextActive={Boolean(pdfViewer)}
        noteOpen={fileWorkbenchOpen}
        writingWizard={writingWizard}
        onUpdateWritingWizard={updateWritingWizard}
        onNextWritingWizardStep={nextWritingWizardStep}
        onPreviousWritingWizardStep={previousWritingWizardStep}
        onCancelWritingWizard={() => setWritingWizard(null)}
        onUploadWizardPdf={updateWizardPdf}
        noteLibrary={activeLibrary}
        noteFiles={libraryFiles}
        activeFile={activeFile}
        activeFileDraft={activeFileDraft}
        activeFileDirty={activeFileDirty}
        selectedFileFolderId={selectedFileFolderId}
        expandedFileFolders={expandedFileFolders}
        setExpandedFileFolders={setExpandedFileFolders}
        fileSidebarMode={fileSidebarMode}
        setFileSidebarMode={setFileSidebarMode}
        fileSidebarCollapsed={fileSidebarCollapsed}
        setFileSidebarCollapsed={setFileSidebarCollapsed}
        fileSourceMode={fileSourceMode}
        setFileSourceMode={setFileSourceMode}
        fileEditorRef={fileEditorRef}
        renamingFileId={renamingFileId}
        renamingFileName={renamingFileName}
        setRenamingFileName={setRenamingFileName}
        onOpenFile={openLibraryFile}
        onSelectFileFolder={(file) => {
          setSelectedFileFolderId(file?.id || null);
          if (file?.id) setExpandedFileFolders((items) => new Set([...items, file.id]));
        }}
        onFileContextMenu={(event, file) => {
          event.preventDefault();
          event.stopPropagation();
          setFileContextMenu({ type: file.type === 'folder' ? 'folder' : 'file', target: file, x: event.clientX, y: event.clientY });
        }}
        onBlankFileContextMenu={(event) => {
          event.preventDefault();
          setFileContextMenu({ type: 'blank', x: event.clientX, y: event.clientY, parentId: selectedFileFolderId });
        }}
        onStartRenameFile={startRenamingFile}
        onCommitRenameFile={renameLibraryFile}
        onCreateMarkdownFile={() => createMarkdownFile(selectedFileFolderId)}
        onExportCurrentFileFolder={exportCurrentFileFolder}
        onCloseNotes={closeFileWorkbench}
        onSaveActiveFile={saveActiveFile}
        onInsertMarkdownTemplate={insertMarkdownTemplate}
        onChangeActiveFileDraft={setActiveFileDraft}
        onRequestMarkdownCompletion={requestMarkdownInlineCompletion}
        aiFileEditing={aiFileEditing}
        editorLanguage={locale === 'zh' ? 'zh_CN' : 'en_US'}
      />

      {libraryModalOpen && (
        <LibraryModal
          text={text}
          locale={locale}
          llmSettings={llmSettings}
          filters={filters}
          library={editingLibrary}
          busy={busy}
          onCreate={editingLibrary ? updateLibrary : createLibrary}
          onSync={editingLibrary ? syncLibrary : null}
          onCancel={() => {
            setLibraryModalOpen(false);
            setEditingLibrary(null);
          }}
        />
      )}
      {sharingLibrary && (
        <ShareLibraryModal
          text={text}
          library={sharingLibrary}
          busy={busy}
          onSave={(sharedWith) => updateLibrarySharing(sharingLibrary, sharedWith)}
          onCancel={() => setSharingLibrary(null)}
        />
      )}
      {addPaperModalOpen && activeLibrary && (
        <AddPaperModal
          text={text}
          busy={busy}
          activeLibrary={activeLibrary}
          onCancel={() => setAddPaperModalOpen(false)}
          onAddPapers={searchAndAddPapers}
          onUploadPdfs={uploadPdfsToActiveLibrary}
        />
      )}
      {associatingPaper && activeLibrary && (
        <AssociatePaperModal
          text={text}
          busy={busy}
          paper={associatingPaper}
          onCancel={() => setAssociatingPaper(null)}
          onAssociate={(targetPaperId) => associatePaperToDblp(associatingPaper, targetPaperId)}
        />
      )}
      {detailPaper && (
        <PaperDetailsModal
          text={text}
          paper={detailPaper}
          busy={busy}
          onSaveDetails={savePaperDetails}
          onUploadPdf={(file) => uploadPdfForPaper(detailPaper, file)}
          onUnlinkPdf={unlinkPaperPdf}
          onClose={() => {
            setDetailPaper(null);
          }}
        />
      )}
      {renamingPaper && (
        <RenamePaperModal
          text={text}
          busy={busy}
          paper={renamingPaper}
          title={renamingPaperTitle}
          setTitle={setRenamingPaperTitle}
          onCancel={() => {
            setRenamingPaper(null);
            setRenamingPaperTitle('');
          }}
          onSave={renameUploadedPaper}
        />
      )}
      {pendingPdfUpload && (
        <PdfMismatchModal
          text={text}
          busy={busy}
          check={pendingPdfUpload.check}
          onCancel={() => setPendingPdfUpload(null)}
          onConfirm={() => storePdfForPaper(pendingPdfUpload.paper, pendingPdfUpload.file)}
        />
      )}
      {libraryCreateStatus === 'running' && !libraryCreateBackgrounded && !pdfTask && (
        <LibraryCreateProgress
          text={text}
          onBackground={() => {
            setLibraryCreateBackgrounded(true);
            showNotice(text.workbench.backgroundNotice);
          }}
        />
      )}
      {pdfTask && ['running', 'queued'].includes(pdfTask.status) && !pdfTaskBackgrounded && (
        <LibraryCreateProgress
          text={text}
          task={pdfTask}
          onBackground={() => {
            setPdfTaskBackgrounded(true);
            showNotice(text.workbench.backgroundNotice);
          }}
        />
      )}
      {memoryModalOpen && (
        <WritingMemoryModal
          text={text}
          draft={writingPreferenceDraft}
          setDraft={setWritingPreferenceDraft}
          onSave={saveWritingPreference}
          onClose={() => setMemoryModalOpen(false)}
        />
      )}
      {modelModalOpen && (
        <ModelSelectionModal
          text={text}
          settings={llmSettings}
          models={availableModels}
          loading={modelListLoading}
          error={modelListError}
          onSave={saveModelSettings}
          onClose={() => setModelModalOpen(false)}
        />
      )}
      {tagModalOpen && (
        <TagModal
          text={text}
          tag={editingTag}
          onCreate={saveTagDefinition}
          onCancel={() => {
            setTagModalOpen(false);
            setEditingTag(null);
          }}
        />
      )}
      {contextMenu && (
        <ContextMenu
          text={text}
          menu={contextMenu}
          folders={activeLibrary?.filters_json?.folders || []}
          currentFolder={tableFilters.folder}
          onClose={closeContextMenu}
          onEditLibrary={(library) => {
            closeContextMenu();
            openEditLibrary(library);
          }}
          onNewFolder={(library) => {
            closeContextMenu();
            openFolderModal(library);
          }}
          onNewChildFolder={(library, parentFolder) => {
            closeContextMenu();
            openFolderModal(library, parentFolder);
          }}
          onDeleteFolder={(library, folder) => {
            closeContextMenu();
            deleteFolder(library, folder);
          }}
              onDeleteLibrary={(library) => {
                closeContextMenu();
                deleteLibrary(library);
              }}
              onPinLibrary={(library) => {
                closeContextMenu();
                pinLibraryToTop(library.id);
              }}
          onMovePaper={(paper, folder) => {
            closeContextMenu();
            movePaperToFolder(paper, folder);
          }}
          onCopyPaper={(paper, folder) => {
            closeContextMenu();
            copyPaperToFolder(paper, folder);
          }}
          onRelinkPaper={(paper) => {
            closeContextMenu();
            setAssociatingPaper(paper);
          }}
          onOpenDetails={(paper) => {
            closeContextMenu();
            openPaperDetails(paper);
          }}
          onRenamePaper={(paper) => {
            closeContextMenu();
            openRenamePaperModal(paper);
          }}
          onDeletePaper={(paper) => {
            closeContextMenu();
            removePaper(paper);
          }}
        />
      )}
      {fileContextMenu && (
        <FileContextMenu
          text={text}
          menu={fileContextMenu}
          onClose={() => setFileContextMenu(null)}
          onNewFile={(parentId) => {
            setFileContextMenu(null);
            createMarkdownFile(parentId);
          }}
          onNewFolder={(parentId) => {
            setFileContextMenu(null);
            createLibraryFolder(parentId);
          }}
          onRename={(file) => {
            setFileContextMenu(null);
            startRenamingFile(file);
          }}
          onExport={(file, format) => {
            setFileContextMenu(null);
            if (file.type === 'folder') {
              const params = new URLSearchParams({ folder_id: file.id });
              const citationFormat = normalizedCitationExportFormat(format);
              if (citationFormat) params.set('citation_format', citationFormat);
              window.open(`${API}/libraries/${activeLibrary.id}/files/export?${params.toString()}`, '_blank', 'noopener,noreferrer');
            } else {
              exportLibraryFile(file, format);
            }
          }}
          onDelete={(file) => {
            setFileContextMenu(null);
            deleteLibraryFile(file);
          }}
        />
      )}
      {folderModalLibrary && (
        <FolderModal
          text={text}
          library={folderModalLibrary.library}
          parentFolder={folderModalLibrary.parentFolder}
          onCreate={(folderName) => addFolder(folderModalLibrary.library, folderName, folderModalLibrary.parentFolder)}
          onCancel={() => setFolderModalLibrary(null)}
        />
      )}
    </main>
  );
}

function ColumnCollapseToggle({ side, columns, setColumns, collapsed, onToggle }) {
  const draggedRef = useRef(false);

  function startDrag(event) {
    if (collapsed) return;
    event.preventDefault();
    const startX = event.clientX;
    const startColumns = { ...columns };
    draggedRef.current = false;
    function onMove(moveEvent) {
      const deltaPx = moveEvent.clientX - startX;
      if (Math.abs(deltaPx) > 3) draggedRef.current = true;
      const delta = deltaPx / 260;
      if (side === 'left') {
        setColumns({
          ...startColumns,
          left: Math.max(0.7, startColumns.left + delta),
          middle: Math.max(1.1, startColumns.middle - delta),
        });
      } else {
        setColumns({
          ...startColumns,
          middle: Math.max(1.1, startColumns.middle + delta),
          right: Math.max(0.9, startColumns.right - delta),
        });
      }
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function handleClick(event) {
    if (draggedRef.current) {
      event.preventDefault();
      draggedRef.current = false;
      return;
    }
    onToggle();
  }

  return (
    <button
      type="button"
      className={`column-collapse-toggle ${side}`}
      onMouseDown={startDrag}
      onClick={handleClick}
      aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
    />
  );
}

createRoot(document.getElementById('root')).render(import.meta.env.VITE_EASYREF_LEGACY === 'true' ? <App /> : <ResearchErrorBoundary><ResearchWorkbench /></ResearchErrorBoundary>);

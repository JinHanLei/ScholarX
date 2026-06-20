import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import * as pdfjsLib from 'pdfjs-dist/build/pdf';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import VditorMarkdownEditor from './VditorMarkdownEditor';
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
  Pencil,
  Plus,
  Puzzle,
  RotateCcw,
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

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js?v=pdfjs-3.11.174';

const API = import.meta.env.VITE_API_URL || '/api';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'http://localhost:8000';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  })
  : null;

function pdfFetchUrl(url) {
  if (!url) return '';
  if (url.startsWith('/')) return url;
  return `${API}/pdf/proxy?url=${encodeURIComponent(url)}`;
}

const COPY = {
  zh: {
    common: {
      language: '中文',
      switchLanguage: 'EN',
      home: '首页',
      demo: '查看 Demo',
      cancel: '取消',
      allRanks: '全部等级',
      dynamic: '动态',
      static: '静态',
      save: '保存',
      add: '添加',
      search: '搜索',
      signIn: '登录',
      signUp: '注册',
      signOut: '退出',
      resetLayout: '恢复默认布局',
      background: '后台处理',
      confirmDelete: '确认删除',
      backToWorkbench: '返回工作台',
    },
    brand: {
      name: 'ScholarX Academy',
      indexed: '篇论文已索引',
      fallback: '研究学习工作室',
    },
    home: {
      eyebrow: '一站式论文管理平台',
      title: '一键生成文献综述',
      subtitle:
        '创建论文库、跟踪阅读进度、用 Tag 搭建专题模块，再让 Agent 帮你完成综述、PDF 问答和 LaTeX 草稿。',
      primary: '进入 ScholarX',
      secondary: '了解流程',
      navFeatures: '功能',
      navStories: '反馈',
      catalogTitle: '课程目录预览',
      catalogMeta: '动态论文库',
      catalogDesc: '从关键词生成研究轨道，数据库更新后自动补充新论文。',
      progressTitle: '进度追踪演示',
      progressMeta: '论文、PDF、Tag 同步推进',
      progressDesc: '像整理课程作业一样整理阅读状态和分类线索。',
      courseA: '股票预测专题',
      courseB: '多模态检索专题',
      courseC: '大模型 Agent 专题',
      progressDone: '已归类',
      progressPdf: 'PDF 已解析',
      progressDraft: '综述草稿',
      testimonialTitle: '学生反馈',
      testimonialOne: '“一下午就把综述结构搭出来了。”',
      testimonialTwo: '“Tag 列比普通收藏夹更像真正的研究管理。”',
      ctaTitle: '准备开始第一节研究课了吗？',
      ctaDesc: '进入 Demo 后点击左侧添加库，用关键词创建你的第一条论文轨道。',
      ctaButton: '进入 ScholarX',
    },
    workbench: {
      eyebrow: '研究课程工作台',
      title: '把论文库当作课程轨道来推进',
      subtitle:
        '每次搜索都会创建一个论文库。你可以同步动态库、上传 PDF、给论文打 Tag，并让 Agent 生成综述与 LaTeX 草稿。',
      addLibrary: '添加库',
      browseCatalog: '浏览目录',
      catalogTitle: '课程目录',
      startKeyword: '从关键词开始',
      dynamicTrack: 'DBLP 更新后自动刷新',
      staticTrack: '保持一次搜索的快照',
      progressDemo: '进度演示',
      papersLoaded: '篇论文已载入',
      testimonialA: '“午饭前就整理出综述提纲。”',
      testimonialB: '“Tag 让文献分类终于清爽了。”',
      catalogFallback: '论文目录',
      selected: '已选',
      tableSearch: '筛选标题 / venue',
      applyTableFilter: '应用表格筛选',
      sync: '同步',
      empty: '点击左侧添加库，创建你的第一条研究课程。',
      creatingTitle: '正在检索论文',
      creatingDesc: 'ScholarX 正在创建论文库并匹配 DBLP 与 CCF 数据，你可以先退到后台继续浏览。',
      backgroundNotice: '论文库正在后台创建，完成后会自动刷新列表。',
      backHome: '返回首页',
      pageSize: '每页',
      page: '第',
      total: '共',
      previous: '上一页',
      next: '下一页',
      filters: '筛选',
      clearFilters: '清除',
      download: '下载',
      downloadCsv: 'CSV',
      downloadExcel: 'Excel',
      exportCitations: '导出',
      exportBib: 'BibTeX (.bib)',
      exportApa: 'APA (.txt)',
      exportMla: 'MLA (.txt)',
      exportGbt: 'GB/T 7714 (.txt)',
      citationFetching: '正在抓取参考文献',
      citationReady: '参考文献已就绪',
      citationRetry: '重试失败引用',
      addPapers: '添加论文',
      papersMode: '论文库',
      filesMode: '文件库',
      fileLibrary: '文件库',
      newMarkdown: '新建 Markdown',
      newFile: '新建文件',
      newFolder: '新建文件夹',
      rename: '重命名',
      filesTab: '文件',
      outlineTab: '大纲',
      sourceMode: '源代码',
      unsavedExit: '当前文件有未保存内容，确定要离开吗？',
      exportAll: '导出',
      saveFile: '保存文件',
      exportFile: '导出文件',
      fileSaved: '文件已保存',
      fileEmpty: '还没有文件。让 Agent 写一篇综述，或新建 Markdown。',
      viewPdf: '查看 PDF',
      closePdf: '返回',
      translateSelection: '划词翻译',
      translateSelectionOn: '划词翻译已开启',
      translating: '翻译中...',
      translation: '翻译',
      pdfLoading: '正在加载 PDF...',
      pdfLoadError: 'PDF 加载失败',
      associatePaper: '关联论文',
      indexedPrefix: '共收录',
      indexedSuffix: '篇论文',
      updatedAt: '更新于',
    },
    library: {
      add: '添加库',
      empty: '还没有论文库，点击上方按钮开始。',
      dynamic: '动态更新',
      static: '静态快照',
      delete: '删除论文库',
      deleteConfirm: '确定删除这个论文库吗？库内关联会被删除，但全局论文数据不会删除。',
    },
    table: {
      paper: '论文',
      abstract: '摘要',
      authors: '作者',
      details: '详细信息',
      detailsReadonly: '标题、作者、年份和 venue 来自论文索引，只能编辑摘要和 PDF。',
      abstractPlaceholder: '手动添加或修正 abstract',
      abstractSaved: '摘要已保存',
      year: '年份',
      rank: '等级',
      venue: 'Venue',
      tagColumn: 'Tag 列',
      pdf: 'PDF',
      noPdf: '还没有 PDF',
      folder: '子目录',
      allFolders: '全部论文',
      rootFolder: '主目录',
      noFolder: '未分类',
      moveToFolder: '移动',
      moveToRoot: '移出子目录',
      moveSuccess: '移动成功',
      copyToFolder: '复制',
      copySuccess: '复制成功',
      selectAllLibrary: '全选当前筛选结果',
      clearSelection: '取消全选',
      chooseTag: '选择 Tag',
      allTags: '全部 Tag',
      noTags: '还没有 Tag',
      noTagDefinitions: '请先在表头添加 Tag',
      addTag: '添加 Tag',
      editTag: '编辑 Tag',
      enrich: '联网补全详情',
      uploadPdf: '上传 PDF',
      confirmPdfUpload: '确认 PDF 上传',
      confirmPdfUploadDesc: '请核对当前论文与上传 PDF 的信息后确认绑定。',
      currentPaper: '当前论文',
      uploadedPdf: '上传的 PDF',
      similarity: '相似度',
      storeAnyway: '确认上传',
      uploadPdfZip: '上传 PDF / ZIP',
      associate: '关联',
      relink: '重新链接',
      renamePaper: '重命名论文',
      renamePaperDesc: '仅修改这条未匹配上传论文在当前库中的显示标题。',
      renameSuccess: '论文标题已更新',
      remove: '从库中删除',
      restore: '恢复',
      deleteFolder: '删除目录',
      deleteFolderConfirm: '确定删除这个目录及其下级目录吗？其中的论文会移动到上级目录。',
      sortAsc: '升序',
      sortDesc: '降序',
      titleFilter: '标题包含',
      venueFilter: 'Venue 包含',
      yearFrom: '起始年',
      yearTo: '结束年',
    },
    agent: {
      title: 'Agent',
      newChat: '新对话',
      history: '历史',
      deleteChat: '删除对话',
      settings: '模型设置',
      baseUrl: '接口地址',
      apiKey: 'API Key',
      model: '模型',
      saveSettings: '保存设置',
      settingsSaved: '设置已保存在本地浏览器。',
      skills: 'Skills',
      install: '安装',
      uninstall: '卸载',
      installed: '已安装',
      enable: '启用',
      skillEmpty: '还没有可用 Skill。',
      skillActivePrefix: '已启用 ',
      skillActiveSuffix: ' 个 Skill',
      selectedPrefix: '参考 ',
      selectedSuffix: ' 篇论文',
      context: '使用当前论文库上下文',
      placeholder: '询问综述、分类、PDF 内容或 LaTeX 输出',
      send: '发送',
      resend: '重新发送',
      thinking: '思考中',
      thinkingDone: '已思考完毕',
      stop: '停止',
      stopped: '已停止生成。',
      requestFailed: '模型请求失败：',
      references: '本轮参考论文',
      evidence: '证据片段',
      process: '执行过程',
      emptyLibraryHistory: '暂无对话',
      unassignedHistory: '未归属',
      greeting: '选择论文后，我可以基于当前论文库和 PDF 内容协助整理综述、提炼方法与生成 LaTeX 草稿。',
      pdfParsed: '已解析 PDF：',
      pdfEmpty: '没有提取到文本。',
    },
    user: {
      profile: '个人中心',
      trash: '回收站',
      modelSelect: '选择模型',
      modelTitle: '选择模型',
      modelDesc: '从当前接口地址拉取可用模型；智能模式后续会支持按任务分配不同模型。',
      modelList: '模型',
      modelSearch: '搜索模型',
      modelSmart: '智能',
      modelSmartTitle: '智能模型编排',
      modelSmartDesc: '后续可配置规划、检索、总结等不同阶段使用不同模型。当前先按所选模型执行。',
      modelLoading: '正在拉取模型...',
      modelLoadFailed: '模型列表拉取失败，已使用默认模型。',
      modelSaved: '模型设置已保存。',
      trashTitle: '论文回收站',
      trashDesc: '误删除的论文可以恢复到原论文库。',
      trashEmpty: '回收站为空。',
      profileTitle: '个人中心',
      profileDesc: '管理头像和账号安全设置。',
      avatar: '头像',
      uploadAvatar: '上传头像',
      password: '新密码',
      passwordHint: '至少 6 位',
      updatePassword: '修改密码',
      writingMemory: '写作记忆',
      writingMemoryDesc: '记录 Agent 写作时应该遵守的学术偏好。',
      memoryOpen: '管理记忆',
      memoryTitle: '学术写作偏好',
      memoryPlaceholder: '写下模型需要长期记住的写作偏好。你可以直接修改模型记录过的内容。',
      memoryAdd: '保存记忆',
      memoryEmpty: '还没有保存写作偏好。',
      memorySaved: '写作记忆已保存。',
      avatarSaved: '头像已更新。',
      passwordSaved: '密码已更新。',
      localOnly: '当前为本地登录模式，账号设置需要配置 Supabase。',
    },
    auth: {
      title: '登录 ScholarX',
      subtitle: '登录后可以进入 /scholarx，查看和管理你的论文库。',
      email: '邮箱',
      password: '密码',
      passwordHint: '至少 6 位',
      signIn: '登录',
      signUp: '创建账号',
      verifyTitle: '输入邮箱验证码',
      verifyDesc: '我们已向你的邮箱发送验证码，请输入邮件里的 6 位数字。',
      code: '验证码',
      verify: '验证并进入',
      resendCode: '重新发送验证码',
      codeResent: '验证码已重新发送，请查看邮箱。',
      authServiceBusy: '认证服务刚才无法连接数据库，请稍后重试或重新发送验证码。',
      pleaseRegister: '该邮箱尚未注册，请先注册。',
      pleaseFinishRegister: '该邮箱尚未完成注册，请先在注册页完成邮箱验证。',
      noSupabase: '未配置 Supabase 前端密钥，暂时无法登录。',
    },
    modal: {
      libraryTitle: '创建论文库',
      libraryDesc: '本次搜索会保存为一个新的论文库。',
      libraryName: '库名',
      keyword: '关键词',
      keywordHint: '例如 stock forecasting',
      keywordHelp: '关键词规则',
      keywordHelpItems: [
        '普通输入：stock forecasting，按词匹配标题。',
        '短语：\"stock forecasting\"，匹配连续短语。',
        '并列：stock OR finance，匹配任一词。',
        '组合：agent AND (stock OR portfolio OR finance)，必须包含 agent，且包含括号内任一词。',
        '排除：stock -survey，包含 stock 且排除 survey。',
        '同时包含：stock & prediction，Postgres 原生写法。',
        '前缀：stock:*，匹配 stock / stocks / stocking 等词干或前缀。',
      ],
      venue: '期刊 / 会议',
      venueHint: '例如 SIGIR、KDD、WWW、Nature',
      scope: 'CCF / 期刊会议',
      scopeHint: '输入 CCF A/B/C、ICLR、KDD、Nature',
      scopeRankHint: '按 CCF 等级加入检索',
      sourceKeyword: '关键词检索',
      sourcePdf: 'PDF 上传',
      sourceNatural: '你说我找',
      sourceManual: '手动填写',
      naturalPrompt: '描述你的研究需求',
      naturalHint: '例如：我想找多模态检索方向近几年 CCF 论文',
      naturalStart: '开始解析',
      naturalScopeQuestion: 'CCF A/B/C 的范围可以吗？也可以继续加会议或删掉等级。',
      naturalYearQuestion: '近三年的范围可以吗？',
      naturalReady: '参数已确认，请确认生成的库名。',
      naturalParsing: '正在解析需求...',
      parsedKeyword: '解析关键词',
      pdfFiles: 'PDF 文件',
      pdfHint: '支持单个 PDF、多个 PDF 或 ZIP 压缩包',
      yearFrom: '起始年',
      yearTo: '结束年',
      share: '共享给用户名或邮箱，多个用逗号分隔',
      shareTitle: '共享论文库',
      shareDesc: '输入用户邮箱，可自动补全；删除气泡即可取消共享。',
      sharePlaceholder: '输入邮箱',
      shareEmpty: '暂未共享给任何人',
      continue: '下一步',
      createSearch: '搜索并创建',
      createFromPdf: '创建并上传',
      addToLibrary: '添加到当前库',
      searchToAdd: '搜索论文加入',
      uploadToAdd: '上传 PDF 加入',
      searchResults: '搜索结果',
      selectedPapers: '已选择论文',
      addSelected: '加入所选论文',
      associateTitle: '手动关联 PDF',
      associateDesc: '搜索 DBLP 库中的论文，把当前 PDF 绑定到正确条目。',
      associateToPaper: '关联到这篇',
      tagTitleAdd: '添加 Tag',
      tagTitleEdit: '编辑 Tag',
      tagDesc: 'description 会作为分类提示词保存。',
      tagName: 'Tag 名，例如 stock',
      tagPrompt: 'description，例如：和股票预测相关',
      autoFolder: '自动移入同名子目录',
      autoFolderHint: '勾选后，归入此 Tag 的论文会自动移动到同名子目录。',
      folders: '子目录',
      folderName: '子目录名，例如 llm+stock',
      addFolder: '添加子目录',
      addChildFolder: '添加下级目录',
      updateLibrary: '保存论文库',
      updateMetadata: '保存信息',
      updateSearch: '更新检索',
      createdAt: '创建于',
      fileCount: '个文件',
    },
  },
  en: {
    common: {
      language: 'English',
      switchLanguage: '中',
      home: 'Home',
      demo: 'View Demo',
      cancel: 'Cancel',
      allRanks: 'All ranks',
      dynamic: 'Dynamic',
      static: 'Static',
      save: 'Save',
      add: 'Add',
      search: 'Search',
      signIn: 'Sign in',
      signUp: 'Sign up',
      signOut: 'Sign out',
      resetLayout: 'Reset layout',
      background: 'Run in background',
      confirmDelete: 'Confirm delete',
      backToWorkbench: 'Back to workbench',
    },
    brand: {
      name: 'ScholarX Academy',
      indexed: 'papers indexed',
      fallback: 'research learning studio',
    },
    home: {
      eyebrow: 'A research platform that keeps moving',
      title: 'Turn DBLP search into a guided research course',
      subtitle:
        'Create paper libraries, track reading progress, organize topics with tags, and ask the agent for surveys, PDF Q&A, and LaTeX drafts.',
      primary: 'Open ScholarX',
      secondary: 'See flow',
      navFeatures: 'Features',
      navStories: 'Stories',
      catalogTitle: 'Course catalog preview',
      catalogMeta: 'Dynamic paper library',
      catalogDesc: 'Generate a research track from keywords and refresh it after database updates.',
      progressTitle: 'Progress tracking demo',
      progressMeta: 'Papers, PDFs, and tags move together',
      progressDesc: 'Organize reading status and topic clues like a focused course.',
      courseA: 'Stock forecasting',
      courseB: 'Multimodal retrieval',
      courseC: 'LLM agents',
      progressDone: 'Classified',
      progressPdf: 'PDF parsed',
      progressDraft: 'Survey draft',
      testimonialTitle: 'Student testimonials',
      testimonialOne: '"I shaped a survey outline in one afternoon."',
      testimonialTwo: '"The tag column feels more useful than a bookmark folder."',
      ctaTitle: 'Ready for your first research course?',
      ctaDesc: 'Enter the demo, click Add Library, and create your first paper track from keywords.',
      ctaButton: 'Open ScholarX',
    },
    workbench: {
      eyebrow: 'Research course workspace',
      title: 'Move through paper libraries like guided course tracks',
      subtitle:
        'Every search creates a library. Sync dynamic libraries, upload PDFs, tag papers, and ask the agent for surveys or LaTeX drafts.',
      addLibrary: 'Add Library',
      browseCatalog: 'Browse Catalog',
      catalogTitle: 'Course Catalog',
      startKeyword: 'Start with a keyword',
      dynamicTrack: 'Refreshes after DBLP updates',
      staticTrack: 'Keeps a one-time search snapshot',
      progressDemo: 'Progress demo',
      papersLoaded: 'papers loaded',
      testimonialA: '"I mapped a survey outline before lunch."',
      testimonialB: '"Tags finally made my literature review organized."',
      catalogFallback: 'Paper catalog',
      selected: 'selected',
      tableSearch: 'Filter title / venue',
      applyTableFilter: 'Apply table filter',
      sync: 'Sync',
      empty: 'Click Add Library on the left to create your first research course.',
      creatingTitle: 'Searching papers',
      creatingDesc: 'ScholarX is creating the library and matching DBLP plus CCF data. You can send it to the background.',
      backgroundNotice: 'Library creation is running in the background. The list will refresh when it finishes.',
      backHome: 'Back Home',
      pageSize: 'Per page',
      page: 'Page',
      total: 'Total',
      previous: 'Previous',
      next: 'Next',
      filters: 'Filters',
      clearFilters: 'Clear',
      download: 'Download',
      downloadCsv: 'CSV',
      downloadExcel: 'Excel',
      exportCitations: 'Export',
      exportBib: 'BibTeX (.bib)',
      exportApa: 'APA (.txt)',
      exportMla: 'MLA (.txt)',
      exportGbt: 'GB/T 7714 (.txt)',
      citationFetching: 'Fetching references',
      citationReady: 'References ready',
      citationRetry: 'Retry failed refs',
      addPapers: 'Add papers',
      papersMode: 'Papers',
      filesMode: 'Files',
      fileLibrary: 'File Library',
      newMarkdown: 'New Markdown',
      newFile: 'New file',
      newFolder: 'New folder',
      rename: 'Rename',
      filesTab: 'Files',
      outlineTab: 'Outline',
      sourceMode: 'Source',
      unsavedExit: 'This file has unsaved changes. Leave anyway?',
      exportAll: 'Export',
      saveFile: 'Save file',
      exportFile: 'Export file',
      fileSaved: 'File saved',
      fileEmpty: 'No files yet. Ask the Agent to draft a review, or create a Markdown file.',
      viewPdf: 'View PDF',
      closePdf: 'Back',
      translateSelection: 'Selection Translate',
      translateSelectionOn: 'Selection Translate On',
      translating: 'Translating...',
      translation: 'Translation',
      pdfLoading: 'Loading PDF...',
      pdfLoadError: 'Failed to load PDF',
      associatePaper: 'Associate paper',
      indexedPrefix: 'Indexed ',
      indexedSuffix: ' papers',
      updatedAt: 'Updated',
    },
    library: {
      add: 'Add Library',
      empty: 'No libraries yet. Click the button above to begin.',
      dynamic: 'Dynamic update',
      static: 'Static snapshot',
      delete: 'Delete library',
      deleteConfirm: 'Delete this library? Library-paper links will be removed, but global paper data remains.',
    },
    table: {
      paper: 'Paper',
      abstract: 'Abstract',
      authors: 'Authors',
      details: 'Details',
      detailsReadonly: 'Title, authors, year, and venue come from the paper index. Only abstract and PDF are editable.',
      abstractPlaceholder: 'Add or correct the abstract manually',
      abstractSaved: 'Abstract saved',
      year: 'Year',
      rank: 'Rank',
      venue: 'Venue',
      tagColumn: 'Tag column',
      pdf: 'PDF',
      noPdf: 'No PDF yet',
      folder: 'Folder',
      allFolders: 'All papers',
      rootFolder: 'Root',
      noFolder: 'Unfiled',
      moveToFolder: 'Move',
      moveToRoot: 'Move out of folder',
      moveSuccess: 'Moved successfully',
      copyToFolder: 'Copy',
      copySuccess: 'Copied successfully',
      selectAllLibrary: 'Select all filtered papers',
      clearSelection: 'Clear selection',
      chooseTag: 'Choose tag',
      allTags: 'All tags',
      noTags: 'No tags yet',
      noTagDefinitions: 'Add tags from the column header first',
      addTag: 'Add tag',
      editTag: 'Edit tag',
      enrich: 'Enrich details online',
      uploadPdf: 'Upload PDF',
      confirmPdfUpload: 'Confirm PDF upload',
      confirmPdfUploadDesc: 'Review the paper and uploaded PDF details before confirming the attachment.',
      currentPaper: 'Current paper',
      uploadedPdf: 'Uploaded PDF',
      similarity: 'Similarity',
      storeAnyway: 'Confirm upload',
      uploadPdfZip: 'Upload PDF / ZIP',
      associate: 'Associate',
      relink: 'Relink',
      renamePaper: 'Rename paper',
      renamePaperDesc: 'Only changes the display title of this unmatched uploaded paper.',
      renameSuccess: 'Paper title updated',
      remove: 'Remove from library',
      restore: 'Restore',
      deleteFolder: 'Delete folder',
      deleteFolderConfirm: 'Delete this folder and its child folders? Papers inside will move to the parent folder.',
      sortAsc: 'Asc',
      sortDesc: 'Desc',
      titleFilter: 'Title contains',
      venueFilter: 'Venue contains',
      yearFrom: 'Year from',
      yearTo: 'Year to',
    },
    agent: {
      title: 'Agent',
      newChat: 'New Chat',
      history: 'History',
      deleteChat: 'Delete chat',
      settings: 'Model Settings',
      baseUrl: 'Base URL',
      apiKey: 'API Key',
      model: 'Model',
      saveSettings: 'Save Settings',
      settingsSaved: 'Settings are saved locally in this browser.',
      skills: 'Skills',
      install: 'Install',
      uninstall: 'Uninstall',
      installed: 'Installed',
      enable: 'Enable',
      skillEmpty: 'No skills available yet.',
      skillActivePrefix: '',
      skillActiveSuffix: ' skills active',
      selectedPrefix: 'Using ',
      selectedSuffix: ' selected papers',
      context: 'Using current library context',
      placeholder: 'Ask for surveys, classification, PDF answers, or LaTeX output',
      send: 'Send',
      resend: 'Resend',
      thinking: 'Thinking',
      thinkingDone: 'Thought complete',
      stop: 'Stop',
      stopped: 'Generation stopped.',
      requestFailed: 'Model request failed: ',
      references: 'Referenced papers',
      evidence: 'Evidence',
      process: 'Process',
      emptyLibraryHistory: 'No chats yet',
      unassignedHistory: 'Unassigned',
      greeting: 'Select papers and I can help summarize methods, read PDF content, and draft LaTeX from the current library.',
      pdfParsed: 'Parsed PDF: ',
      pdfEmpty: 'No text was extracted.',
    },
    user: {
      profile: 'Profile',
      trash: 'Recycle bin',
      modelSelect: 'Select model',
      modelTitle: 'Select model',
      modelDesc: 'Fetch available models from the current endpoint. Smart mode will route tasks to different models later.',
      modelList: 'Models',
      modelSearch: 'Search models',
      modelSmart: 'Smart',
      modelSmartTitle: 'Smart model routing',
      modelSmartDesc: 'Planning, retrieval, and summarization can use different models later. For now, ScholarX uses the selected model.',
      modelLoading: 'Loading models...',
      modelLoadFailed: 'Failed to load models. The default model is used.',
      modelSaved: 'Model settings saved.',
      trashTitle: 'Paper recycle bin',
      trashDesc: 'Restore accidentally removed papers to their original libraries.',
      trashEmpty: 'The recycle bin is empty.',
      profileTitle: 'Profile',
      profileDesc: 'Manage your avatar and account security settings.',
      avatar: 'Avatar',
      uploadAvatar: 'Upload avatar',
      password: 'New password',
      passwordHint: 'At least 6 characters',
      updatePassword: 'Update password',
      writingMemory: 'Writing memory',
      writingMemoryDesc: 'Store academic writing preferences for the Agent.',
      memoryOpen: 'Manage memory',
      memoryTitle: 'Academic writing preferences',
      memoryPlaceholder: 'Write the long-term writing preferences the model should remember. You can edit model-recorded content directly.',
      memoryAdd: 'Save memory',
      memoryEmpty: 'No writing preferences saved yet.',
      memorySaved: 'Writing memory saved.',
      avatarSaved: 'Avatar updated.',
      passwordSaved: 'Password updated.',
      localOnly: 'Account settings require Supabase authentication.',
    },
    auth: {
      title: 'Sign in to ScholarX',
      subtitle: 'Sign in to access /scholarx and manage your paper libraries.',
      email: 'Email',
      password: 'Password',
      passwordHint: 'At least 6 characters',
      signIn: 'Sign in',
      signUp: 'Create account',
      verifyTitle: 'Enter email code',
      verifyDesc: 'We sent a verification code to your email. Enter the 6-digit code.',
      code: 'Code',
      verify: 'Verify and enter',
      resendCode: 'Resend code',
      codeResent: 'A new code was sent. Please check your email.',
      authServiceBusy: 'Auth could not reach the database. Please retry or resend the code.',
      pleaseRegister: 'This email is not registered. Please sign up first.',
      pleaseFinishRegister: 'This email has not finished sign-up. Please verify it from the sign-up tab.',
      noSupabase: 'Supabase frontend key is missing, so sign-in is unavailable.',
    },
    modal: {
      libraryTitle: 'Create Library',
      libraryDesc: 'This search will be saved as a new paper library.',
      libraryName: 'Library name',
      keyword: 'Keyword',
      keywordHint: 'e.g. stock forecasting',
      keywordHelp: 'Keyword rules',
      keywordHelpItems: [
        'Plain input: stock forecasting searches title terms.',
        'Phrase: "stock forecasting" matches adjacent words.',
        'Either term: stock OR finance.',
        'Combined: agent AND (stock OR portfolio OR finance) requires agent plus any term in parentheses.',
        'Exclude: stock -survey.',
        'Must include both: stock & prediction, PostgreSQL tsquery style.',
        'Prefix: stock:* matches stock / stocks / stocking-style prefixes.',
      ],
      venue: 'Journal / Conference',
      venueHint: 'e.g. SIGIR, KDD, WWW, Nature',
      scope: 'CCF / Venue',
      scopeHint: 'Type CCF A/B/C, ICLR, KDD, Nature',
      scopeRankHint: 'Add papers by CCF rank',
      sourceKeyword: 'Keyword search',
      sourcePdf: 'PDF upload',
      sourceNatural: 'Natural language guide',
      sourceManual: 'Manual form',
      naturalPrompt: 'Describe your research need',
      naturalHint: 'e.g. Find recent CCF papers about multimodal retrieval',
      naturalStart: 'Parse need',
      naturalScopeQuestion: 'Is CCF A/B/C a good scope? You can add venues or remove ranks.',
      naturalYearQuestion: 'Is the recent three-year range acceptable?',
      naturalReady: 'Parameters are ready. Confirm the generated library name.',
      naturalParsing: 'Parsing...',
      parsedKeyword: 'Parsed keyword',
      pdfFiles: 'PDF files',
      pdfHint: 'Supports one PDF, multiple PDFs, or a ZIP archive',
      yearFrom: 'Year from',
      yearTo: 'Year to',
      share: 'Share with usernames or emails, separated by commas',
      shareTitle: 'Share Library',
      shareDesc: 'Type user emails with autocomplete; remove chips to stop sharing.',
      sharePlaceholder: 'Type email',
      shareEmpty: 'Not shared with anyone yet',
      continue: 'Next',
      createSearch: 'Search and Create',
      createFromPdf: 'Create and Upload',
      addToLibrary: 'Add to current library',
      searchToAdd: 'Search papers',
      uploadToAdd: 'Upload PDFs',
      searchResults: 'Search results',
      selectedPapers: 'selected papers',
      addSelected: 'Add selected papers',
      associateTitle: 'Associate PDF manually',
      associateDesc: 'Search the DBLP library and bind this PDF to the correct paper.',
      associateToPaper: 'Associate to paper',
      tagTitleAdd: 'Add Tag',
      tagTitleEdit: 'Edit Tag',
      tagDesc: 'The description is saved as a classification prompt.',
      tagName: 'Tag name, e.g. stock',
      tagPrompt: 'Description, e.g. related to stock prediction',
      autoFolder: 'Move to matching folder automatically',
      autoFolderHint: 'Papers assigned to this tag will move into a folder with the same name.',
      folders: 'Folders',
      folderName: 'Folder name, e.g. llm+stock',
      addFolder: 'Add folder',
      addChildFolder: 'Add child folder',
      updateLibrary: 'Save library',
      updateMetadata: 'Save info',
      updateSearch: 'Refresh search',
      createdAt: 'Created',
      fileCount: 'files',
    },
  },
};

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...options,
    body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
  });
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await response.json() : { error: await response.text() };
  if (!response.ok) {
    const fallback = response.status === 502
      ? '后端服务正在重启或暂时不可达，请稍后重试。'
      : response.status === 413
        ? '上传文件过大，请减小文件或调整上传限制。'
        : '请求失败';
    throw new Error(isJson ? (data.error || fallback) : fallback);
  }
  return data;
}

async function downloadApiFile(path, options = {}, fallbackName = 'scholarx-export.txt') {
  const response = await fetch(`${API}${path}`, {
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...options,
    body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    let message = '下载失败';
    try {
      const data = await response.json();
      message = data.error || message;
    } catch {
      // Keep fallback message.
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const filename = decodeURIComponent(disposition.match(/filename="?([^"]+)"?/)?.[1] || fallbackName);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function parseSseBlock(block) {
  const lines = block.split('\n');
  let event = 'message';
  const data = [];
  lines.forEach((line) => {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trim());
  });
  if (!data.length) return null;
  return { event, data: JSON.parse(data.join('\n')) };
}

async function streamApi(path, payload, onEvent, options = {}) {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : { error: await response.text() };
    throw new Error(data.error || '请求失败');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() || '';
    blocks.forEach((block) => {
      const parsed = parseSseBlock(block.trim());
      if (parsed) onEvent(parsed.event, parsed.data);
    });
  }
}

function emptyFilters() {
  return { keyword: '', venue: '', venues: [], year_from: '2023', year_to: String(new Date().getFullYear()), rank: '', ranks: [], folders: [] };
}

const DEFAULT_TABLE_SORTS = [
  { column: 'rank', dir: 'asc' },
  { column: 'year', dir: 'desc' },
];

const TABLE_SORT_DEFAULT_DIR = {
  title: 'asc',
  year: 'desc',
  rank: 'asc',
  venue: 'asc',
  added_at: 'desc',
};

function normalizeTableSorts(filters = {}) {
  const raw = Array.isArray(filters) ? filters : filters.sorts;
  let items = [];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (filters.sort_by) {
    items = [{ column: filters.sort_by, dir: filters.sort_dir === 'asc' ? 'asc' : 'desc' }];
  } else {
    items = DEFAULT_TABLE_SORTS;
  }
  const seen = new Set();
  return items
    .map((item) => ({
      column: String(item.column || '').trim(),
      dir: item.dir === 'desc' ? 'desc' : 'asc',
    }))
    .filter((item) => {
      if (!item.column || seen.has(item.column)) return false;
      seen.add(item.column);
      return true;
    });
}

function serializeTableSorts(filters = {}) {
  const sorts = normalizeTableSorts(filters);
  return sorts.length ? sorts.map((item) => `${item.column}:${item.dir}`).join(',') : 'none';
}

function primaryTableSort(filters = {}) {
  return normalizeTableSorts(filters)[0] || { column: '', dir: '' };
}

function toggleTableSort(filters, column) {
  const sorts = normalizeTableSorts(filters);
  const defaultDir = TABLE_SORT_DEFAULT_DIR[column] || 'asc';
  const oppositeDir = defaultDir === 'asc' ? 'desc' : 'asc';
  const index = sorts.findIndex((item) => item.column === column);
  let nextSorts = sorts;
  if (index < 0) {
    nextSorts = [...sorts, { column, dir: defaultDir }];
  } else if (sorts[index].dir === defaultDir) {
    nextSorts = sorts.map((item, itemIndex) => (itemIndex === index ? { ...item, dir: oppositeDir } : item));
  } else {
    nextSorts = sorts.filter((_, itemIndex) => itemIndex !== index);
  }
  const primary = nextSorts[0] || { column: '', dir: '' };
  return {
    ...filters,
    sorts: nextSorts,
    sort_by: primary.column,
    sort_dir: primary.dir,
    page: 1,
  };
}

function emptyTableFilters() {
  const sorts = DEFAULT_TABLE_SORTS.map((item) => ({ ...item }));
  return {
    keyword: '',
    venue: '',
    venues: [],
    year_from: '',
    year_to: '',
    rank: '',
    ranks: [],
    status: '',
    tag: '',
    folder: '',
    page: 1,
    page_size: 25,
    sorts,
    sort_by: sorts[0].column,
    sort_dir: sorts[0].dir,
  };
}

function normalizeRanks(value, fallback = '') {
  const values = Array.isArray(value) ? value : String(value || fallback || '').split(',');
  return [...new Set(values
    .flatMap((rank) => String(rank).split(/[，,]/))
    .map((rank) => rank.trim().toUpperCase().replace(/^CCF[\s_-]*/, ''))
    .map((rank) => rank.slice(0, 1))
    .filter((rank) => ['A', 'B', 'C'].includes(rank)))];
}

function parseRankToken(value) {
  const token = String(value || '').trim().toUpperCase().replace(/^CCF[\s_-]*/, '');
  return ['A', 'B', 'C'].includes(token) ? token : '';
}

function splitScopeDraft(value) {
  return String(value || '')
    .split(',')
    .flatMap((item) => item.split('，'))
    .map((item) => item.trim())
    .filter(Boolean);
}

function rankParam(filters) {
  return normalizeRanks(filters.ranks, filters.rank).join(',');
}

function normalizeVenues(value, fallback = '') {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || fallback || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function venueParam(filters) {
  return normalizeVenues(filters.venues, filters.venue).join(',');
}

function hasScopeFilter(filters) {
  return normalizeRanks(filters.ranks, filters.rank).length > 0 || normalizeVenues(filters.venues, filters.venue).length > 0;
}

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

function hasUserMessages(chat) {
  return (chat.messages || []).some((message) => message.role === 'user');
}

function mergeChatTrace(existing = [], incoming = []) {
  const seen = new Set();
  return [...existing, ...incoming].filter((item) => {
    const key = `${item.stage || ''}|${item.title || ''}|${item.detail || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function chatLibraryId(chat) {
  return chat?.libraryId ?? null;
}

function chatBelongsToLibrary(chat, libraryId) {
  return chatLibraryId(chat) === (libraryId ?? null);
}

function useClickOutside(ref, enabled, onOutside) {
  useEffect(() => {
    if (!enabled) return undefined;
    function handlePointerDown(event) {
      const refs = Array.isArray(ref) ? ref : [ref];
      if (refs.some((item) => item.current?.contains(event.target))) return;
      onOutside();
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [enabled, onOutside, ref]);
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

function normalizeFolderPath(path) {
  return String(path || '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/');
}

const ROOT_FOLDER_MARKER = '__root__';

function isInvalidModelId(modelId) {
  const value = String(modelId || '').trim();
  return !value || value.includes('@') || /\s/.test(value);
}

function modelFamily(modelId) {
  const value = String(modelId || '').trim();
  const prefix = value.split(/[-_.]/)[0] || 'other';
  return prefix.toLowerCase();
}

function groupModels(models = []) {
  const groups = new Map();
  models.forEach((model) => {
    const family = modelFamily(model.id || model.name);
    if (!groups.has(family)) groups.set(family, []);
    groups.get(family).push(model);
  });
  return [...groups.entries()].map(([family, items]) => ({ family, items }));
}

function initialLlmSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('scholarx.llmSettings') || '{}');
    return {
      mode: 'single',
      ...saved,
      protocol: '',
      model: isInvalidModelId(saved.model) ? '' : saved.model,
    };
  } catch {
    return { mode: 'single', model: '', protocol: '' };
  }
}

function folderMarker(path) {
  return normalizeFolderPath(path) || ROOT_FOLDER_MARKER;
}

function paperFolderMarkers(paper) {
  const columns = paper?.user_columns_json || {};
  const markers = new Set();
  const primary = normalizeFolderPath(columns.folder);
  if (primary) markers.add(primary);
  (Array.isArray(columns.folders) ? columns.folders : []).forEach((folder) => {
    const marker = folder === ROOT_FOLDER_MARKER ? ROOT_FOLDER_MARKER : normalizeFolderPath(folder);
    if (marker) markers.add(marker);
  });
  if (!primary || markers.has(ROOT_FOLDER_MARKER)) markers.add(ROOT_FOLDER_MARKER);
  return markers;
}

function folderLeaf(path) {
  return normalizeFolderPath(path).split('/').pop() || '';
}

function isUnmatchedUploadedPaper(paper) {
  return String(paper?.dblp_key || '').startsWith('upload/');
}

function paperMetadata(paper) {
  return paper?.metadata_json && typeof paper.metadata_json === 'object' ? paper.metadata_json : {};
}

function displayPaperTitle(paper) {
  const metadata = paperMetadata(paper);
  const extractedTitle = metadata.extracted_title || metadata.pdf_bibliography?.title;
  const originalFilename = metadata.original_filename || metadata.uploaded_pdf || '';
  const filenameTitle = originalFilename ? originalFilename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() : '';
  return paper?.title || extractedTitle || filenameTitle || 'Untitled PDF';
}

function displayVenue(paper) {
  const main = paper?.main_venue_abbr || paper?.venue_abbr || paper?.main_venue_name || '';
  const detail = paper?.venue_name || paper?.venue_abbr || paper?.main_venue_name || main;
  return {
    label: main || detail || '-',
    title: detail && detail !== main ? detail : '',
  };
}

function displayPaperAbstract(paper) {
  return String(paper?.abstract || '').replace(/\s+/g, ' ').trim();
}

function folderAncestors(path) {
  const parts = normalizeFolderPath(path).split('/').filter(Boolean);
  return parts.slice(0, -1).map((_part, index) => parts.slice(0, index + 1).join('/'));
}

function buildFolderTree(paths = []) {
  const roots = [];
  const byPath = new Map();
  paths.map(normalizeFolderPath).filter(Boolean).forEach((path) => {
    const parts = path.split('/');
    parts.forEach((_part, index) => {
      const currentPath = parts.slice(0, index + 1).join('/');
      if (byPath.has(currentPath)) return;
      const node = { path: currentPath, name: parts[index], children: [] };
      byPath.set(currentPath, node);
      const parentPath = parts.slice(0, index).join('/');
      if (parentPath) byPath.get(parentPath).children.push(node);
      else roots.push(node);
    });
  });
  return roots;
}

function formatDateOnly(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

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
  const [fileWorkbenchOpen, setFileWorkbenchOpen] = useState(false);
  const [activeFile, setActiveFile] = useState(null);
  const [activeFileDraft, setActiveFileDraft] = useState('');
  const [selectedFileFolderId, setSelectedFileFolderId] = useState(null);
  const [expandedFileFolders, setExpandedFileFolders] = useState(new Set());
  const [fileSidebarMode, setFileSidebarMode] = useState('files');
  const [fileSidebarCollapsed, setFileSidebarCollapsed] = useState(false);
  const [fileSourceMode, setFileSourceMode] = useState(false);
  const [fileContextMenu, setFileContextMenu] = useState(null);
  const [renamingFileId, setRenamingFileId] = useState(null);
  const [renamingFileName, setRenamingFileName] = useState('');
  const fileEditorRef = useRef(null);
  const [paperTotal, setPaperTotal] = useState(0);
  const paperTableWrapRef = useRef(null);
  const pdfReturnPaperIdRef = useRef(null);
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
  const lastTranslatedSelectionRef = useRef('');
  const [pendingPdfUpload, setPendingPdfUpload] = useState(null);
  const [associatingPaper, setAssociatingPaper] = useState(null);
  const [detailPaper, setDetailPaper] = useState(null);
  const [detailAbstract, setDetailAbstract] = useState('');
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editingMessageIndex, setEditingMessageIndex] = useState(null);
  const [editingMessageDraft, setEditingMessageDraft] = useState('');
  const [columns, setColumns] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('scholarx.columns') || '{"left":1.15,"middle":4,"right":2}');
      if (stored.left === 1 && stored.middle === 4 && stored.right === 2) {
        return { left: 1.15, middle: 4, right: 2 };
      }
      return stored;
    } catch {
      return { left: 1.15, middle: 4, right: 2 };
    }
  });
  const [leftPaneCollapsed, setLeftPaneCollapsed] = useState(false);
  const [rightPaneCollapsed, setRightPaneCollapsed] = useState(false);
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
      if (!activeLibrary && data.libraries.length) setActiveLibrary(data.libraries[0]);
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
  }, [pdfViewer?.paperId, pdfViewer?.url]);

  useEffect(() => {
    translationPopupRef.current = translationPopup;
  }, [translationPopup]);

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
        if (selectedText === lastTranslatedSelectionRef.current && translationPopupRef.current) return;
        const range = selection.rangeCount ? selection.getRangeAt(0) : null;
        const rect = range?.getBoundingClientRect();
        const maxX = Math.max(16, window.innerWidth - 320);
        lastTranslatedSelectionRef.current = selectedText;
        translatePdfText(selectedText, rect ? {
          x: Math.min(Math.max(rect.left + rect.width / 2 - 150, 16), maxX),
          y: Math.min(Math.max(rect.bottom + 8, 74), window.innerHeight - 220),
        } : null);
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
    setPdfViewer(null);
  }

  async function openLibraryFileById(libraryId, fileId) {
    if (!libraryId || !fileId) return;
    const files = await loadLibraryFiles(libraryId);
    const file = files.find((item) => Number(item.id) === Number(fileId));
    if (file) openLibraryFile(file);
  }

  async function createMarkdownFile(parentId = selectedFileFolderId) {
    if (!activeLibrary) return;
    const data = await api(`/libraries/${activeLibrary.id}/files`, {
      method: 'POST',
      body: {
        name: '',
        type: 'markdown',
        content: '',
        parent_id: parentId || null,
      },
    });
    await loadLibraryFiles(activeLibrary.id);
    openLibraryFile(data.file);
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

  async function saveActiveFile() {
    if (!activeLibrary || !activeFile) return;
    const data = await api(`/libraries/${activeLibrary.id}/files/${activeFile.id}`, {
      method: 'PATCH',
      body: { content: activeFileDraft },
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

  function exportLibraryFile(file) {
    if (!activeLibrary || !file || file.type === 'folder') return;
    window.open(`${API}/libraries/${activeLibrary.id}/files/${file.id}/export`, '_blank', 'noopener,noreferrer');
  }

  function exportCurrentFileFolder() {
    if (!activeLibrary) return;
    const qs = selectedFileFolderId ? `?folder_id=${selectedFileFolderId}` : '';
    window.open(`${API}/libraries/${activeLibrary.id}/files/export${qs}`, '_blank', 'noopener,noreferrer');
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

  function clearPdfTranslationPopup() {
    translationRequestRef.current += 1;
    lastTranslatedSelectionRef.current = '';
    setTranslationPopup(null);
    window.getSelection?.()?.removeAllRanges?.();
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
      if (data.search_summary?.strategy === 'broad_abstract_filter') {
        showNotice(locale === 'zh'
          ? `宽松检索 ${data.search_summary.candidates} 篇，摘要筛选后加入 ${data.search_summary.added} 篇`
          : `Broad search found ${data.search_summary.candidates}; ${data.search_summary.added} passed abstract screening`);
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
    pdfReturnPaperIdRef.current = paper.id;
    setPdfViewer({ url: paper.pdf_url, title, paperId: paper.id });
  }

  function closePaperPdf() {
    clearPdfTranslationPopup();
    const returnPaperId = pdfReturnPaperIdRef.current || pdfViewer?.paperId;
    setPdfViewer(null);
    window.setTimeout(() => {
      const row = document.querySelector(`[data-paper-id="${returnPaperId}"]`);
      if (row) {
        row.scrollIntoView({ block: 'center' });
      }
    }, 0);
  }

  function openRenamePaperModal(paper) {
    setRenamingPaper(paper);
    setRenamingPaperTitle(displayPaperTitle(paper));
  }

  function openPaperDetails(paper) {
    setDetailPaper(paper);
    setDetailAbstract(displayPaperAbstract(paper));
  }

  async function savePaperAbstract() {
    if (!activeLibrary || !detailPaper) return;
    setBusy(true);
    try {
      const nextAbstract = detailAbstract.trim();
      await api(`/libraries/${activeLibrary.id}/papers/${detailPaper.id}`, {
        method: 'PATCH',
        body: { abstract: nextAbstract },
      });
      setLibraryPapers((papers) => papers.map((paper) => (
        paper.id === detailPaper.id ? { ...paper, abstract: nextAbstract, abstract_source: nextAbstract ? 'manual' : '' } : paper
      )));
      setDetailPaper(null);
      setDetailAbstract('');
      showNotice(text.table.abstractSaved);
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
    setPdfViewer(null);
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

  function resetLayout() {
    setColumns({ left: 1.15, middle: 4, right: 2 });
    setLeftPaneCollapsed(false);
    setRightPaneCollapsed(false);
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
    await requestChatAnswer(userMessage);
  }

  async function requestChatAnswer(userMessage) {
    function updateStreamingAssistant(updater) {
      updateActiveChat((chat) => {
        const nextMessages = [...(chat.messages || [])];
        const index = nextMessages.findLastIndex((message) => message.role === 'assistant' && message.streaming);
        if (index === -1) return {};
        nextMessages[index] = { ...nextMessages[index], ...updater(nextMessages[index]) };
        return { messages: nextMessages };
      });
    }

    const chatPaperIds = selectedAll
      ? []
      : selectedIds.length
        ? selectedIds
        : pdfViewer?.paperId
          ? [pdfViewer.paperId]
          : [];
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
        gridTemplateColumns: `${leftPaneCollapsed ? '0px' : `${columns.left}fr`} 16px ${columns.middle}fr 16px ${rightPaneCollapsed ? '0px' : `${columns.right}fr`}`,
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
          <div className="pane-tools">
            <button className="icon-button" title={text.common.resetLayout} aria-label={text.common.resetLayout} onClick={resetLayout}>
              <RotateCcw size={17} />
            </button>
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
        <header className={`paper-compact-header ${pdfViewer || fileWorkbenchOpen ? 'pdf-mode' : ''}`}>
          {pdfViewer && (
            <button className="secondary-button pdf-back-button" onClick={closePaperPdf}>
              <ChevronLeft size={16} /> {text.workbench.closePdf}
            </button>
          )}
          {fileWorkbenchOpen && !pdfViewer && (
            <button className="secondary-button pdf-back-button" onClick={() => {
              closeFileWorkbench();
            }}>
              <ChevronLeft size={16} /> {text.workbench.closePdf}
            </button>
          )}
          <div className="paper-header-title">
            <h2>
              {pdfViewer?.title || (fileWorkbenchOpen ? text.workbench.fileLibrary : activeLibrary?.name) || text.workbench.catalogFallback}
            </h2>
            {!pdfViewer && !fileWorkbenchOpen && (
              <p>{`${paperTotal} ${text.workbench.papersLoaded} · ${selectedCount} ${text.workbench.selected}`}</p>
            )}
            {fileWorkbenchOpen && !pdfViewer && (
              <p className="current-file-name">
                {activeFile?.name || `${libraryFiles.length} ${text.modal.fileCount || 'files'}`}
              </p>
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
          ) : fileWorkbenchOpen ? (
            <div className="pdf-header-actions">
              <button className="secondary-button" onClick={exportCurrentFileFolder}>
                {text.workbench.exportAll}
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
            className="pdf-viewer"
            onMouseDown={(event) => {
              if (!translationPopup) return;
              if (event.target.closest?.('.pdf-translation-popup')) return;
              clearPdfTranslationPopup();
            }}
          >
            <PdfJsViewer text={text} url={pdfViewer.url} title={pdfViewer.title} />
            {translationPopup && (
              <PdfTranslationPopup
                text={text}
                popup={translationPopup}
                onClose={clearPdfTranslationPopup}
              />
            )}
          </div>
        ) : fileWorkbenchOpen ? (
          <div className={`file-workbench-shell ${fileSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
            {!fileSidebarCollapsed && (
            <aside
              className="file-workbench-tree"
              onContextMenu={(event) => {
                event.preventDefault();
                setFileContextMenu({ type: 'blank', x: event.clientX, y: event.clientY, parentId: selectedFileFolderId });
              }}
            >
              <div className="file-library-header">
                <div>
                  <strong>{activeLibrary?.name || text.workbench.catalogFallback}</strong>
                </div>
                <button
                  className="icon-button"
                  title={text.workbench.newMarkdown}
                  aria-label={text.workbench.newMarkdown}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    createMarkdownFile(selectedFileFolderId);
                  }}
                  disabled={!activeLibrary}
                >
                  <Plus size={16} />
                </button>
              </div>
              <div className="file-sidebar-tabs">
                <button className={fileSidebarMode === 'files' ? 'active' : ''} onClick={() => setFileSidebarMode('files')}>{text.workbench.filesTab}</button>
                <button className={fileSidebarMode === 'outline' ? 'active' : ''} onClick={() => setFileSidebarMode('outline')}>{text.workbench.outlineTab}</button>
              </div>
              {fileSidebarMode === 'files' ? (
                <LibraryFileTree
                  text={text}
                  files={libraryFiles}
                  activeFile={activeFile}
                  selectedFolderId={selectedFileFolderId}
                  expandedFolders={expandedFileFolders}
                  setExpandedFolders={setExpandedFileFolders}
                  onOpenFile={openLibraryFile}
                  onSelectFolder={(file) => {
                    setSelectedFileFolderId(file?.id || null);
                    if (file?.id) setExpandedFileFolders((items) => new Set([...items, file.id]));
                  }}
                  onContextMenu={(event, file) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setFileContextMenu({ type: file.type === 'folder' ? 'folder' : 'file', target: file, x: event.clientX, y: event.clientY });
                  }}
                  renamingFileId={renamingFileId}
                  renamingFileName={renamingFileName}
                  setRenamingFileName={setRenamingFileName}
                  onStartRename={startRenamingFile}
                  onCommitRename={renameLibraryFile}
                  activeFileDirty={activeFileDirty}
                />
              ) : (
                <FileOutline text={text} content={activeFileDraft} onJump={(id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
              )}
            </aside>
            )}
            <section className="typora-editor-panel">
              {activeFile ? (
                fileSourceMode ? (
                  <>
                  <div className="markdown-format-toolbar">
                    <button onClick={() => insertMarkdownTemplate('# ', 2)}>H1</button>
                    <button onClick={() => insertMarkdownTemplate('## ', 3)}>H2</button>
                    <button onClick={() => insertMarkdownTemplate('### ', 4)}>H3</button>
                    <button onClick={() => insertMarkdownTemplate('\n$$\n\n$$\n', 4)}>公式</button>
                    <button onClick={() => insertMarkdownTemplate('\n```\n\n```\n', 5)}>代码</button>
                    <button onClick={() => insertMarkdownTemplate((selected) => `**${selected || '粗体'}**`, 2)}>B</button>
                    <button onClick={() => insertMarkdownTemplate((selected) => `- ${selected || '列表项'}\n`, 2)}>列表</button>
                  </div>
                  <textarea
                    ref={fileEditorRef}
                    className="typora-editor"
                    value={activeFileDraft}
                    onChange={(event) => setActiveFileDraft(event.target.value)}
                    spellCheck={false}
                  />
                  </>
                ) : (
                  <VditorMarkdownEditor
                    value={activeFileDraft}
                    onChange={setActiveFileDraft}
                    language={locale === 'zh' ? 'zh_CN' : 'en_US'}
                  />
                )
              ) : (
                <div className="file-editor-empty">
                  <FileText size={28} />
                  <strong>{text.workbench.fileEmpty}</strong>
                </div>
              )}
              <div className="file-editor-footer">
                <button onClick={() => setFileSidebarCollapsed((value) => !value)}>
                  {fileSidebarCollapsed ? '›' : '‹'}
                </button>
                <button className={fileSourceMode ? 'active' : ''} onClick={() => setFileSourceMode((value) => !value)}>
                  {'</>'}
                </button>
              </div>
            </section>
          </div>
        ) : (
          <>
            <div className="paper-table-wrap" ref={paperTableWrapRef}>
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
                    <th>
                      <div className="tag-header" ref={tagFilterRef}>
                        <button className={`column-menu-button ${tableFilters.tag ? 'active' : ''}`} onClick={() => setTagFilterOpen(!tagFilterOpen)}>
                          <Tag size={14} /> {tableFilters.tag || text.table.tagColumn} <ChevronDown size={13} />
                        </button>
                        {tagFilterOpen && (
                          <TagFilterMenu
                            text={text}
                            definitions={tagDefinitions}
                            activeTag={tableFilters.tag}
                            onSelect={applyTagFilter}
                            onAdd={() => openTagModal()}
                            onEdit={openTagModal}
                          />
                        )}
                      </div>
                    </th>
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
                        <td className="tag-cell">
                          <TagCheckboxes
                            text={text}
                            paper={paper}
                            definitions={tagDefinitions}
                            onApply={(tags) => setPaperTags(paper, tags)}
                          />
                        </td>
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
        onOpenPaperRef={(paperRef) => {
          if (paperRef?.pdf_url) {
            setPdfViewer({ url: paperRef.pdf_url, title: paperRef.title, paperId: paperRef.paper_id });
          }
        }}
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
          abstractValue={detailAbstract}
          setAbstractValue={setDetailAbstract}
          busy={busy}
          onSaveAbstract={savePaperAbstract}
          onUploadPdf={(file) => uploadPdfForPaper(detailPaper, file)}
          onClose={() => {
            setDetailPaper(null);
            setDetailAbstract('');
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
          onExport={(file) => {
            setFileContextMenu(null);
            file.type === 'folder'
              ? window.open(`${API}/libraries/${activeLibrary.id}/files/export?folder_id=${file.id}`, '_blank', 'noopener,noreferrer')
              : exportLibraryFile(file);
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

function toggleSetItem(setter, item) {
  setter((items) => {
    const next = new Set(items);
    next.has(item) ? next.delete(item) : next.add(item);
    return next;
  });
}

function LibraryTree({
  library,
  activeLibrary,
  activeFolder,
  paperTotal,
  text,
  locale,
  expandedLibraries,
  expandedFolders,
  setExpandedLibraries,
  setExpandedFolders,
  onOpenFolder,
  onOpenFiles,
  onEditLibrary,
  onShareLibrary,
  onContextMenu,
}) {
  const folderTree = buildFolderTree(library.filters_json?.folders || []);
  const expanded = expandedLibraries.has(library.id);
  return (
    <div className="library-tree-item">
      <div
        className={`library-item ${activeLibrary?.id === library.id && !activeFolder ? 'active' : ''}`}
        onContextMenu={(event) => onContextMenu(event, 'library', library)}
      >
        <button className="tree-toggle" disabled={!folderTree.length} onClick={() => toggleSetItem(setExpandedLibraries, library.id)}>
          {folderTree.length ? expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <Library size={14} />}
        </button>
        <button className="library-main-button" onClick={() => onOpenFolder(library)}>
          <span className="library-title">{library.name}</span>
          <small>
            <strong className="library-count">
              ({paperTotal || 0})
            </strong>
            {library.is_shared ? <Share2 size={13} /> : null}
            {library.created_at && (
              <span className="library-created-at">
                {text.modal.createdAt || 'Created'} {formatDateOnly(library.created_at)}
              </span>
            )}
          </small>
        </button>
        <button
          className="library-file-link"
          aria-label={text.workbench.fileLibrary}
          title={text.workbench.fileLibrary}
          onClick={() => onOpenFiles(library)}
        >
          <FileText size={13} />
        </button>
        <button
          className={`library-share-link ${library.is_shared ? 'active' : ''}`}
          aria-label={locale === 'zh' ? '共享论文库' : 'Share library'}
          title={locale === 'zh' ? '共享论文库' : 'Share library'}
          onClick={() => onShareLibrary(library)}
        >
          <Users size={13} />
        </button>
        <button
          className="library-edit-link"
          aria-label={locale === 'zh' ? '编辑论文库' : 'Edit library'}
          title={locale === 'zh' ? '编辑论文库' : 'Edit library'}
          onClick={() => onEditLibrary(library)}
        >
          <Pencil size={13} />
        </button>
      </div>
      {expanded && (
        <FolderTreeNodes
          nodes={folderTree}
          library={library}
          activeLibrary={activeLibrary}
          activeFolder={activeFolder}
          expandedFolders={expandedFolders}
          setExpandedFolders={setExpandedFolders}
          onOpenFolder={onOpenFolder}
          onContextMenu={onContextMenu}
        />
      )}
    </div>
  );
}

function FolderTreeNodes({
  nodes,
  library,
  activeLibrary,
  activeFolder,
  expandedFolders,
  setExpandedFolders,
  onOpenFolder,
  onContextMenu,
}) {
  return (
    <div className="library-folder-list">
      {nodes.map((node) => {
        const expanded = expandedFolders.has(node.path);
        return (
          <div className="library-folder-branch" key={node.path}>
            <div
              className={`library-folder-item ${activeLibrary?.id === library.id && activeFolder === node.path ? 'active' : ''}`}
              onContextMenu={(event) => onContextMenu(event, 'folder', { library, folder: node.path })}
            >
              <button className="tree-toggle" disabled={!node.children.length} onClick={() => toggleSetItem(setExpandedFolders, node.path)}>
                {node.children.length ? expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <Folder size={13} />}
              </button>
              <button className="folder-open-button" onClick={() => onOpenFolder(library, node.path)}>
                <Folder size={14} /> <span>{node.name}</span>
              </button>
            </div>
            {expanded && node.children.length > 0 && (
              <FolderTreeNodes
                nodes={node.children}
                library={library}
                activeLibrary={activeLibrary}
                activeFolder={activeFolder}
                expandedFolders={expandedFolders}
                setExpandedFolders={setExpandedFolders}
                onOpenFolder={onOpenFolder}
                onContextMenu={onContextMenu}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

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
        <button key={item.id} style={{ paddingLeft: 8 + Math.max(0, item.level - 1) * 12 }} onClick={() => onJump(item.id)}>
          {item.title}
        </button>
      ))}
    </div>
  );
}

function FileContextMenu({ text, menu, onClose, onNewFile, onNewFolder, onRename, onExport, onDelete }) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [onClose]);
  const { ref, style } = useViewportMenuPosition(menu);
  const parentId = menu.type === 'blank' ? menu.parentId : menu.target?.type === 'folder' ? menu.target.id : menu.target?.parent_id;
  return (
    <div ref={ref} className="context-menu" style={style} onClick={(event) => event.stopPropagation()}>
      {(menu.type === 'blank' || menu.type === 'folder') && (
        <>
          <button onClick={() => onNewFile(parentId)}><FileText size={14} /> {text.workbench.newFile}</button>
          <button onClick={() => onNewFolder(parentId)}><Folder size={14} /> {text.workbench.newFolder}</button>
        </>
      )}
      {menu.target && (
        <>
          <button onClick={() => onRename(menu.target)}><Pencil size={14} /> {text.workbench.rename}</button>
          <button onClick={() => onExport(menu.target)}><Download size={14} /> {text.workbench.exportAll}</button>
          <button className="danger" onClick={() => onDelete(menu.target)}><Trash2 size={14} /> {text.common.confirmDelete}</button>
        </>
      )}
    </div>
  );
}

function Avatar({ user, size = 38 }) {
  const avatarUrl = user?.user_metadata?.avatar_url;
  return (
    <span className="user-avatar" style={{ width: size, height: size }}>
      {avatarUrl ? <img src={avatarUrl} alt="" /> : <User size={Math.max(16, size / 2.2)} />}
    </span>
  );
}

function WritingMemoryModal({ text, draft, setDraft, onSave, onClose }) {
  return (
    <div className="modal-backdrop light" onClick={onClose}>
      <section className="modal memory-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>{text.user.memoryTitle}</h2>
            <p>{text.user.writingMemoryDesc}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onClose}><X size={18} /></button>
        </header>
        <div className="memory-input-row">
          <textarea
            className="memory-single-textarea"
            value={draft}
            placeholder={text.user.memoryPlaceholder}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button className="primary-button" onClick={onSave}>
            <Check size={16} /> {text.user.memoryAdd}
          </button>
        </div>
      </section>
    </div>
  );
}

function ModelSelectionModal({ text, settings, models, loading, error, onSave, onClose }) {
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState({
    mode: settings.mode || 'single',
    model: settings.model || '',
    protocol: settings.protocol || '',
  });
  useEffect(() => {
    setDraft({
      mode: settings.mode || 'single',
      model: settings.model || '',
      protocol: settings.protocol || '',
    });
  }, [settings]);
  const modelOptions = models.length ? [...models] : [];
  if (!isInvalidModelId(draft.model) && !modelOptions.some((model) => model.id === draft.model)) {
    modelOptions.unshift({ id: draft.model, name: draft.model });
  }
  const filteredModels = modelOptions.filter((model) => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return true;
    return String(model.id || '').toLowerCase().includes(keyword)
      || String(model.name || '').toLowerCase().includes(keyword);
  });
  const modelGroups = groupModels(filteredModels);
  return (
    <div className="modal-backdrop light" onClick={onClose}>
      <section className="modal model-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>{text.user.modelTitle}</h2>
            <p>{text.user.modelDesc}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onClose}><X size={18} /></button>
        </header>
        <div className="model-mode-tabs">
          <button type="button" className={draft.mode === 'single' ? 'active' : ''} onClick={() => setDraft({ ...draft, mode: 'single' })}>
            {text.user.modelList}
          </button>
          <button type="button" className={draft.mode === 'smart' ? 'active' : ''} onClick={() => setDraft({ ...draft, mode: 'smart' })}>
            {text.user.modelSmart}
          </button>
        </div>
        {draft.mode === 'single' ? (
          <div className="model-list-panel">
            {loading && <p className="field-hint">{text.user.modelLoading}</p>}
            {error && <p className="field-hint warning">{error || text.user.modelLoadFailed}</p>}
            <input
              className="model-search-input"
              value={query}
              placeholder={text.user.modelSearch}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="model-option-list">
              {modelGroups.map((group) => (
                <section className="model-group" key={group.family}>
                  <h3>
                    <span>{group.family}</span>
                    <small>{group.items.length}</small>
                  </h3>
                  {group.items.map((model) => (
                    <button
                      type="button"
                      key={model.id}
                      className={draft.model === model.id ? 'active' : ''}
                      onClick={() => setDraft({ ...draft, model: model.id })}
                    >
                      <span>{model.name || model.id}</span>
                      {draft.model === model.id && <Check size={15} />}
                    </button>
                  ))}
                </section>
              ))}
            </div>
          </div>
        ) : (
          <div className="model-smart-panel">
            <strong>{text.user.modelSmartTitle}</strong>
            <p>{text.user.modelSmartDesc}</p>
          </div>
        )}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>{text.common.cancel}</button>
          <button className="primary-button" onClick={() => onSave(draft)}>
            <Check size={16} /> {text.common.save}
          </button>
        </div>
      </section>
    </div>
  );
}

function ProfilePage({ text, user, userEmail, onBack }) {
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canUpdateAccount = Boolean(supabase && user?.id);

  async function uploadAvatar(file) {
    if (!file || !canUpdateAccount) return;
    setBusy(true);
    setError('');
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() || 'png';
      const path = `${user.id}/avatar-${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const { error: updateError } = await supabase.auth.updateUser({ data: { avatar_url: data.publicUrl } });
      if (updateError) throw updateError;
      setNotice(text.user.avatarSaved);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function updatePassword() {
    if (!canUpdateAccount || password.length < 6) return;
    setBusy(true);
    setError('');
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setPassword('');
      setNotice(text.user.passwordSaved);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="account-shell">
      <section className="account-page">
        <button className="secondary-button account-back" onClick={onBack}><ChevronLeft size={16} /> {text.common.backToWorkbench}</button>
        <header>
          <div>
            <h1>{text.user.profileTitle}</h1>
            <p>{text.user.profileDesc}</p>
          </div>
          <Avatar user={user} size={72} />
        </header>
        {error && <div className="error-banner">{error}</div>}
        {notice && <div className="success-banner">{notice}</div>}
        {!canUpdateAccount && <div className="error-banner">{text.user.localOnly}</div>}
        <article className="account-card">
          <h2>{text.user.avatar}</h2>
          <p>{userEmail}</p>
          <label className="secondary-button avatar-upload">
            <Upload size={16} /> {text.user.uploadAvatar}
            <input type="file" accept="image/*" disabled={!canUpdateAccount || busy} onChange={(event) => uploadAvatar(event.target.files?.[0])} />
          </label>
        </article>
        <article className="account-card">
          <h2>{text.user.password}</h2>
          <input type="password" placeholder={text.user.passwordHint} value={password} onChange={(event) => setPassword(event.target.value)} />
          <button className="primary-button" disabled={!canUpdateAccount || busy || password.length < 6} onClick={updatePassword}>
            <KeyRound size={16} /> {text.user.updatePassword}
          </button>
        </article>
      </section>
    </main>
  );
}

function TrashPage({ text, userEmail, onBack }) {
  const [papers, setPapers] = useState([]);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');

  async function loadTrash() {
    try {
      const data = await api(`/trash?owner=${encodeURIComponent(userEmail || '')}`);
      setPapers(data.papers || []);
      setFiles(data.files || []);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadTrash();
  }, [userEmail]);

  async function restorePaper(paper) {
    await api(`/libraries/${paper.library_id}/papers/${paper.id}/restore`, { method: 'POST', body: {} });
    await loadTrash();
  }

  async function restoreFile(file) {
    await api(`/libraries/${file.library_id}/files/${file.id}/restore`, { method: 'POST', body: {} });
    await loadTrash();
  }

  return (
    <main className="account-shell">
      <section className="account-page trash-page">
        <button className="secondary-button account-back" onClick={onBack}><ChevronLeft size={16} /> {text.common.backToWorkbench}</button>
        <header>
          <div>
            <h1>{text.user.trashTitle}</h1>
            <p>{text.user.trashDesc}</p>
          </div>
          <Trash2 size={32} />
        </header>
        {error && <div className="error-banner">{error}</div>}
        <div className="trash-list">
          {papers.map((paper) => (
            <article className="trash-item" key={`${paper.library_id}-${paper.id}`}>
              <div>
                <strong>{paper.title}</strong>
                <span>{paper.library_name}</span>
              </div>
              <button className="secondary-button" onClick={() => restorePaper(paper)}><RotateCcw size={15} /> {text.table.restore}</button>
            </article>
          ))}
          {files.map((file) => (
            <article className="trash-item" key={`file-${file.library_id}-${file.id}`}>
              <div>
                <strong>{file.name}</strong>
                <span>{file.library_name || ''} · {file.type === 'folder' ? text.workbench.newFolder : text.workbench.fileLibrary}</span>
              </div>
              <button className="secondary-button" onClick={() => restoreFile(file)}><RotateCcw size={15} /> {text.table.restore}</button>
            </article>
          ))}
          {!papers.length && !files.length && <p className="library-empty">{text.user.trashEmpty}</p>}
        </div>
      </section>
    </main>
  );
}

function HomePage({ text, locale, setLocale, stats, onDemo, userEmail, onSignOut }) {
  const statText = stats ? `${stats.papers.toLocaleString()} ${text.brand.indexed}` : text.brand.fallback;

  return (
    <main className="home-shell">
      <nav className="home-nav">
        <div className="brand">
          <div className="brand-mark"><GraduationCap size={23} /></div>
          <div>
            <h1>{text.brand.name}</h1>
            <p>{statText}</p>
          </div>
        </div>
        <div className="nav-actions">
          <a href="#features">{text.home.navFeatures}</a>
          <a href="#stories">{text.home.navStories}</a>
          <LanguageToggle locale={locale} setLocale={setLocale} text={text} />
          {userEmail && <span className="nav-user"><User size={15} /> {userEmail}</span>}
          {userEmail && (
            <button className="icon-button" title={text.common.signOut} aria-label={text.common.signOut} onClick={onSignOut}>
              <LogOut size={17} />
            </button>
          )}
          <button className="secondary-button nav-demo" onClick={onDemo}>
            {text.common.demo} <ArrowRight size={16} />
          </button>
        </div>
      </nav>

      <section className="home-hero">
        <div className="home-copy">
          <span className="eyebrow"><Sparkles size={15} /> {text.home.eyebrow}</span>
          <h2>{text.home.title}</h2>
          <p>{text.home.subtitle}</p>
          <div className="home-actions">
            <button className="primary-button demo-button" onClick={onDemo}>
              <Rocket size={20} /> {text.home.primary}
            </button>
            <a className="secondary-link" href="#features">
              <BookOpen size={17} /> {text.home.secondary}
            </a>
          </div>
        </div>

        <div className="home-board" aria-label={text.home.catalogTitle}>
          <div className="mini-window clay-pink">
            <div className="window-dots"><span /><span /><span /></div>
            <h3>{text.home.catalogTitle}</h3>
            <p>{text.home.catalogMeta}</p>
            <div className="course-preview">
              <span>{text.home.courseA}</span>
              <strong>CCF A</strong>
            </div>
            <div className="course-preview">
              <span>{text.home.courseB}</span>
              <strong>2025</strong>
            </div>
            <div className="course-preview">
              <span>{text.home.courseC}</span>
              <strong>PDF</strong>
            </div>
          </div>
          <div className="mini-window clay-mint">
            <div className="course-icon"><BarChart3 size={22} /></div>
            <h3>{text.home.progressTitle}</h3>
            <p>{text.home.progressMeta}</p>
            <ProgressRow label={text.home.progressDone} value="72%" />
            <ProgressRow label={text.home.progressPdf} value="48%" />
            <ProgressRow label={text.home.progressDraft} value="36%" />
          </div>
        </div>
      </section>

      <section id="features" className="home-section feature-grid">
        <article className="home-card">
          <BookMarked size={25} />
          <h3>{text.home.catalogTitle}</h3>
          <p>{text.home.catalogDesc}</p>
        </article>
        <article className="home-card">
          <BarChart3 size={25} />
          <h3>{text.home.progressTitle}</h3>
          <p>{text.home.progressDesc}</p>
        </article>
        <article className="home-card">
          <Bot size={25} />
          <h3>{text.agent.title}</h3>
          <p>{text.agent.placeholder}</p>
        </article>
      </section>

      <section id="stories" className="home-section story-band">
        <div>
          <span className="eyebrow"><Users size={15} /> {text.home.testimonialTitle}</span>
          <h2>{text.home.ctaTitle}</h2>
          <p>{text.home.ctaDesc}</p>
        </div>
        <div className="story-stack">
          <div className="testimonial-card"><Trophy size={20} /><p>{text.home.testimonialOne}</p><small>{text.home.progressDraft}</small></div>
          <div className="testimonial-card"><Tag size={20} /><p>{text.home.testimonialTwo}</p><small>{text.home.progressDone}</small></div>
        </div>
      </section>

      <section className="home-cta">
        <div>
          <h2>{text.home.ctaTitle}</h2>
          <p>{text.home.ctaDesc}</p>
        </div>
        <button className="primary-button demo-button" onClick={onDemo}>
          <Rocket size={20} /> {text.home.ctaButton}
        </button>
      </section>
    </main>
  );
}

function ProgressRow({ label, value }) {
  return (
    <div className="progress-row">
      <div><span>{label}</span><strong>{value}</strong></div>
      <div className="progress-track"><span style={{ width: value }} /></div>
    </div>
  );
}

function AuthPage({ text, locale, setLocale, onHome, onAuthed }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState('signin');
  const [pendingVerification, setPendingVerification] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitAuth() {
    setError('');
    setBusy(true);
    try {
      if (!supabase) {
        if (!email.trim()) throw new Error(text.auth.noSupabase);
        localStorage.setItem('scholarx.localUser', email.trim());
        onAuthed({ user: { email: email.trim() } });
        return;
      }
      if (mode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        setPendingVerification(true);
        return;
      }
      const status = await api(`/auth/email-status?email=${encodeURIComponent(email.trim())}`);
      if (!status.exists) {
        setMode('signup');
        setError(text.auth.pleaseRegister);
        return;
      }
      if (!status.confirmed) {
        setMode('signup');
        setPendingVerification(false);
        setError(text.auth.pleaseFinishRegister);
        return;
      }
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        if (authError.message?.toLowerCase().includes('email not confirmed')) {
          setMode('signup');
          setPendingVerification(false);
          setError(text.auth.pleaseFinishRegister);
          return;
        }
        if (
          authError.message?.toLowerCase().includes('invalid login credentials')
          || authError.code === 'invalid_credentials'
        ) {
          setMode('signup');
          setError(text.auth.pleaseRegister);
          return;
        }
        throw authError;
      }
      if (data.session) onAuthed(data.session);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    setError('');
    setBusy(true);
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: code.trim(),
        type: 'signup',
      });
      if (verifyError) {
        if (verifyError.message?.toLowerCase().includes('unexpected failure')) {
          throw new Error(text.auth.authServiceBusy);
        }
        throw verifyError;
      }
      onAuthed(data.session || { user: data.user });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    setError('');
    setBusy(true);
    try {
      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) throw signUpError;
      setCode('');
      setError(text.auth.codeResent);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand">
          <div className="brand-mark"><GraduationCap size={23} /></div>
          <div>
            <h1>{text.brand.name}</h1>
            <p>{text.auth.subtitle}</p>
          </div>
        </div>
        <div>
          <h2>{pendingVerification ? text.auth.verifyTitle : text.auth.title}</h2>
          <p>{pendingVerification ? text.auth.verifyDesc : text.auth.subtitle}</p>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {!pendingVerification ? (
          <>
            <label>
              <span>{text.auth.email}</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              <span>{text.auth.password}</span>
              <input type="password" placeholder={text.auth.passwordHint} value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <div className="segmented">
              <button type="button" className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>{text.auth.signIn}</button>
              <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>{text.auth.signUp}</button>
            </div>
            <button className="primary-button" disabled={busy || !email.trim()} onClick={submitAuth}>
              <KeyRound size={17} /> {mode === 'signin' ? text.auth.signIn : text.auth.signUp}
            </button>
          </>
        ) : (
          <>
            <label>
              <span>{text.auth.code}</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
            </label>
            <button className="primary-button" disabled={busy || !code.trim()} onClick={verifyCode}>
              <KeyRound size={17} /> {text.auth.verify}
            </button>
            <button className="secondary-button" disabled={busy || !email.trim()} onClick={resendCode}>
              <RotateCcw size={17} /> {text.auth.resendCode}
            </button>
          </>
        )}
        <div className="auth-actions">
          <button className="secondary-button" onClick={onHome}><Home size={16} /> {text.common.home}</button>
          <LanguageToggle locale={locale} setLocale={setLocale} text={text} />
        </div>
      </section>
    </main>
  );
}

function LanguageToggle({ locale, setLocale, text }) {
  return (
    <button
      className="language-toggle"
      type="button"
      aria-label={text.common.language}
      onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
    >
      {text.common.switchLanguage}
    </button>
  );
}

function ColumnCollapseToggle({ side, columns, setColumns, collapsed, onToggle }) {
  const draggedRef = useRef(false);
  const label = side === 'left'
    ? (collapsed ? '>' : '<')
    : (collapsed ? '<' : '>');

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
    >
      {label}
    </button>
  );
}

function SortButton({ label, column, tableFilters, setTableFilters }) {
  const sorts = normalizeTableSorts(tableFilters);
  const sortIndex = sorts.findIndex((item) => item.column === column);
  const active = sortIndex >= 0;
  const direction = active ? sorts[sortIndex].dir : '';
  return (
    <button
      type="button"
      className={`sort-button ${active ? 'active' : ''}`}
      onClick={() => setTableFilters((current) => toggleTableSort(current, column))}
      title="点击切换排序：默认方向、反方向、取消"
    >
      {label}
      {active ? <span className="sort-indicator">{direction === 'asc' ? '↑' : '↓'}{sorts.length > 1 ? sortIndex + 1 : ''}</span> : <ArrowUpDown size={13} />}
    </button>
  );
}

function PdfJsViewer({ text, url, title }) {
  const [pdf, setPdf] = useState(null);
  const [error, setError] = useState('');
  const [scale, setScale] = useState(1.4);

  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setError('');
    const task = pdfjsLib.getDocument({ url: pdfFetchUrl(url) });
    task.promise
      .then((document) => {
        if (!cancelled) setPdf(document);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || text.workbench.pdfLoadError);
      });
    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [url, text.workbench.pdfLoadError]);

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
  return (
    <div className="pdf-js-wrap" aria-label={title}>
      <div className="pdf-js-toolbar">
        <span>{pdf.numPages} pages</span>
        <button className="icon-button" onClick={() => setScale((value) => Math.max(0.7, Number((value - 0.1).toFixed(2))))}>-</button>
        <strong>{Math.round(scale * 100)}%</strong>
        <button className="icon-button" onClick={() => setScale((value) => Math.min(2.2, Number((value + 0.1).toFixed(2))))}>+</button>
      </div>
      <div className="pdf-js-pages">
        {pages.map((pageNumber) => (
          <PdfJsPage key={`${pageNumber}-${scale}`} pdf={pdf} pageNumber={pageNumber} scale={scale} />
        ))}
      </div>
    </div>
  );
}

function PdfJsPage({ pdf, pageNumber, scale }) {
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
  }, [pdf, pageNumber, scale]);

  return (
    <section className="pdf-js-page" style={{ width: size.width || undefined, minHeight: size.height || 520 }}>
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

function PdfTranslationPopup({ text, popup, onClose }) {
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
      <button
        className="translation-close"
        onMouseDown={(event) => event.stopPropagation()}
        onMouseUp={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        aria-label={text.common.cancel}
      >
        <X size={12} />
      </button>
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

function PaginationBar({ text, tableFilters, total, onChange, onDownload, selectedCount, citationStatus, onExport, onRetryCitations }) {
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const downloadRef = useRef(null);
  const exportRef = useRef(null);
  const pageCount = Math.max(1, Math.ceil((total || 0) / tableFilters.page_size));
  const page = Math.min(tableFilters.page, pageCount);
  const pages = Array.from(new Set([1, page - 1, page, page + 1, pageCount]))
    .filter((item) => item >= 1 && item <= pageCount)
    .sort((a, b) => a - b);
  const exportDisabled = !selectedCount || !citationStatus?.exportable;
  const exportTitle = selectedCount
    ? citationStatus?.exportable
      ? text.workbench.citationReady
      : `${text.workbench.citationFetching}: ${citationStatus?.ready || 0}/${citationStatus?.total || selectedCount}`
    : text.workbench.exportCitations;
  useClickOutside(downloadRef, downloadOpen, () => setDownloadOpen(false));
  useClickOutside(exportRef, exportOpen, () => setExportOpen(false));
  return (
    <footer className="pagination-bar">
      <div className="download-actions">
        <div className="dropdown-action" ref={downloadRef}>
          <button className="secondary-button compact-download" disabled={!selectedCount} onClick={() => setDownloadOpen((open) => !open)}>
            <Download size={15} /> {text.workbench.download} <ChevronDown size={13} />
          </button>
          {downloadOpen && !!selectedCount && (
            <div className="dropdown-menu">
              <button onClick={() => { setDownloadOpen(false); onDownload('csv'); }}>{text.workbench.downloadCsv}</button>
              <button onClick={() => { setDownloadOpen(false); onDownload('xlsx'); }}>{text.workbench.downloadExcel}</button>
            </div>
          )}
        </div>
        <div className="dropdown-action" ref={exportRef}>
          <button className="secondary-button compact-download" title={exportTitle} disabled={exportDisabled} onClick={() => setExportOpen((open) => !open)}>
            <FileText size={15} /> {text.workbench.exportCitations} <ChevronDown size={13} />
          </button>
          {exportOpen && !exportDisabled && (
            <div className="dropdown-menu">
              <button onClick={() => { setExportOpen(false); onExport('bib'); }}>{text.workbench.exportBib}</button>
              <button onClick={() => { setExportOpen(false); onExport('apa'); }}>{text.workbench.exportApa}</button>
              <button onClick={() => { setExportOpen(false); onExport('mla'); }}>{text.workbench.exportMla}</button>
              <button onClick={() => { setExportOpen(false); onExport('gbt'); }}>{text.workbench.exportGbt}</button>
            </div>
          )}
        </div>
        {selectedCount > 0 && (citationStatus?.failed || 0) > 0 && (
          <button className="secondary-button compact-download" onClick={onRetryCitations}>
            {text.workbench.citationRetry}
          </button>
        )}
      </div>
      <div className="scholar-pages">
        <button className="icon-button" disabled={page <= 1} title={text.workbench.previous} onClick={() => onChange({ ...tableFilters, page: page - 1 })}>
          <ChevronLeft size={17} />
        </button>
        {pages.map((item, index) => (
          <React.Fragment key={item}>
            {index > 0 && item - pages[index - 1] > 1 && <span className="page-gap">...</span>}
            <button className={`page-number ${item === page ? 'active' : ''}`} onClick={() => onChange({ ...tableFilters, page: item })}>{item}</button>
          </React.Fragment>
        ))}
        <button className="icon-button" disabled={page >= pageCount} title={text.workbench.next} onClick={() => onChange({ ...tableFilters, page: page + 1 })}>
          <ChevronRight size={17} />
        </button>
        <select value={tableFilters.page_size} onChange={(e) => onChange({ ...tableFilters, page_size: Number(e.target.value), page: 1 })}>
          <option value="10">10</option>
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </div>
    </footer>
  );
}

function ContextMenu({ text, menu, folders, currentFolder, onClose, onEditLibrary, onNewFolder, onNewChildFolder, onDeleteFolder, onDeleteLibrary, onPinLibrary, onMovePaper, onCopyPaper, onRelinkPaper, onOpenDetails, onRenamePaper, onDeletePaper }) {
  const [openSubmenu, setOpenSubmenu] = useState(null);
  useEffect(() => {
    window.addEventListener('click', onClose);
    return () => window.removeEventListener('click', onClose);
  }, [onClose]);
  const { ref, style } = useViewportMenuPosition(menu);
  const submenuSide = menu.x > window.innerWidth - 420 ? 'left' : 'right';
  const moveTargets = menu.type === 'paper' ? folders.filter((folder) => folder !== currentFolder) : [];
  const copyTargets = menu.type === 'paper' ? folders.filter((folder) => !paperFolderMarkers(menu.target).has(folderMarker(folder))) : [];

  return (
    <div ref={ref} className="context-menu" style={style} onClick={(event) => event.stopPropagation()}>
      {menu.type === 'library' && (
        <>
          <button onClick={() => onEditLibrary(menu.target)}><Pencil size={14} /> 修改论文库</button>
          <button onClick={() => onPinLibrary(menu.target)}><ChevronUp size={14} /> 置顶</button>
          <button onClick={() => onNewFolder(menu.target)}><Plus size={14} /> 新建子目录</button>
          <button className="danger" onClick={() => onDeleteLibrary(menu.target)}><Trash2 size={14} /> {text.library.delete}</button>
        </>
      )}
      {menu.type === 'folder' && (
        <>
          <div className="context-menu-title">{menu.target.folder}</div>
          <button onClick={() => onNewChildFolder(menu.target.library, menu.target.folder)}><Plus size={14} /> {text.modal.addChildFolder}</button>
          <button className="danger" onClick={() => onDeleteFolder(menu.target.library, menu.target.folder)}><Trash2 size={14} /> {text.table.deleteFolder}</button>
        </>
      )}
      {menu.type === 'paper' && (
        <>
          <button onClick={() => onOpenDetails(menu.target)}><HelpCircle size={14} /> {text.table.details}</button>
          <div
            className="context-submenu-wrap"
            onMouseEnter={() => setOpenSubmenu('move')}
          >
            <button className="context-submenu-trigger" onClick={() => setOpenSubmenu(openSubmenu === 'move' ? null : 'move')}>
              <Folder size={14} /> {text.table.moveToFolder} <ChevronRight size={14} />
            </button>
            {openSubmenu === 'move' && (
              <div className={`context-submenu ${submenuSide}`}>
                {((currentFolder && currentFolder !== '__all__') || menu.target.user_columns_json?.folder) && (
                  <button onClick={() => onMovePaper(menu.target, '')}><Folder size={14} /> {text.table.moveToRoot}</button>
                )}
                {moveTargets.map((folder) => (
                  <button className="context-folder-target" style={{ paddingLeft: 12 + folder.split('/').length * 10 }} key={folder} onClick={() => onMovePaper(menu.target, folder)}>
                    <Folder size={14} /> {folderLeaf(folder)}
                  </button>
                ))}
                {moveTargets.length === 0 && <button disabled>{text.table.noFolder}</button>}
              </div>
            )}
          </div>
          <div
            className="context-submenu-wrap"
            onMouseEnter={() => setOpenSubmenu('copy')}
          >
            <button className="context-submenu-trigger" onClick={() => setOpenSubmenu(openSubmenu === 'copy' ? null : 'copy')}>
              <Copy size={14} /> {text.table.copyToFolder} <ChevronRight size={14} />
            </button>
            {openSubmenu === 'copy' && (
              <div className={`context-submenu ${submenuSide}`}>
                {copyTargets.map((folder) => (
                  <button className="context-folder-target" style={{ paddingLeft: 12 + folder.split('/').length * 10 }} key={`copy-${folder}`} onClick={() => onCopyPaper(menu.target, folder)}>
                    <Copy size={14} /> {folderLeaf(folder)}
                  </button>
                ))}
                {copyTargets.length === 0 && <button disabled>{text.table.noFolder}</button>}
              </div>
            )}
          </div>
          {menu.target.pdf_url && (
            <button onClick={() => onRelinkPaper(menu.target)}><Search size={14} /> {text.table.relink}</button>
          )}
          {isUnmatchedUploadedPaper(menu.target) && (
            <button onClick={() => onRenamePaper(menu.target)}><Pencil size={14} /> {text.table.renamePaper}</button>
          )}
          <button className="danger" onClick={() => onDeletePaper(menu.target)}><Trash2 size={14} /> {text.table.remove}</button>
        </>
      )}
    </div>
  );
}

function useViewportMenuPosition(menu) {
  const ref = useRef(null);
  const [style, setStyle] = useState({ left: menu.x, top: menu.y });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      setStyle({ left: menu.x, top: menu.y });
      return;
    }

    const margin = 8;
    const rect = element.getBoundingClientRect();
    let left = menu.x;
    let top = menu.y;

    if (left + rect.width + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (top + rect.height + margin > window.innerHeight) {
      top = menu.y - rect.height - margin;
      if (top < margin) {
        top = Math.max(margin, window.innerHeight - rect.height - margin);
      }
    }

    setStyle({ left, top });
  }, [menu]);

  return { ref, style };
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
  onOpenPaperRef,
}) {
  const subtitle = selectedCount
    ? `${text.agent.selectedPrefix}${selectedCount}${text.agent.selectedSuffix}`
    : activeSkillIds.length
      ? `${text.agent.skillActivePrefix}${activeSkillIds.length}${text.agent.skillActiveSuffix}`
      : text.agent.context;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const historyActionsRef = useRef(null);
  const historyPopoverRef = useRef(null);
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

  return (
    <aside className={`agent-pane deepseek-pane ${collapsed ? 'collapsed' : ''}`}>
      <div className="deep-chat-main">
        <header className="deep-chat-header">
          <div>
            <h2>{text.agent.title}</h2>
            <p>{subtitle}</p>
          </div>
          <div className="deep-chat-actions" ref={historyActionsRef}>
            <button className="icon-button" onClick={() => setHistoryOpen(!historyOpen)} aria-label={text.agent.history}><History size={18} /></button>
            <button className="icon-button" onClick={() => setSkillsOpen(true)} aria-label={text.agent.skills} title={text.agent.skills}><Puzzle size={18} /></button>
            <button className="icon-button" onClick={onNewChat} aria-label={text.agent.newChat}><Plus size={18} /></button>
          </div>
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
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.content || ''}
                    </ReactMarkdown>
                  </div>
                ) : null}
                {message.role === 'assistant' && !message.streaming && !message.error && Boolean(message.paper_refs?.length) && (
                  <MessageMetaSection title={text.agent.references} count={message.paper_refs.length}>
                    <div className="paper-ref-list">
                      {message.paper_refs.map((paperRef) => (
                        <button
                          key={paperRef.ref}
                          type="button"
                          disabled={!paperRef.pdf_url}
                          onClick={() => onOpenPaperRef?.(paperRef)}
                        >
                          <span>{paperRef.ref}</span>
                          {paperRef.title}
                        </button>
                      ))}
                    </div>
                  </MessageMetaSection>
                )}
                {message.role === 'assistant' && !message.streaming && !message.error && Boolean(message.pdf_evidence?.length) && (
                  <MessageMetaSection title={text.agent.evidence} count={message.pdf_evidence.length} variant="evidence">
                    <div className="evidence-chip-list">
                      {message.pdf_evidence.map((item) => (
                        <span key={item.citation} title={item.text}>
                          {item.citation} · {item.method || 'retrieval'} · chunk {(item.chunk_no ?? 0) + 1}
                        </span>
                      ))}
                    </div>
                  </MessageMetaSection>
                )}
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
        </div>
        <div className="deep-composer">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={text.agent.placeholder}
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

function LibraryCreateProgress({ text, onBackground, task = null }) {
  const isPdfTask = Boolean(task);
  const items = task?.items || [];
  const done = task?.done || 0;
  const total = task?.total || items.length || 0;
  return (
    <div className="modal-backdrop light">
      <section className={`modal compact progress-modal ${isPdfTask ? 'pdf-task-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="library-progress-title">
        {!isPdfTask && (
          <div className="search-loader" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}
        <div>
          <h2 id="library-progress-title">{isPdfTask ? (text.modal.uploadPdfZip || text.modal.pdfFiles) : text.workbench.creatingTitle}</h2>
          <p>{isPdfTask ? `${done}/${total} ${text.modal.pdfFiles}` : text.workbench.creatingDesc}</p>
        </div>
        {isPdfTask ? (
          <div className="pdf-task-list">
            {items.map((item) => (
              <article className={`pdf-task-item ${item.status || 'queued'} ${item.stage || ''}`} key={`${item.index}-${item.filename}`}>
                <div>
                  <strong>{item.title || item.filename}</strong>
                  <span>{item.detail || item.stage || 'queued'}</span>
                  {item.parse_error && <small>{item.parse_error}</small>}
                </div>
                <em>{item.status === 'done' ? '完成' : item.status === 'error' ? '失败' : '处理中'}</em>
              </article>
            ))}
          </div>
        ) : (
          <div className="progress-scan">
            <span />
          </div>
        )}
        <button className="secondary-button" onClick={onBackground}>
          <RotateCcw size={17} /> {text.common.background}
        </button>
      </section>
    </div>
  );
}

function KeywordHelp({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="keyword-help-wrap">
      <button
        type="button"
        className="keyword-help-button"
        aria-label={text.modal.keywordHelp}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <HelpCircle size={15} />
      </button>
      {open && (
        <div className="keyword-help-popover" role="tooltip">
          <strong>{text.modal.keywordHelp}</strong>
          {text.modal.keywordHelpItems.map((item) => <span key={item}>{item}</span>)}
        </div>
      )}
    </span>
  );
}

function ScopeTokenInput({ value, onChange, text, onEnter, autoFocus = false }) {
  const ranks = normalizeRanks(value.ranks, value.rank);
  const venues = normalizeVenues(value.venues, value.venue);
  const inputRef = useRef(null);
  const [draft, setDraft] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const rankSuggestions = ['A', 'B', 'C']
    .filter((rank) => !ranks.includes(rank))
    .filter((rank) => {
      const term = draft.trim().toLowerCase();
      const normalizedRank = parseRankToken(term);
      return !term || normalizedRank === rank || rank.toLowerCase().startsWith(term) || `ccf ${rank.toLowerCase()}`.includes(term) || `ccf-${rank.toLowerCase()}`.includes(term);
    })
    .map((rank) => ({ id: `rank-${rank}`, type: 'rank', rank }));

  useEffect(() => {
    const term = draft.trim();
    if (term.length < 1) {
      setSuggestions([]);
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      try {
        const data = await api(`/venues/suggest?q=${encodeURIComponent(term)}`);
        const existing = new Set(venues.map((item) => item.toLowerCase()));
        setSuggestions((data.venues || []).filter((item) => {
          const key = item.venue_abbr || item.venue_name || item.dblp_key || item.dblp_detail_key || '';
          return key && !existing.has(key.toLowerCase());
        }));
        setOpen(true);
      } catch {
        setSuggestions([]);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [draft, venues.join('|')]);

  function emit(nextRanks, nextVenues) {
    onChange({
      rank: nextRanks.join(','),
      ranks: nextRanks,
      venue: nextVenues.join(','),
      venues: nextVenues,
    });
  }

  function choose(item) {
    if (item.type === 'rank') {
      emit([...ranks, item.rank], venues);
    } else {
      emit(ranks, [...venues, item.venue_abbr || item.venue_name || item.dblp_key || item.dblp_detail_key || ''].filter(Boolean));
    }
    setDraft('');
    setOpen(false);
  }

  function commitDraft() {
    const items = splitScopeDraft(draft);
    if (!items.length) return false;
    const nextRanks = [...ranks];
    const nextVenues = [...venues];
    items.forEach((item) => {
      const parsedRank = parseRankToken(item);
      if (parsedRank) {
        if (!nextRanks.includes(parsedRank)) nextRanks.push(parsedRank);
      } else if (!nextVenues.some((venue) => venue.toLowerCase() === item.toLowerCase())) {
        nextVenues.push(item);
      }
    });
    emit(nextRanks, nextVenues);
    setDraft('');
    setOpen(false);
    return true;
  }

  function pick(event, item) {
    event.preventDefault();
    event.stopPropagation();
    choose(item);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function focusInput(event) {
    if (event.target.closest?.('button')) return;
    if (event.target !== inputRef.current) {
      event.preventDefault();
    }
    inputRef.current?.focus();
    setOpen(true);
  }

  function stopChipButtonMouseDown(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function removeRank(event, rank) {
    event.preventDefault();
    event.stopPropagation();
    emit(ranks.filter((item) => item !== rank), venues);
    setDraft('');
    setOpen(false);
  }

  function removeVenue(event, venue) {
    event.preventDefault();
    event.stopPropagation();
    emit(ranks, venues.filter((item) => item !== venue));
    setDraft('');
    setOpen(false);
  }

  return (
    <div className="scope-combobox">
      <div className="scope-token-field" onMouseDown={focusInput}>
        {ranks.map((rank) => (
          <span className={`scope-chip rank-${rank}`} key={`rank-${rank}`}>
            CCF {rank}
            <button type="button" aria-label={`Remove CCF ${rank}`} onMouseDown={stopChipButtonMouseDown} onClick={(event) => removeRank(event, rank)}><X size={13} /></button>
          </span>
        ))}
        {venues.map((venue) => (
          <span className="scope-chip venue-chip" key={`venue-${venue}`}>
            {venue}
            <button type="button" aria-label={`Remove ${venue}`} onMouseDown={stopChipButtonMouseDown} onClick={(event) => removeVenue(event, venue)}><X size={13} /></button>
          </span>
        ))}
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          placeholder={ranks.length || venues.length ? '' : text.modal.scopeHint}
          value={draft}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => {
            commitDraft();
            setOpen(false);
          }, 120)}
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !draft && (venues.length || ranks.length)) {
              venues.length ? emit(ranks, venues.slice(0, -1)) : emit(ranks.slice(0, -1), venues);
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const first = [...rankSuggestions, ...suggestions][0];
              const draftRank = parseRankToken(draft);
              if (draftRank && !ranks.includes(draftRank)) {
                choose({ id: `rank-${draftRank}`, type: 'rank', rank: draftRank });
              } else if (first) {
                choose(first);
              } else {
                commitDraft() || onEnter?.();
              }
            }
          }}
          autoComplete="off"
        />
      </div>
      {open && !![...rankSuggestions, ...suggestions].length && (
        <div className="scope-suggestions" role="listbox">
          {rankSuggestions.map((item) => (
            <button key={item.id} type="button" onMouseDown={(event) => pick(event, item)}>
              <strong>CCF {item.rank}</strong>
              <span>{text.modal.scopeRankHint}</span>
            </button>
          ))}
          {suggestions.map((item) => (
            <button key={`venue-${item.id}`} type="button" onMouseDown={(event) => pick(event, item)}>
              <strong>{item.venue_abbr || item.venue_name}</strong>
              <span>{[item.venue_name && item.venue_abbr ? item.venue_name : '', item.rank ? `CCF ${item.rank}` : '', item.dblp_key].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function YearRangeSlider({ value, onChange, minYear = 1950, maxYear = new Date().getFullYear(), text }) {
  const from = Number(value.year_from || 2023);
  const to = Number(value.year_to || maxYear);
  const safeFrom = Math.min(Math.max(from, minYear), to);
  const safeTo = Math.max(Math.min(to, maxYear), safeFrom);
  const recentStart = Math.max(minYear, maxYear - 9);
  const recentWeight = 0.7;
  const oldWeight = 1 - recentWeight;

  function yearToPosition(year) {
    if (year <= recentStart) {
      const oldRange = Math.max(1, recentStart - minYear);
      return Math.round(((year - minYear) / oldRange) * oldWeight * 100);
    }
    const recentRange = Math.max(1, maxYear - recentStart);
    return Math.round((oldWeight + ((year - recentStart) / recentRange) * recentWeight) * 100);
  }

  function positionToYear(position) {
    const ratio = Number(position) / 100;
    if (ratio <= oldWeight) {
      const oldRange = Math.max(1, recentStart - minYear);
      return Math.round(minYear + (ratio / oldWeight) * oldRange);
    }
    const recentRange = Math.max(1, maxYear - recentStart);
    return Math.round(recentStart + ((ratio - oldWeight) / recentWeight) * recentRange);
  }

  const fromPosition = yearToPosition(safeFrom);
  const toPosition = yearToPosition(safeTo);
  const left = fromPosition;
  const right = 100 - toPosition;

  function setFrom(nextValue) {
    const nextFrom = Math.min(positionToYear(nextValue), safeTo);
    onChange({ year_from: String(nextFrom), year_to: String(safeTo) });
  }

  function setTo(nextValue) {
    const nextTo = Math.max(positionToYear(nextValue), safeFrom);
    onChange({ year_from: String(safeFrom), year_to: String(nextTo) });
  }

  return (
    <div className="year-range-control">
      <div className="year-range-head">
        <span>{text.modal.yearFrom}</span>
        <strong>{safeFrom} - {safeTo}</strong>
        <span>{text.modal.yearTo}</span>
      </div>
      <div className="dual-range" style={{ '--range-left': `${left}%`, '--range-right': `${right}%` }}>
        <div className="dual-range-track" />
        <input className="range-from" aria-label={text.modal.yearFrom} type="range" min="0" max="100" value={fromPosition} onChange={(event) => setFrom(event.target.value)} />
        <input className="range-to" aria-label={text.modal.yearTo} type="range" min="0" max="100" value={toPosition} onChange={(event) => setTo(event.target.value)} />
      </div>
    </div>
  );
}

function EmailTokenInput({ value = [], onChange, text }) {
  const emails = Array.isArray(value) ? value : [];
  const inputRef = useRef(null);
  const [draft, setDraft] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const term = draft.trim();
    if (term.length < 1) {
      setSuggestions([]);
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      try {
        const data = await api(`/users/suggest?q=${encodeURIComponent(term)}`);
        const existing = new Set(emails.map((item) => item.toLowerCase()));
        setSuggestions((data.users || []).filter((item) => item.email && !existing.has(item.email.toLowerCase())));
        setOpen(true);
      } catch {
        setSuggestions([]);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [draft, emails.join('|')]);

  function emit(nextEmails) {
    onChange([...new Set(nextEmails.map((item) => item.trim()).filter(Boolean))]);
  }

  function choose(email) {
    if (!email) return;
    emit([...emails, email]);
    setDraft('');
    setOpen(false);
  }

  function commitDraft() {
    const items = splitScopeDraft(draft).flatMap((item) => item.split(/\s+/)).filter(Boolean);
    if (!items.length) return false;
    emit([...emails, ...items]);
    setDraft('');
    setOpen(false);
    return true;
  }

  function focusEmailInput(event) {
    if (event.target.closest?.('button')) return;
    if (event.target !== inputRef.current) {
      event.preventDefault();
    }
    inputRef.current?.focus();
    setOpen(true);
  }

  function stopEmailChipMouseDown(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function removeEmail(event, email) {
    event.preventDefault();
    event.stopPropagation();
    emit(emails.filter((item) => item !== email));
    setDraft('');
    setOpen(false);
  }

  return (
    <div className="scope-combobox email-combobox">
      <div className="scope-token-field" onMouseDown={focusEmailInput}>
        {emails.map((email) => (
          <span className="scope-chip email-chip" key={email}>
            {email}
            <button type="button" aria-label={`Remove ${email}`} onMouseDown={stopEmailChipMouseDown} onClick={(event) => removeEmail(event, email)}><X size={13} /></button>
          </span>
        ))}
        <input
          ref={inputRef}
          placeholder={emails.length ? '' : text.modal.sharePlaceholder}
          value={draft}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => {
            commitDraft();
            setOpen(false);
          }, 120)}
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !draft && emails.length) emit(emails.slice(0, -1));
            if (event.key === 'Enter') {
              event.preventDefault();
              suggestions[0]?.email ? choose(suggestions[0].email) : commitDraft();
            }
          }}
          autoComplete="off"
        />
      </div>
      {open && !!suggestions.length && (
        <div className="scope-suggestions" role="listbox">
          {suggestions.map((item) => (
            <button key={item.id || item.email} type="button" onMouseDown={(event) => {
              event.preventDefault();
              choose(item.email);
            }}>
              <strong>{item.email}</strong>
              <span>{item.confirmed ? 'confirmed' : 'pending'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ShareLibraryModal({ library, onSave, onCancel, busy, text }) {
  const [sharedWith, setSharedWith] = useState(library?.filters_json?.shared_with || []);
  return (
    <div className="modal-backdrop">
      <section className="modal compact" role="dialog" aria-modal="true" aria-labelledby="share-library-title">
        <header>
          <div>
            <h2 id="share-library-title">{text.modal.shareTitle}</h2>
            <p>{text.modal.shareDesc}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onCancel}><X size={18} /></button>
        </header>
        <div className="field-block">
          <span>{library.name}</span>
          <EmailTokenInput value={sharedWith} onChange={setSharedWith} text={text} />
          {!sharedWith.length && <small className="field-hint">{text.modal.shareEmpty}</small>}
        </div>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel}>{text.common.cancel}</button>
          <button className="primary-button" disabled={busy} onClick={() => onSave(sharedWith)}>
            <Users size={17} /> {text.common.save}
          </button>
        </div>
      </section>
    </div>
  );
}

function LibraryModal({ filters, onCreate, onSync, onCancel, busy, text, locale, library, llmSettings }) {
  const currentYear = new Date().getFullYear();
  const defaultYears = { year_from: '2023', year_to: String(currentYear) };
  const recentYears = { year_from: String(Math.max(1950, currentYear - 2)), year_to: String(currentYear) };
  const [form, setForm] = useState({
    name: library?.name || (filters.keyword ? `${filters.keyword} papers` : ''),
    description: library?.description || '',
    mode: 'static',
    ...defaultYears,
    ...filters,
  });
  const [source, setSource] = useState('keyword');
  const [naturalText, setNaturalText] = useState('');
  const [naturalStep, setNaturalStep] = useState('ask');
  const [parsingIntent, setParsingIntent] = useState(false);
  const [previewingIntent, setPreviewingIntent] = useState(false);
  const [naturalPreview, setNaturalPreview] = useState(null);
  const [files, setFiles] = useState([]);
  const namePlaceholder = locale === 'zh' ? text.modal.libraryName : text.modal.libraryName;
  const isPdfSource = !library && source === 'pdf';
  const isNaturalSource = !library && source === 'natural';
  const isEditing = Boolean(library);
  const hasSearchCriteria = Boolean(form.keyword?.trim() || hasScopeFilter(form));
  const canSubmit = isEditing
    ? Boolean(form.name.trim())
    : isPdfSource
    ? Boolean(files.length)
    : isNaturalSource
      ? hasSearchCriteria && naturalStep === 'ready'
      : hasSearchCriteria;

  function buildPayload() {
    return {
      ...form,
      mode: 'static',
      source,
      files,
      rank: rankParam(form),
      ranks: normalizeRanks(form.ranks, form.rank),
      venue: venueParam(form),
      venues: normalizeVenues(form.venues, form.venue),
      name: form.name.trim() || (isPdfSource ? 'PDF papers' : `${(form.keyword || venueParam(form)).trim()} papers`),
      folders: filters.folders || [],
      natural_query: naturalText.trim(),
      smart_search: isNaturalSource && Boolean(naturalPreview?.use_broad_search),
    };
  }

  function buildEditPayload() {
    return {
      name: form.name.trim() || library.name,
      description: form.description || '',
      folders: filters.folders || library?.filters_json?.folders || [],
      filters: {
        ...(library?.filters_json || {}),
        folders: filters.folders || library?.filters_json?.folders || [],
      },
    };
  }

  async function parseNaturalIntent() {
    const query = naturalText.trim();
    if (!query) return;
    setParsingIntent(true);
    try {
      let parsed = null;
      try {
        parsed = await api('/libraries/intent/parse', { method: 'POST', body: { text: query, llm: llmSettings } });
      } catch {
        parsed = null;
      }
      const keyword = parsed?.keyword || query.replace(/[，。,.!?！？]/g, ' ').trim();
      const generatedName = `${query.slice(0, 36)}${query.length > 36 ? '...' : ''} papers`;
      setForm({
        ...form,
        keyword,
        broad_keyword: parsed?.broad_keyword || keyword,
        relevance_criteria: parsed?.relevance_criteria || query,
        ranks: ['A', 'B', 'C'],
        rank: 'A,B,C',
        venues: [],
        venue: '',
        ...recentYears,
        name: generatedName,
      });
      setNaturalStep('scope');
    } finally {
      setParsingIntent(false);
    }
  }

  async function previewNaturalIntent() {
    setPreviewingIntent(true);
    try {
      const preview = await api('/libraries/intent/preview', {
        method: 'POST',
        body: {
          ...form,
          rank: rankParam(form),
          ranks: normalizeRanks(form.ranks, form.rank),
          venue: venueParam(form),
          venues: normalizeVenues(form.venues, form.venue),
          broad_keyword: form.broad_keyword,
        },
      });
      setNaturalPreview(preview);
      setNaturalStep('ready');
    } finally {
      setPreviewingIntent(false);
    }
  }

  function switchSource(nextSource) {
    setSource(nextSource);
    if (nextSource === 'natural') {
      setNaturalStep('ask');
      setNaturalPreview(null);
      setForm((current) => ({ ...current, name: '', keyword: '', rank: '', ranks: [], venue: '', venues: [] }));
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal library-modal" role="dialog" aria-modal="true" aria-labelledby="library-modal-title">
        <header>
          <div>
            <h2 id="library-modal-title">{library ? text.modal.updateLibrary : text.modal.libraryTitle}</h2>
            <p>{library ? (locale === 'zh' ? '修改名称不会重新检索；需要刷新论文时手动点击更新检索。' : 'Renaming does not re-run search. Use refresh search when needed.') : text.modal.libraryDesc}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onCancel}><X size={18} /></button>
        </header>
        {library ? (
          <>
            <label>
              <span>{text.modal.libraryName}</span>
              <input autoFocus placeholder={namePlaceholder} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>
              <span>{locale === 'zh' ? '描述' : 'Description'}</span>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <div className="flow-card library-edit-summary">
              <span>{locale === 'zh' ? '当前检索条件' : 'Current search scope'}</span>
              <strong>{[form.keyword, venueParam(form), rankParam(form), [form.year_from, form.year_to].filter(Boolean).join('-')].filter(Boolean).join(' · ') || (locale === 'zh' ? '未设置检索条件' : 'No search scope')}</strong>
              <small>{locale === 'zh' ? '保存信息只更新库名、描述和文件夹配置，不会重新拉取论文。' : 'Save info only updates metadata and folders; it will not fetch papers.'}</small>
            </div>
            <div className="modal-actions split-actions">
              <button className="secondary-button" onClick={onCancel}>{text.common.cancel}</button>
              <button
                className="secondary-button"
                disabled={busy || !onSync}
                onClick={async () => {
                  await onSync?.(library);
                  onCancel();
                }}
              >
                <RotateCcw size={17} /> {text.modal.updateSearch || text.workbench.sync}
              </button>
              <button
                className="primary-button"
                disabled={busy || !canSubmit}
                onClick={() => onCreate(buildEditPayload())}
              >
                <Check size={17} /> {text.modal.updateMetadata || text.common.save}
              </button>
            </div>
          </>
        ) : (
          <>
        {!library && (
          <div className="segmented source-tabs three-way" aria-label="library source">
            <button type="button" className={source === 'keyword' ? 'active' : ''} onClick={() => switchSource('keyword')}>
              <Search size={15} /> {text.modal.sourceKeyword}
            </button>
            <button type="button" className={source === 'pdf' ? 'active' : ''} onClick={() => switchSource('pdf')}>
              <FileText size={15} /> {text.modal.sourcePdf}
            </button>
            <button type="button" className={source === 'natural' ? 'active' : ''} onClick={() => switchSource('natural')}>
              <Sparkles size={15} /> {text.modal.sourceNatural}
            </button>
          </div>
        )}
        {!isNaturalSource && (
          <label>
            <span>{text.modal.libraryName}</span>
            <input placeholder={namePlaceholder} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
        )}
        {isPdfSource ? (
          <label>
            <span>{text.modal.pdfFiles}</span>
            <input
              type="file"
              multiple
              accept=".pdf,.zip,application/pdf,application/zip"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
            <small className="field-hint">{text.modal.pdfHint}</small>
          </label>
        ) : (
          <>
            {isNaturalSource ? (
              <div className="natural-library-flow">
                <label>
                  <span>{text.modal.naturalPrompt}</span>
                  <textarea placeholder={text.modal.naturalHint} value={naturalText} onChange={(event) => setNaturalText(event.target.value)} />
                </label>
                {naturalStep === 'ask' && (
                  <button className="secondary-button" disabled={busy || parsingIntent || !naturalText.trim()} onClick={parseNaturalIntent}>
                    <Sparkles size={16} /> {parsingIntent ? text.modal.naturalParsing : text.modal.naturalStart}
                  </button>
                )}
                {naturalStep !== 'ask' && (
                  <div className="flow-card">
                    <label>
                      <span className="label-with-help">{text.modal.parsedKeyword}<KeywordHelp text={text} /></span>
                      <input
                        value={form.keyword}
                        onChange={(event) => {
                          setForm((current) => ({ ...current, keyword: event.target.value }));
                          setNaturalPreview(null);
                          if (naturalStep === 'ready') setNaturalStep('years');
                        }}
                      />
                    </label>
                  </div>
                )}
                {naturalStep === 'scope' && (
                  <div className="flow-card">
                    <p>{text.modal.naturalScopeQuestion}</p>
                    <ScopeTokenInput value={form} onChange={(scope) => setForm((current) => ({ ...current, ...scope }))} text={text} />
                    <button className="secondary-button" onClick={() => setNaturalStep('years')}>{text.modal.continue}</button>
                  </div>
                )}
                {naturalStep === 'years' && (
                  <div className="flow-card">
                    <p>{text.modal.naturalYearQuestion}</p>
                    <YearRangeSlider value={form} onChange={(years) => setForm({ ...form, ...years })} text={text} />
                    <button className="secondary-button" disabled={previewingIntent} onClick={previewNaturalIntent}>
                      {previewingIntent ? text.modal.naturalParsing : text.modal.continue}
                    </button>
                  </div>
                )}
                {naturalStep === 'ready' && (
                  <div className="flow-card success">
                    {naturalPreview?.use_broad_search ? (
                      <>
                        <p>{locale === 'zh'
                          ? `精准检索仅找到 ${naturalPreview.strict_count} 篇。创建时将先用下面的宽松条件召回约 ${naturalPreview.broad_count} 篇候选，再并行分析每篇 abstract，只有符合原始需求的论文才会加入库。`
                          : `Strict search found only ${naturalPreview.strict_count}. Creation will retrieve about ${naturalPreview.broad_count} broader candidates, screen every abstract in parallel, and add only relevant papers.`}</p>
                        <label>
                          <span className="label-with-help">{locale === 'zh' ? '宽松检索式' : 'Broad query'}<KeywordHelp text={text} /></span>
                          <input value={form.broad_keyword || ''} onChange={(event) => setForm((current) => ({ ...current, broad_keyword: event.target.value }))} />
                        </label>
                      </>
                    ) : (
                      <p>{locale === 'zh'
                        ? `精准条件可找到 ${naturalPreview?.strict_count || 0} 篇，将直接按精准条件创建论文库。`
                        : `Strict search found ${naturalPreview?.strict_count || 0} papers and will be used directly.`}</p>
                    )}
                    <label>
                      <span>{text.modal.libraryName}</span>
                      <input placeholder={namePlaceholder} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </label>
                  </div>
                )}
              </div>
            ) : (
              <>
                <label>
                  <span className="label-with-help">{text.modal.keyword}<KeywordHelp text={text} /></span>
                  <input placeholder={text.modal.keywordHint} value={form.keyword} onChange={(e) => setForm({ ...form, keyword: e.target.value })} />
                </label>
                <div className="field-block">
                  <span>{text.modal.scope}</span>
                  <ScopeTokenInput value={form} onChange={(scope) => setForm((current) => ({ ...current, ...scope }))} text={text} />
                </div>
                <YearRangeSlider value={form} onChange={(years) => setForm({ ...form, ...years })} text={text} />
              </>
            )}
          </>
        )}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel}>{text.common.cancel}</button>
          <button
            className="primary-button"
            disabled={busy || !canSubmit}
            onClick={() => onCreate(buildPayload())}
          >
            {isPdfSource ? <Upload size={17} /> : <Search size={17} />}
            {library ? text.modal.updateLibrary : isPdfSource ? text.modal.createFromPdf : text.modal.createSearch}
          </button>
        </div>
          </>
        )}
      </section>
    </div>
  );
}

function AddPaperModal({ activeLibrary, onAddPapers, onUploadPdfs, onCancel, busy, text }) {
  const currentYear = new Date().getFullYear();
  const [tab, setTab] = useState('search');
  const [searchForm, setSearchForm] = useState({ keyword: '', venue: '', venues: [], year_from: '2023', year_to: String(currentYear), rank: '', ranks: [] });
  const [results, setResults] = useState([]);
  const [chosen, setChosen] = useState(new Set());
  const [files, setFiles] = useState([]);
  const [searching, setSearching] = useState(false);

  async function runSearch() {
    if (!searchForm.keyword.trim() && !hasScopeFilter(searchForm)) return;
    setSearching(true);
    try {
      const qs = new URLSearchParams({
        ...searchForm,
        venue: venueParam(searchForm),
        venues: venueParam(searchForm),
        rank: rankParam(searchForm),
        page_size: 30,
      });
      const data = await api(`/papers/search?${qs.toString()}`);
      setResults(data.papers || []);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal add-paper-modal" role="dialog" aria-modal="true" aria-labelledby="add-paper-title">
        <header>
          <div>
            <h2 id="add-paper-title">{text.modal.addToLibrary}</h2>
            <p>{activeLibrary.name}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onCancel}><X size={18} /></button>
        </header>
        <div className="segmented source-tabs" aria-label="add paper source">
          <button type="button" className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>
            <Search size={15} /> {text.modal.searchToAdd}
          </button>
          <button type="button" className={tab === 'upload' ? 'active' : ''} onClick={() => setTab('upload')}>
            <Upload size={15} /> {text.modal.uploadToAdd}
          </button>
        </div>
        {tab === 'search' ? (
          <>
            <div className="add-search-grid">
              <label>
                <span className="label-with-help">{text.modal.keyword}<KeywordHelp text={text} /></span>
                <input autoFocus placeholder={text.modal.keywordHint} value={searchForm.keyword} onChange={(e) => setSearchForm({ ...searchForm, keyword: e.target.value })} onKeyDown={(event) => {
                  if (event.key === 'Enter') runSearch();
                }} />
              </label>
              <div className="field-block">
                <span>{text.modal.scope}</span>
                <ScopeTokenInput value={searchForm} onChange={(scope) => setSearchForm((current) => ({ ...current, ...scope }))} text={text} onEnter={runSearch} />
              </div>
              <YearRangeSlider value={searchForm} onChange={(years) => setSearchForm({ ...searchForm, ...years })} text={text} />
            </div>
            <button className="secondary-button" disabled={searching || (!searchForm.keyword.trim() && !hasScopeFilter(searchForm))} onClick={runSearch}>
              <Search size={17} /> {text.common.search}
            </button>
            <div className="search-result-list" aria-label={text.modal.searchResults}>
              {results.map((paper) => (
                <label className="search-result-item" key={paper.id}>
                  <input
                    type="checkbox"
                    checked={chosen.has(paper.id)}
                    onChange={(event) => {
                      const next = new Set(chosen);
                      event.target.checked ? next.add(paper.id) : next.delete(paper.id);
                      setChosen(next);
                    }}
                  />
                  <span>
                    <strong>{paper.title}</strong>
                    <small>{[paper.pub_year, paper.venue_abbr || paper.venue_name, paper.rank ? `CCF ${paper.rank}` : ''].filter(Boolean).join(' · ')}</small>
                  </span>
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={onCancel}>{text.common.cancel}</button>
              <button className="primary-button" disabled={busy || !chosen.size} onClick={() => onAddPapers([...chosen])}>
                <Plus size={17} /> {text.modal.addSelected}
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="file-drop">
              <FileUp size={22} />
              <span>{text.table.uploadPdfZip}</span>
              <small>{text.modal.pdfHint}</small>
              <input type="file" multiple accept=".pdf,.zip,application/pdf,application/zip" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
            </label>
            {!!files.length && <p className="file-count">{files.length} {text.modal.pdfFiles}</p>}
            <div className="modal-actions">
              <button className="secondary-button" onClick={onCancel}>{text.common.cancel}</button>
              <button className="primary-button" disabled={busy || !files.length} onClick={() => onUploadPdfs(files)}>
                <Upload size={17} /> {text.modal.uploadToAdd}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function PaperDetailsModal({ text, paper, abstractValue, setAbstractValue, onSaveAbstract, onUploadPdf, onClose, busy }) {
  const venue = displayVenue(paper);
  const currentAbstract = displayPaperAbstract(paper);
  const abstractChanged = abstractValue.trim() !== currentAbstract.trim();
  return (
    <div className="modal-backdrop light">
      <section className="modal paper-details-modal" role="dialog" aria-modal="true" aria-labelledby="paper-details-title">
        <header>
          <div>
            <h2 id="paper-details-title">{text.table.details}</h2>
            <p>{text.table.detailsReadonly}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onClose}><X size={18} /></button>
        </header>
        <div className="paper-details-readonly">
          <label>
            <span>{text.table.paper}</span>
            <strong>{displayPaperTitle(paper)}</strong>
          </label>
          <label>
            <span>{text.table.year}</span>
            <strong>{paper.pub_year || '-'}</strong>
          </label>
          <label>
            <span>{text.table.venue}</span>
            <strong title={venue.title}>{venue.label}</strong>
          </label>
          <label>
            <span>{text.table.rank}</span>
            <strong>{paper.rank || '-'}</strong>
          </label>
          <label className="wide">
            <span>{text.table.authors}</span>
            <strong>{formatAuthors(paper.authors) || '-'}</strong>
          </label>
        </div>
        <label className="paper-details-abstract">
          <span>{text.table.abstract}</span>
          <textarea
            value={abstractValue}
            placeholder={text.table.abstractPlaceholder}
            onChange={(event) => setAbstractValue(event.target.value)}
          />
        </label>
        <div className="paper-details-pdf-row">
          <span>{text.table.pdf}</span>
          <div>
            {paper.pdf_url ? (
              <small>{text.table.uploadedPdf}</small>
            ) : (
              <small>{text.table.noPdf}</small>
            )}
            <label className="secondary-button">
              <Upload size={15} /> {text.table.uploadPdf}
              <input
                type="file"
                accept="application/pdf"
                onChange={(event) => {
                  onUploadPdf(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </label>
          </div>
        </div>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>{text.common.cancel}</button>
          <button className="primary-button" disabled={busy || !abstractChanged} onClick={onSaveAbstract}>{text.common.save}</button>
        </div>
      </section>
    </div>
  );
}

function RenamePaperModal({ text, paper, title, setTitle, onCancel, onSave, busy }) {
  const unchanged = title.trim() === displayPaperTitle(paper).trim();
  return (
    <div className="modal-backdrop light">
      <section className="modal rename-paper-modal" role="dialog" aria-modal="true" aria-labelledby="rename-paper-title">
        <header>
          <div>
            <h2 id="rename-paper-title">{text.table.renamePaper}</h2>
            <p>{text.table.renamePaperDesc}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onCancel}><X size={18} /></button>
        </header>
        <label>
          <span>{text.table.paper}</span>
          <textarea autoFocus value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel}>{text.common.cancel}</button>
          <button className="primary-button" disabled={busy || !title.trim() || unchanged} onClick={onSave}>
            {text.common.save}
          </button>
        </div>
      </section>
    </div>
  );
}

function PdfMismatchModal({ text, check, onCancel, onConfirm, busy }) {
  const paper = check.paper || {};
  const pdf = check.pdf || {};
  return (
    <div className="modal-backdrop light">
      <section className="modal pdf-mismatch-modal" role="dialog" aria-modal="true" aria-labelledby="pdf-mismatch-title">
        <header>
          <div>
            <h2 id="pdf-mismatch-title">{text.table.confirmPdfUpload}</h2>
            <p>{text.table.confirmPdfUploadDesc}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onCancel}><X size={18} /></button>
        </header>
        <div className="pdf-match-score">
          {text.table.similarity}: {Math.round((check.score || 0) * 100)}%
        </div>
        <div className="pdf-diff-grid">
          <article>
            <strong>{text.table.currentPaper}</strong>
            <h3>{paper.title || '-'}</h3>
            <p>{formatAuthors(paper.authors)}</p>
            <small>{[paper.pub_year, paper.venue].filter(Boolean).join(' · ') || '-'}</small>
          </article>
          <article>
            <strong>{text.table.uploadedPdf}</strong>
            <h3>{pdf.title || '-'}</h3>
            <p>{pdf.authors || '-'}</p>
            <small>{[pdf.pub_year, pdf.url].filter(Boolean).join(' · ') || '-'}</small>
          </article>
        </div>
        {!!pdf.candidates?.length && (
          <div className="pdf-candidates">
            {pdf.candidates.map((candidate) => <span key={candidate}>{candidate}</span>)}
          </div>
        )}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel}>{text.common.cancel}</button>
          <button className="primary-button" disabled={busy} onClick={onConfirm}>
            <Upload size={17} /> {text.table.storeAnyway}
          </button>
        </div>
      </section>
    </div>
  );
}

function AssociatePaperModal({ paper, onAssociate, onCancel, busy, text }) {
  const [keyword, setKeyword] = useState(paper.title || '');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  async function runSearch() {
    if (!keyword.trim()) return;
    setSearching(true);
    try {
      const qs = new URLSearchParams({ keyword, page_size: 20 });
      const data = await api(`/papers/search?${qs.toString()}`);
      setResults((data.papers || []).filter((item) => item.id !== paper.id && !String(item.dblp_key || '').startsWith('upload/')));
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal associate-modal" role="dialog" aria-modal="true" aria-labelledby="associate-title">
        <header>
          <div>
            <h2 id="associate-title">{text.modal.associateTitle}</h2>
            <p>{text.modal.associateDesc}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onCancel}><X size={18} /></button>
        </header>
        <label>
          <span>{text.modal.keyword}</span>
          <input
            autoFocus
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') runSearch();
            }}
          />
        </label>
        <button className="secondary-button" disabled={searching || !keyword.trim()} onClick={runSearch}>
          <Search size={17} /> {text.common.search}
        </button>
        <div className="search-result-list">
          {results.map((item) => (
            <article className="associate-result-item" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <small>{[item.pub_year, item.venue_abbr || item.venue_name, item.rank ? `CCF ${item.rank}` : ''].filter(Boolean).join(' · ')}</small>
              </div>
              <button className="primary-button" disabled={busy} onClick={() => onAssociate(item.id)}>
                <Check size={17} /> {text.modal.associateToPaper}
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function TagModal({ tag: initialTag, onCreate, onCancel, text }) {
  const [tag, setTag] = useState(initialTag || { name: '', description: '', auto_folder: false });
  return (
    <div className="modal-backdrop">
      <section className="modal compact" role="dialog" aria-modal="true" aria-labelledby="tag-modal-title">
        <header>
          <div>
            <h2 id="tag-modal-title">{initialTag ? text.modal.tagTitleEdit : text.modal.tagTitleAdd}</h2>
            <p>{text.modal.tagDesc}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onCancel}><X size={18} /></button>
        </header>
        <label>
          <span>{text.table.tagColumn}</span>
          <input placeholder={text.modal.tagName} value={tag.name} onChange={(e) => setTag({ ...tag, name: e.target.value })} />
        </label>
        <label>
          <span>Description</span>
          <textarea placeholder={text.modal.tagPrompt} value={tag.description} onChange={(e) => setTag({ ...tag, description: e.target.value })} />
        </label>
        <label className="tag-auto-folder-toggle">
          <input type="checkbox" checked={Boolean(tag.auto_folder)} onChange={(e) => setTag({ ...tag, auto_folder: e.target.checked })} />
          <span>
            <strong>{text.modal.autoFolder}</strong>
            <small>{text.modal.autoFolderHint}</small>
          </span>
        </label>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel}>{text.common.cancel}</button>
          <button className="primary-button" disabled={!tag.name.trim()} onClick={() => onCreate({ ...tag, name: tag.name.trim() })}>
            <Plus size={17} /> {initialTag ? text.common.save : text.common.add}
          </button>
        </div>
      </section>
    </div>
  );
}

function FolderModal({ library, parentFolder, onCreate, onCancel, text }) {
  const [folderName, setFolderName] = useState('');
  return (
    <div className="modal-backdrop">
      <section className="modal compact" role="dialog" aria-modal="true" aria-labelledby="folder-modal-title">
        <header>
          <div>
            <h2 id="folder-modal-title">{parentFolder ? text.modal.addChildFolder : text.modal.addFolder}</h2>
            <p>{parentFolder || library.name}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onCancel}><X size={18} /></button>
        </header>
        <label>
          <span>{text.modal.folders}</span>
          <input
            autoFocus
            placeholder={text.modal.folderName}
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onCreate(folderName);
            }}
          />
        </label>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel}>{text.common.cancel}</button>
          <button className="primary-button" disabled={!folderName.trim()} onClick={() => onCreate(folderName)}>
            <Plus size={17} /> {text.common.add}
          </button>
        </div>
      </section>
    </div>
  );
}

function TagFilterMenu({ definitions, activeTag, onSelect, onAdd, onEdit, text }) {
  return (
    <div className="tag-menu">
      <button className={activeTag ? '' : 'active'} onClick={() => onSelect('')}>{text.table.allTags}</button>
      {definitions.length === 0 && <p>{text.table.noTags}</p>}
      {definitions.map((tag) => (
        <div className="tag-menu-row" key={tag.name}>
          <button className={activeTag === tag.name ? 'active' : ''} onClick={() => onSelect(tag.name)}>
            <span>{tag.name}</span>
            <small>{tag.description}</small>
          </button>
          <button className="tag-edit-button" title={text.table.editTag} aria-label={text.table.editTag} onClick={() => onEdit(tag)}><Pencil size={13} /></button>
        </div>
      ))}
      <button onClick={onAdd}><Plus size={14} /> {text.table.addTag}</button>
    </div>
  );
}

function TagCheckboxes({ paper, definitions, onApply, text }) {
  const selectedTags = paper.tags_json || [];

  function toggleTag(tagName, checked) {
    const next = checked
      ? [...new Set([...selectedTags, tagName])]
      : selectedTags.filter((item) => item !== tagName);
    onApply(next);
  }

  if (!definitions.length) {
    return (
      <span className="tag-inline-empty">{text.table.noTagDefinitions}</span>
    );
  }

  return (
    <div className="tag-checkboxes">
      {definitions.map((tag) => (
        <label key={tag.name}>
          <input
            type="checkbox"
            checked={selectedTags.includes(tag.name)}
            onChange={(event) => toggleTag(tag.name, event.target.checked)}
          />
          <span>{tag.name}</span>
        </label>
      ))}
    </div>
  );
}

function TagMenu({ paper, definitions, onApply, onAdd, onEdit, text }) {
  const [selectedTags, setSelectedTags] = useState(paper.tags_json || []);
  function toggleTag(tagName, checked) {
    const next = checked
      ? [...new Set([...selectedTags, tagName])]
      : selectedTags.filter((item) => item !== tagName);
    setSelectedTags(next);
    onApply(next);
  }
  return (
    <div className="tag-menu">
      {definitions.length === 0 && <p>{text.table.noTags}</p>}
      {definitions.map((tag) => (
        <label key={tag.name}>
          <input
            type="checkbox"
            checked={selectedTags.includes(tag.name)}
            onChange={(e) => toggleTag(tag.name, e.target.checked)}
          />
          <span>{tag.name}</span>
          <small>{tag.description}</small>
          <button type="button" className="tag-edit-button" title={text.table.editTag} aria-label={text.table.editTag} onClick={() => onEdit(tag)}><Pencil size={13} /></button>
        </label>
      ))}
      <button onClick={onAdd}><Plus size={14} /> {text.table.addTag}</button>
    </div>
  );
}

function formatAuthors(authors) {
  if (!authors) return '';
  if (Array.isArray(authors)) return authors.slice(0, 4).join(', ');
  if (typeof authors === 'string') return authors;
  return '';
}

createRoot(document.getElementById('root')).render(<App />);

import { displayPaperAbstract, displayPaperTitle, displayVenue } from './papers.js';
import { citationMarker, makeCitationId } from './citations.js';

function compactText(value, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

function markdownFileNameFromPrompt(prompt, fallback = 'draft') {
  const cleaned = compactText(prompt, fallback)
    .replace(/[\\/:*?"<>|#`[\]{}]/g, '')
    .slice(0, 34)
    .trim();
  const base = cleaned || fallback;
  return `${base}${/\.md$/i.test(base) ? '' : '.md'}`;
}

function selectedChatPaperIds({ selectedAll, selectedIds, pdfViewer }) {
  if (selectedAll) return [];
  if (selectedIds.length) return selectedIds;
  return pdfViewer?.paperId ? [pdfViewer.paperId] : [];
}

function isCreativeWritingTask(message) {
  return /(生成|撰写|写一篇|写成|起草|草稿|创作|续写|改写|综述草稿|文献综述|draft|write|generate|compose|create)/i.test(message);
}

function isPlanningWritingTask(message) {
  return /(规划|编排|写作流程|一步步|大纲|outline|plan|proposal|综述计划|论文写作|怎么写|帮我写论文)/i.test(message);
}

function targetVenueFromPrompt(message) {
  const match = String(message || '').match(/(?:投|投稿|target|venue|conference|journal|期刊|会议)[^\w\u4e00-\u9fa5]{0,6}([A-Za-z][A-Za-z0-9 .&-]{1,24})/i);
  return compactText(match?.[1] || '').replace(/[，。,.].*$/, '').trim();
}

function inferWritingDomain(prompt, library) {
  const source = compactText(`${prompt} ${library?.name || ''} ${library?.description || ''}`).toLowerCase();
  const candidates = [
    ['agent', '智能体 / Agent 系统'],
    ['stock', '金融投资组合 / 股票预测'],
    ['portfolio', '金融投资组合 / 股票预测'],
    ['federated', '联邦学习'],
    ['graph', '图学习'],
    ['llm', '大模型应用'],
    ['multimodal', '多模态学习'],
    ['recommend', '推荐系统'],
    ['security', '安全与隐私'],
  ];
  return candidates.find(([key]) => source.includes(key))?.[1] || compactText(library?.name, '当前论文库主题');
}

function scoreReferencePaper(paper, prompt, targetVenue) {
  const haystack = compactText(`${displayPaperTitle(paper)} ${displayVenue(paper).label} ${displayPaperAbstract(paper)}`).toLowerCase();
  const terms = compactText(prompt)
    .toLowerCase()
    .split(/[\s,，。.;；:：()（）]+/)
    .filter((item) => item.length >= 3)
    .slice(0, 16);
  const venue = compactText(displayVenue(paper).label).toLowerCase();
  let score = 0;
  terms.forEach((term) => {
    if (haystack.includes(term)) score += 2;
  });
  if (targetVenue && venue.includes(targetVenue.toLowerCase())) score += 14;
  if (paper.pdf_url) score += 3;
  if (paper.rank && paper.rank !== '-') score += 1;
  if (paper.pub_year) score += Math.max(0, Number(paper.pub_year) - 2018) * 0.08;
  return score;
}

function chooseReferencePapers(papers, prompt, targetVenue, limit = 8) {
  return [...(papers || [])]
    .map((paper) => ({ paper, score: scoreReferencePaper(paper, prompt, targetVenue) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ paper }) => paper);
}

function buildOutlineMarkdown({ prompt, library, domain, references, citationStyle }) {
  const refLines = (references || []).map((paper, index) => (
    `- P${index + 1}. ${displayPaperTitle(paper)} (${displayVenue(paper).label}, ${paper.pub_year || 'n.d.'}) ${citationMarker(makeCitationId({ paperId: paper.id }))}`
  )).join('\n') || '- 暂无参考论文，先由 AI 根据主题生成结构。';
  return `# 写作大纲

> 需求：${compactText(prompt)}
> 领域：${domain}
> 目标论文库：${library?.name || '当前论文库'}
> 引用：统一使用 [[ref:id]]，导出时再选择 APA/MLA/LaTeX 等格式。

## 参考论文

${refLines}

## 文章结构

1. 引言：说明问题背景、研究动机、现有工作的不足，以及本文希望回答的问题。
2. 相关工作：按主题归纳参考论文的方法脉络，突出同一领域下的共性任务、数据与评价方式。
3. 方法或系统设计：描述核心思路、关键模块、输入输出、训练或推理流程。
4. 实验设置：列出数据集、基线、指标、消融实验与实现细节。
5. 结果分析：比较主要结果，解释提升来源，并分析失败案例或适用边界。
6. 讨论：总结局限、伦理风险、可复现性以及未来扩展方向。
7. 结论：回到研究问题，压缩概括贡献与后续工作。
`;
}

function buildMainDraftPrompt({ prompt, domain, references, outline, citationStyle }) {
  const refs = (references || []).map((paper, index) => (
    `P${index + 1}: ${displayPaperTitle(paper)} | ${displayVenue(paper).label} | ${paper.pub_year || ''} | marker: ${citationMarker(makeCitationId({ paperId: paper.id }))} | PDF: ${paper.pdf_url ? 'yes' : 'no'}`
  )).join('\n');
  return [
    '请直接输出 Markdown 正文，不要寒暄，不要解释你正在做什么。',
    '任务：根据写作需求、大纲和参考论文，生成可继续编辑的学术 Markdown 主文档。',
    `写作需求：${prompt}`,
    `领域：${domain}`,
    '引用格式：正文只使用提供的 [[ref:id]] marker，最终导出时再选择 APA/MLA/LaTeX 等格式。',
    'Markdown 格式要求：数学公式必须使用 `$...$` 或 `$$...$$`，不要用普通括号包裹 LaTeX，例如不要写 `(J(\\theta))`。',
    `参考论文：\n${refs || '暂无明确参考论文'}`,
    `大纲：\n${outline}`,
    '要求：每一节都写出具体内容；引用时只能复制参考论文行里提供的 marker，不要自行编造引用；如果某处需要用户补充 PDF，请在文中写 TODO: 上传对应 PDF 后补证据。',
  ].join('\n\n');
}

function buildCreativeDraftPrompt(message, fileName, references = []) {
  const refs = (references || []).map((paper, index) => (
    `P${index + 1}: ${displayPaperTitle(paper)} | marker: ${citationMarker(makeCitationId({ paperId: paper.id }))}`
  )).join('\n');
  return [
    '请直接输出 Markdown 文件正文，不要寒暄，不要解释你正在做什么。',
    `文件名：${fileName}`,
    `用户需求：${message}`,
    refs ? `可用参考论文：\n${refs}` : '当前没有显式选中的参考论文。',
    '如果需要引用当前论文库证据，只能复制上面提供的 [[ref:id]] marker，并保持段落适合后续继续编辑。',
    'Markdown 格式要求：数学公式必须使用 `$...$` 或 `$$...$$`，不要用普通括号包裹 LaTeX，例如不要写 `(J(\\theta))`。',
  ].join('\n\n');
}

export {
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
};

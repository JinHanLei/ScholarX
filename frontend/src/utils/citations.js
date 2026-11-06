import { displayPaperAbstract, displayPaperTitle, displayVenue } from './papers.js';

const CITATION_GROUP_RE = /\[\[([\s\S]*?)\]\]/g;
const CITATION_REF_RE = /ref:([^\]\s,;]+)/g;

function makeCitationId({ paperId, chunkId } = {}) {
  const paperPart = String(paperId || '').replace(/^p/i, '');
  if (!paperPart) return '';
  const chunkPart = chunkId === undefined || chunkId === null || chunkId === ''
    ? ''
    : `:c${String(chunkId).replace(/^c/i, '')}`;
  return `p${paperPart}${chunkPart}`;
}

function citationMarker(refId) {
  return refId ? `[[ref:${refId}]]` : '';
}

function parseCitationId(refId) {
  const raw = String(refId || '').trim();
  const match = raw.match(/^p?(\d+)(?::?c(?:hunk)?(\d+))?$/i);
  if (!match) return { refId: raw, paperId: null, chunkId: null };
  return {
    refId: raw,
    paperId: Number(match[1]),
    chunkId: match[2] === undefined ? null : Number(match[2]),
  };
}

function paperCitationSource(paper, extra = {}) {
  if (!paper) return null;
  const refId = extra.refId || makeCitationId({ paperId: paper.id, chunkId: extra.chunkId });
  return {
    refId,
    paperId: paper.id,
    chunkId: extra.chunkId ?? null,
    page: extra.page ?? extra.pageNumber ?? null,
    title: displayPaperTitle(paper),
    year: paper.pub_year || paper.year || '',
    venue: displayVenue(paper).label,
    chunkText: extra.chunkText || extra.text || '',
    pdfUrl: paper.pdf_url || extra.pdf_url || '',
    abstract: displayPaperAbstract(paper),
  };
}

function buildCitationSourceMap({ papers = [], paperRefs = [], evidence = [] } = {}) {
  const sources = {};
  (papers || []).forEach((paper) => {
    const source = paperCitationSource(paper);
    if (source?.refId) sources[source.refId] = source;
  });
  (paperRefs || []).forEach((paperRef) => {
    const paperId = paperRef.paper_id || paperRef.paperId || paperRef.id;
    const refId = paperRef.ref_id || paperRef.refId || makeCitationId({ paperId });
    if (!refId) return;
    sources[refId] = {
      refId,
      paperId,
      chunkId: null,
      title: paperRef.title || paperRef.name || '引用文献',
      year: paperRef.year || paperRef.pub_year || '',
      venue: paperRef.venue || paperRef.venue_abbr || '',
      chunkText: '',
      pdfUrl: paperRef.pdf_url || '',
    };
    if (paperRef.ref && paperRef.ref !== refId) {
      sources[paperRef.ref] = { ...sources[refId], refId: paperRef.ref };
    }
  });
  (evidence || []).forEach((item) => {
    const paperId = item.paper_id || item.paperId || item.id;
    const chunkId = item.chunk_id ?? item.chunkId ?? item.chunk_no ?? item.chunkNo;
    const refId = item.ref_id || item.refId || makeCitationId({ paperId, chunkId });
    if (!refId) return;
    sources[refId] = {
      ...(sources[refId] || {}),
      refId,
      paperId,
      chunkId,
      page: item.page || item.page_number || item.pageNumber || null,
      title: item.title || sources[refId]?.title || '引用文献',
      year: item.year || item.pub_year || sources[refId]?.year || '',
      venue: item.venue || item.venue_abbr || sources[refId]?.venue || '',
      chunkText: item.text || item.snippet || item.chunk || '',
      pdfUrl: item.pdf_url || sources[refId]?.pdfUrl || '',
    };
  });
  return sources;
}

function splitCitationMarkers(text) {
  const value = String(text || '');
  const parts = [];
  let cursor = 0;
  for (const match of value.matchAll(CITATION_GROUP_RE)) {
    const groupText = match[1] || '';
    if (!groupText.includes('ref:')) continue;
    const refs = [...groupText.matchAll(CITATION_REF_RE)]
      .map((item) => String(item[1] || '').trim())
      .filter(Boolean);
    if (!refs.length) continue;
    if (match.index > cursor) {
      parts.push({ type: 'text', text: value.slice(cursor, match.index) });
    }
    refs.forEach((refId) => parts.push({ type: 'citation', refId }));
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) parts.push({ type: 'text', text: value.slice(cursor) });
  return parts;
}

function textHasCitationMarkers(text) {
  CITATION_GROUP_RE.lastIndex = 0;
  return [...String(text || '').matchAll(CITATION_GROUP_RE)].some((match) => String(match[1] || '').includes('ref:'));
}

export {
  buildCitationSourceMap,
  citationMarker,
  makeCitationId,
  parseCitationId,
  paperCitationSource,
  splitCitationMarkers,
  textHasCitationMarkers,
};

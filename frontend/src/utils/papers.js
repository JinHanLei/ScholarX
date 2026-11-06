const ROOT_FOLDER_MARKER = '__root__';

function normalizeFolderPath(path) {
  return String(path || '')
    .split('/')
    .map((item) => item.trim())
    .filter(Boolean)
    .join('/');
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
      if (!byPath.has(currentPath)) {
        const node = { path: currentPath, name: parts[index], children: [] };
        byPath.set(currentPath, node);
        const parentPath = parts.slice(0, index).join('/');
        if (parentPath) byPath.get(parentPath).children.push(node);
        else roots.push(node);
      }
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
  const metadata = paperMetadata(paper);
  const manualVenue = metadata.manual_venue || '';
  const main = manualVenue || paper?.main_venue_abbr || paper?.venue_abbr || paper?.main_venue_name || '';
  const detail = manualVenue || paper?.venue_name || paper?.venue_abbr || paper?.main_venue_name || main;
  return {
    label: main || detail || '-',
    title: detail && detail !== main ? detail : manualVenue ? manualVenue : '',
  };
}

function displayPaperAbstract(paper) {
  return String(paper?.abstract || '').replace(/\s+/g, ' ').trim();
}

function formatAuthors(authors) {
  if (!authors) return '';
  if (Array.isArray(authors)) return authors.slice(0, 4).join(', ');
  if (typeof authors === 'string') return authors;
  return '';
}

export {
  ROOT_FOLDER_MARKER,
  buildFolderTree,
  displayPaperAbstract,
  displayPaperTitle,
  displayVenue,
  folderAncestors,
  folderLeaf,
  folderMarker,
  formatDateOnly,
  formatAuthors,
  isUnmatchedUploadedPaper,
  normalizeFolderPath,
  paperFolderMarkers,
  paperMetadata,
};

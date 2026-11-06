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

export {
  emptyFilters,
  emptyTableFilters,
  hasScopeFilter,
  normalizeRanks,
  normalizeTableSorts,
  normalizeVenues,
  parseRankToken,
  primaryTableSort,
  rankParam,
  serializeTableSorts,
  splitScopeDraft,
  toggleTableSort,
  venueParam,
};

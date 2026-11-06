export function articleUrl(paper) {
  const doi = paper.doi?.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  for (const value of [paper.url, paper.metadata?.source_url, paper.metadata?.url, doi && 'https://doi.org/' + doi, paper.dblp_url]) {
    try { const url = new URL(value); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href; } catch { /* Missing or invalid source. */ }
  }
  return '';
}

export function cycleSort(sorts, field) {
  const current = sorts.find((item) => item.field === field);
  if (!current) return [...sorts, { field, direction: 'asc' }];
  if (current.direction === 'asc') return sorts.map((item) => item.field === field ? { ...item, direction: 'desc' } : item);
  return sorts.filter((item) => item.field !== field);
}

export function samePaper(a, b) {
  if (a.id === b.id) return true;
  if (a.doi && b.doi && a.doi.toLowerCase() === b.doi.toLowerCase()) return true;
  return a.title.trim().toLowerCase() === b.title.trim().toLowerCase() && a.year === b.year;
}

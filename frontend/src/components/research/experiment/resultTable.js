export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
export const label = (value) => typeof value === 'string' ? value : value == null ? '未标注' : JSON.stringify(value);
export const number = (value) => typeof value === 'number' && Number.isFinite(value) ? String(Number(value.toPrecision(6))) : '—';
export const metricId = (metric) => canonical([metric.label, metric.unit || '', metric.direction || '']);
export const STATUS = { registered: '待运行', queued: '排队中', running: '运行中', completed: '已完成', failed: '失败', cancelled: '已停止', interrupted: '已中断', imported: '历史设计', blocked: '待补充', waiting_approval: '等待授权', snapshotting: '固定源码', implementing: '更新实现', validating: '校验中', summarizing: '汇总中' };

export function defaultVersion(data) {
  const completed = data.rows.filter((r) => r.role === 'ours' && !r.test_data && r.metrics.some((m) => m.value != null));
  return data.versions.find((v) => completed.some((r) => r.version_ids.includes(v.id)))?.id
    || (completed.some((r) => !r.version_ids.length) ? 'legacy' : data.versions[0]?.id || 'legacy');
}

export function resultGroups(rows, version, dataset = '', includeTest = false) {
  const groups = new Map();
  for (const row of rows) {
    if ((!includeTest && row.test_data) || (dataset && canonical(row.dataset) !== dataset)) continue;
    if (row.role === 'ours' && (version === 'legacy' ? row.version_ids.length > 0 : !row.version_ids.includes(version))) continue;
    const key = canonical([row.dataset, row.split, row.protocol, row.scope, row.test_data]);
    if (!groups.has(key)) groups.set(key, { key, dataset: row.dataset, split: row.split, protocol: row.protocol, scope: row.scope, test_data: row.test_data, rows: [], metrics: [] });
    const group = groups.get(key); group.rows.push(row);
    for (const metric of row.metrics) if (!group.metrics.some((m) => metricId(m) === metricId(metric))) group.metrics.push(metric);
  }
  return [...groups.values()].map((g) => ({ ...g, rows: g.rows.sort((a, b) => ({ baseline: 0, ours: 1, unclassified: 2 })[a.role] - ({ baseline: 0, ours: 1, unclassified: 2 })[b.role]) }));
}

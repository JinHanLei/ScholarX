import test from 'node:test';
import assert from 'node:assert/strict';
import { resultGroups, defaultVersion, number, metricId } from '../src/components/research/experiment/resultTable.js';

const row = (id, role, version = [], extra = {}) => ({ id, run_id: id, method: id, role, version_ids: version, dataset: 'A', split: { test: '2019', train: '2016' }, protocol: { id: 'fixed', seed: 42 }, scope: 'test', seed: 1, test_data: false, metrics: [{ label: 'IC', unit: '', direction: 'higher', source: 'ic', value: 0 }], ...extra });
test('switching Ours versions retains baselines without relabelling historical runs', () => {
  const rows = [row('b', 'baseline'), row('v1', 'ours', ['1']), row('v2', 'ours', ['2']), row('old', 'ours')];
  assert.deepEqual(resultGroups(rows, '2')[0].rows.map((r) => r.id), ['b', 'v2']);
  assert.deepEqual(resultGroups(rows, 'legacy')[0].rows.map((r) => r.id), ['b', 'old']);
  assert.equal(defaultVersion({ rows, versions: [{ id: '2' }, { id: '1' }] }), '2');
});
test('dataset, split, protocol, evaluation scope and test fixtures never mix', () => {
  const rows = [row('a', 'baseline'), row('same', 'ours', ['2'], { split: { train: '2016', test: '2019' } }), row('dataset', 'baseline', [], { dataset: 'B' }), row('split', 'baseline', [], { split: 'other' }), row('protocol', 'baseline', [], { protocol: 'other' }), row('scope', 'baseline', [], { scope: 'validation' }), row('fixture', 'baseline', [], { test_data: true })];
  assert.equal(resultGroups(rows, '2').length, 5);
  assert.equal(resultGroups(rows, '2', '', true).length, 6);
  assert.equal(resultGroups(rows, '2')[0].rows.length, 2);
});
test('individual seeds and zero/negative metrics remain intact without aggregation or best-run selection', () => {
  const rows = [row('seed1', 'ours', ['2']), row('seed2', 'ours', ['2'], { seed: 2 })];
  assert.equal(resultGroups(rows, '2')[0].rows.length, 2);
  assert.equal(number(0), '0'); assert.equal(number(-.01234), '-0.01234'); assert.equal(number(null), '—');
  assert.notEqual(metricId({ label: 'Score', unit: '%' }), metricId({ label: 'Score', unit: '' }));
});

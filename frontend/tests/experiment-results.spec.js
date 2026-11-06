import { test, expect } from '@playwright/test';
let fixture;
test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/testing/experiment-results-fixture');
  test.skip(response.status() === 404, 'Start backend/scripts/serve_experiment_ui_test.py for isolated result fixtures.');
  expect(response.ok()).toBeTruthy();
  fixture = await response.json();
});

async function open(page) {
  await page.addInitScript((id) => { localStorage.setItem('easyref.project', id); localStorage.setItem('easyref.workspace', 'Experiment'); }, fixture.project);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '实验结果', exact: true })).toBeVisible();
}

test('results are central, Ours versions switch independently and datasets remain separate', async ({ page, request }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); const executions = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /\/(start|retry|versions)$/.test(r.url())) executions.push(r.url()); });
  await open(page);
  await expect(page.getByLabel('Ours 版本')).toHaveValue(fixture.v2);
  const first = page.locator('.experiment-result-group').filter({ has: page.getByRole('heading', { name: 'Dataset A · TEST DATA', exact: true }) });
  await expect(first).toContainText('Reference method'); await expect(first).toContainText('0.85');
  await expect(first).toContainText('0.8'); await expect(first).not.toContainText('0.82');
  await expect(page.locator('.experiment-result-group')).toHaveCount(2);
  await expect(page.locator('.experiment-results')).not.toContainText('999');
  await page.getByLabel('结果数据集').selectOption({ label: 'Dataset A · TEST DATA' });
  await expect(page.locator('.experiment-result-group')).toHaveCount(1);
  await expect(page.getByLabel('实验运行与记录')).not.toContainText('Other dataset fixture');
  await page.getByLabel('结果数据集').selectOption('');
  await page.getByLabel('Ours 版本').selectOption(fixture.v1);
  await expect(first).toContainText('0.82'); await expect(first).not.toContainText('0.85');
  await expect(first).toContainText('0.8'); await expect(page.locator('.experiment-result-group')).toHaveCount(1);
  await page.getByLabel('Ours 版本').selectOption('legacy');
  await expect(first).toContainText('此版本在该评估设置下暂无结果');
  await page.getByLabel('Ours 版本').selectOption(fixture.v2);
  await page.screenshot({ path: 'test-results/experiment-results-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 744, height: 892 });
  await page.screenshot({ path: 'test-results/experiment-results-narrow.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  expect(executions).toEqual([]); expect(errors).toEqual([]);
  expect((await (await request.get(`/api/projects/${fixture.project}/idea-versions`)).json()).versions).toHaveLength(2);
});

test('a result opens parameters and a persistent observation with the true metric snapshot', async ({ page, request }) => {
  await open(page);
  await page.getByRole('button', { name: '0.85', exact: true }).click();
  const inspector = page.getByLabel('运行详情');
  await expect(inspector).toContainText('batch_size'); await expect(inspector).toContainText('64');
  const note = `TEST observation ${Date.now()}`;
  await page.getByLabel('新增实验记录').fill(note); await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(inspector).toContainText(note);
  const overview = (await (await request.get(`/api/projects/${fixture.project}/experiment-results`)).json());
  const saved = overview.runs.find((r) => r.id === fixture.ours2).records.find((r) => r.data.text === note);
  expect(saved.data.metrics.accuracy).toBe(.85); expect(saved.data.config.hyperparameters.batch_size).toBe(64);
  await page.reload(); await page.getByRole('button', { name: '0.85', exact: true }).click();
  await expect(page.getByLabel('运行详情')).toContainText(note);
  await page.screenshot({ path: 'test-results/experiment-run-record.png', fullPage: true });
});

test('result mapping labels existing metrics without changing the run or its version', async ({ page, request }) => {
  const url = `/api/experiments/${fixture.baseline}`; const before = (await (await request.get(url)).json()).experiment;
  await open(page); await page.getByRole('button', { name: 'Reference method', exact: true }).click();
  await page.getByRole('button', { name: '整理结果表', exact: true }).click();
  await page.getByLabel('方法名称 1', { exact: true }).fill('Reference renamed TEST');
  await page.getByLabel('整理理由').fill('TEST display label update.');
  await page.getByRole('button', { name: '保存结果表设置', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reference renamed TEST', exact: true })).toBeVisible();
  const after = (await (await request.get(url)).json()).experiment;
  expect(after).toEqual(before);
  const overview = (await (await request.get(`/api/projects/${fixture.project}/experiment-results`)).json());
  expect(overview.runs.find((r) => r.id === fixture.baseline).version_ids).toEqual([]);
});

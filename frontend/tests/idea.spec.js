import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { paperDocument, decisionRecord } from './fixtures/idea-paper.js';

async function setup(page, request) {
  const project = (await (await request.post('/api/projects', { data: { name: `Idea Journal TEST DATA ${Date.now()}` } })).json()).project;
  const idea = (await (await request.post(`/api/projects/${project.id}/ideas`, { data: { name: 'Research TEST DATA' } })).json()).idea;
  const url = `/api/projects/${project.id}/ideas/${idea.idea_id}`;
  await page.addInitScript((pid) => { localStorage.setItem('easyref.project', pid); localStorage.setItem('easyref.workspace', 'Idea'); }, project.id);
  await page.goto('/');
  return { project, idea, url };
}
async function record(request, url, revision, document = paperDocument(), note = decisionRecord()) {
  const response = await request.post(url + '/records', { data: { expected_revision: revision, document, record: note } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).idea;
}

test('Codex records update a paper figure and journal without a drag editor or experiment', async ({ page, request }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const { project, url } = await setup(page, request);
  await expect(page.getByText('让讨论中的方法成为一张论文图')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存为版本', exact: true })).toBeDisabled();
  await record(request, url, 0);
  await expect(page.locator('.idea-paper-figure img')).toBeVisible();
  await expect.poll(() => page.locator('.idea-paper-figure img').evaluate((image) => image.naturalWidth)).toBe(800);
  await expect(page.locator('.idea-research-record')).toContainText('Capture a confirmed discussion decision.');
  await expect(page.locator('.idea-research-record')).toContainText('Inspect the figure and save explicitly');
  await expect(page.locator('.react-flow')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '编辑模型', exact: true })).toHaveCount(0);
  expect((await (await request.get(`/api/projects/${project.id}/idea-versions`)).json()).versions).toEqual([]);
  await page.getByRole('button', { name: '放大查看', exact: true }).click();
  await expect(page.getByRole('dialog').locator('img')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '查看当时的设计', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('当时的设计快照');
  await page.keyboard.press('Escape');
  const svgDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
  const svg = await readFile(await (await svgDownload).path(), 'utf8');
  expect(svg).toContain('Spatial encoder');
  expect(await page.evaluate((source) => new DOMParser().parseFromString(source, 'image/svg+xml').querySelectorAll('parsererror').length, svg)).toBe(0);
  const pptDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PPT', exact: true }).click();
  const zip = await JSZip.loadAsync(await readFile(await (await pptDownload).path()));
  const slide = await zip.file('ppt/slides/slide1.xml').async('string');
  expect(slide).toContain('figure:branch-a'); expect(slide).toContain('Temporal encoder'); expect(slide).not.toContain('<p:pic>');
  expect((await (await request.get(url)).json()).idea.revision).toBe(1);
  await page.screenshot({ path: 'test-results/idea-research-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 744, height: 892 });
  await page.screenshot({ path: 'test-results/idea-research-narrow.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: 'test-results/idea-research-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('only explicit publication binds decisions to a shared version and an outdated figure blocks it', async ({ page, request }) => {
  const { project, url } = await setup(page, request);
  let idea = await record(request, url, 0);
  await expect(page.getByRole('button', { name: '保存为版本', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '编辑说明', exact: true }).click();
  await page.getByLabel('模型设计说明').fill('The final research design immediately before publication.');
  await page.getByRole('button', { name: '保存为版本', exact: true }).click();
  await expect(page.locator('.idea-journal-version')).toContainText('V1');
  await expect(page.getByLabel('版本自动流程')).toContainText('V1');
  await expect(page.locator('.idea-journal-draft')).toHaveCount(0);
  const first = (await (await request.get(`/api/projects/${project.id}/idea-versions`)).json()).versions[0];
  expect(first.document.description).toBe('The final research design immediately before publication.');
  await expect(page.getByRole('button', { name: '保存为版本', exact: true })).toBeDisabled();
  idea = (await (await request.get(url)).json()).idea;
  idea.document.graph.nodes[1].label = 'Changed architecture';
  idea = await record(request, url, idea.revision, idea.document, decisionRecord('TEST DATA next decision'));
  await expect(page.getByText('方案已更新，模型图待同步。', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存为版本', exact: true })).toBeDisabled();
  idea.document.figure.elements.find((e) => e.id === 'branch-a-label').text = 'Changed architecture';
  const fixed = await request.put(url, { data: { expected_revision: idea.revision, document: idea.document } }); expect(fixed.ok()).toBeTruthy();
  await expect(page.getByRole('button', { name: '保存为版本', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '保存为版本', exact: true }).click();
  await expect(page.locator('.idea-journal-version').first()).toContainText('V2');
  await page.getByTitle('查看 V2 对应实验').click();
  await expect(page.locator('.idea-experiment-state')).toContainText('对应 Idea V2');
  await page.getByRole('button', { name: '返回模型图' }).click();
  await page.locator('.idea-journal-version').last().locator('summary').click();
  await page.locator('.idea-journal-version').last().getByRole('button', { name: '查看此版模型图', exact: true }).click();
  await expect(page.locator('.idea-history-banner')).toContainText('正在查看 V1');
  await expect(page.getByRole('button', { name: '保存为版本', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '返回当前设计' }).click();
  expect((await (await request.get(`/api/projects/${project.id}/idea-versions`)).json()).versions).toHaveLength(2);
});

test('an old version without a paper figure remains viewable after the current draft gets one', async ({ page, request }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const { url } = await setup(page, request);
  const legacy = paperDocument(); delete legacy.figure;
  const published = await request.post(url + '/versions', { data: { expected_revision: 0, document: legacy, purpose: 'TEST DATA legacy design' } });
  expect(published.ok()).toBeTruthy();
  const old = (await published.json()).idea;
  await record(request, url, old.revision);
  await expect(page.locator('.idea-paper-figure img')).toBeVisible();
  await page.locator('.idea-journal-version summary').click();
  await page.getByRole('button', { name: '查看此版模型图', exact: true }).click();
  await expect(page.getByText('此历史记录尚未附论文模型图', { exact: true })).toBeVisible();
  await expect(page.locator('.idea-paper-figure img')).toHaveCount(0);
  await page.getByRole('button', { name: '返回当前设计' }).click();
  await expect(page.locator('.idea-paper-figure img')).toBeVisible();
  expect(errors).toEqual([]);
});

test('concurrent Codex updates preserve unsaved local notes until explicitly reloaded', async ({ page, request }) => {
  const { url } = await setup(page, request);
  await record(request, url, 0);
  await expect(page.locator('.idea-paper-figure img')).toBeVisible();
  await page.getByRole('button', { name: '编辑说明', exact: true }).click();
  await page.getByLabel('模型设计说明').fill('Local unsaved note');
  const current = (await (await request.get(url)).json()).idea;
  current.document.description = 'Remote confirmed note';
  await record(request, url, current.revision, current.document);
  await expect(page.getByRole('alert')).toContainText('另一个编辑', { timeout: 10000 });
  await expect(page.getByLabel('模型设计说明')).toHaveValue('Local unsaved note');
  expect((await (await request.get(url)).json()).idea.document.description).toBe('Remote confirmed note');
  await page.getByRole('button', { name: 'Experiment 模型与实验', exact: true }).click();
  await page.getByRole('button', { name: 'Idea 研究问题与构想', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('另一个编辑');
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await page.getByRole('button', { name: '展开说明', exact: true }).click();
  await expect(page.locator('.idea-markdown')).toContainText('Remote confirmed note');
});

test('the journal presents run metrics and discussion conclusions under the same version', async ({ page, request }) => {
  const { project, url } = await setup(page, request);
  const idea = await record(request, url, 0);
  const version = (await (await request.post(url + '/versions', { data: { expected_revision: idea.revision, document: idea.document } })).json()).version;
  // UI-only synthetic run fixture. Backend tests independently verify evidence is read from the actual linked run.
  await page.route(`**/api/projects/${project.id}/idea-versions`, async (route) => {
    const response = await route.fetch(); const data = await response.json();
    data.versions[0] = { ...data.versions[0], stage: 'completed', runs: [{ id: 'test-run', name: 'TEST DATA metric run', status: 'completed', config: { dataset: 'TEST DATA', split: 'fixed', seed: 1 }, metrics: { fixture_score: 0.25 } }] };
    await route.fulfill({ json: data });
  });
  await page.route(`**${url}/records`, async (route) => {
    const response = await route.fetch(); const data = await response.json();
    data.records.push({ id: 'ui-test-conclusion', version_id: version.id, created_at: new Date().toISOString(), data: { kind: 'conclusion', title: 'TEST DATA interpretation', conclusion: 'A synthetic UI fixture; no scientific claim.', experiments: [] } });
    await route.fulfill({ json: data });
  });
  await page.reload();
  await expect(page.locator('.idea-journal-version').first()).toContainText('fixture_score');
  await expect(page.locator('.idea-journal-version').first()).toContainText('0.25');
  await expect(page.locator('.idea-journal-version').first()).toContainText('A synthetic UI fixture; no scientific claim.');
  await page.screenshot({ path: 'test-results/idea-research-results.png', fullPage: true });
});

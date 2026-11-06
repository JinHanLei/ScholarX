import { test, expect } from '@playwright/test';
import PptxGenJS from 'pptxgenjs';
import { readFile } from 'node:fs/promises';

async function setup(page, request) {
  const project = (await (await request.post('/api/projects', { data: { name: `PPT import TEST DATA ${Date.now()}` } })).json()).project;
  const idea = (await (await request.post(`/api/projects/${project.id}/ideas`, { data: { name: 'PPT import TEST DATA' } })).json()).idea;
  await page.addInitScript((id) => { localStorage.setItem('easyref.project', id); localStorage.setItem('easyref.workspace', 'Idea'); }, project.id);
  await page.goto('/');
  const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE';
  const first = pptx.addSlide(); first.addText('FIRST SLIDE MODEL', { x: .7, y: .5, w: 10, h: .5, fontSize: 25, color: '264B76' });
  first.addShape(pptx.ShapeType.rect, { x: 1, y: 2, w: 3.5, h: 1.5, fill: { color: 'DCEBFA' }, line: { color: '86A9D2' } });
  first.addText('Input → Encoder', { x: 1.2, y: 2.4, w: 3.1, h: .5, fontSize: 20 });
  first.addText('Prediction', { x: 7, y: 2.4, w: 3, h: .5, fontSize: 20 });
  first.addShape(pptx.ShapeType.line, { x: 4.7, y: 2.7, w: 2, h: 0, line: { endArrowType: 'triangle', color: '264B76' } });
  pptx.addSlide().addText('SECOND SLIDE MUST NOT BE SHOWN', { x: 1, y: 1, w: 10, h: 1 });
  const buffer = await pptx.write({ outputType: 'nodebuffer' });
  return { project, idea, buffer };
}

test('PPT import shows only the first slide, retains editable bytes and survives reload', async ({ page, request }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const { project, idea, buffer } = await setup(page, request);
  await expect(page.locator('.idea-workspace > .idea-heading')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新建 Idea', exact: true })).toHaveCount(0);
  await page.getByLabel('导入 PPT 文件', { exact: true }).setInputFiles({ name: 'editable-test.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer });
  const preview = page.getByLabel('PPT 模型图（第 1 张）', { exact: true });
  await expect(preview).toContainText('FIRST SLIDE MODEL', { timeout: 20000 });
  await expect(preview).not.toContainText('SECOND SLIDE');
  await expect(page.getByText('editable-test.pptx · 第 1 张 / 共 2 张')).toBeVisible();
  await expect(page.locator('.idea-journal-draft')).toContainText('导入 PPT 模型图');
  expect((await (await request.get(`/api/projects/${project.id}/idea-versions`)).json()).versions).toEqual([]);
  await expect(page.getByRole('button', { name: '保存为版本', exact: true })).toBeEnabled();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出 PPT', exact: true }).click();
  expect(await readFile(await (await download).path())).toEqual(buffer);
  await page.reload(); await expect(preview).toContainText('FIRST SLIDE MODEL');
  await page.getByRole('button', { name: '放大查看', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('FIRST SLIDE MODEL'); await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/idea-pptx-import.png', fullPage: true });
  await page.setViewportSize({ width: 744, height: 892 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: 'test-results/idea-pptx-narrow.png', fullPage: true });
  expect((await (await request.get(`/api/projects/${project.id}/ideas/${idea.idea_id}`)).json()).idea.revision).toBe(1);
  expect(errors).toEqual([]);
});

test('an invalid PPT file cannot overwrite the current design', async ({ page, request }) => {
  const { project, idea, buffer } = await setup(page, request);
  await page.getByLabel('导入 PPT 文件', { exact: true }).setInputFiles({ name: 'broken.pptx', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid test bytes') });
  await expect(page.getByRole('alert')).toContainText('无法读取 PPTX');
  expect((await (await request.get(`/api/projects/${project.id}/ideas/${idea.idea_id}`)).json()).idea.revision).toBe(0);
  expect((await (await request.get(`/api/projects/${project.id}/idea-versions`)).json()).versions).toEqual([]);
  await expect(page.getByRole('button', { name: '导入 PPT', exact: true })).toBeEnabled();
  await page.getByLabel('导入 PPT 文件', { exact: true }).setInputFiles({ name: 'valid.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer });
  await expect(page.getByLabel('PPT 模型图（第 1 张）', { exact: true })).toContainText('FIRST SLIDE MODEL');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

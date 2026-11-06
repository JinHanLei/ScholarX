import { test, expect } from '@playwright/test';
import path from 'node:path';

test('project import preview, recovery report, validation and export use real protocol data', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '新增项目', exact: true }).click();
  await page.getByRole('button', { name: '导入已有项目', exact: true }).click();
  await page.getByLabel('项目文件夹或 ZIP 路径').fill(path.resolve('../examples/research-schema'));
  await page.getByRole('button', { name: '预览导入', exact: true }).click();
  await expect(page.getByText('共 17 项内容，导入后将创建独立工作副本。')).toBeVisible();
  await page.getByRole('button', { name: '确认并建立工作副本' }).click();
  await expect(page.locator('.rw-topbar')).toContainText('EasyRef portable research example');
  await page.getByRole('button', { name: /^项目设置：/ }).click();
  await page.getByRole('button', { name: '导入 / 导出项目', exact: true }).click();
  await page.getByText('恢复与诊断', { exact: true }).click();
  await page.getByRole('button', { name: '检查项目完整性', exact: true }).click();
  await expect(page.getByLabel('项目协议操作结果')).toContainText('"valid": true');
  await page.getByRole('button', { name: '继续研究', exact: true }).click();
  await expect(page.getByLabel('项目协议操作结果')).toContainText('"resume_process": false');
  await expect(page.getByRole('button', { name: '批准恢复计划并启动本地 Codex' })).toBeVisible();
  // Reviewing a plan must not implicitly create or launch a Codex session.
  await page.getByRole('button', { name: '研究时间线', exact: true }).click();
  await expect(page.getByLabel('项目协议操作结果')).toContainText('project.import');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出项目 ZIP', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('EasyRef-project.zip');
  expect(await download.failure()).toBeNull();
  expect(errors).toEqual([]);
});

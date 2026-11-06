import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('review input, automatic progress, editable replies and independent adversarial step', async ({ page, request }) => {
  const created = await request.post('/api/projects', { data: { name: `Review browser TEST DATA ${Date.now()}` } });
  const { project } = await created.json();
  let job = null; let polls = 0;
  const comment = { id: 'comment-1', reviewer: 'Reviewer 1', original: 'Please clarify the split.', request: 'Clarify split', action: 'Read protocol', status: 'pending', response: '', evidence: '', changes: '', validation: '', blocker: '' };
  await page.route(`**/api/projects/${project.id}/reviews`, async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      expect(body.mode).toBe('rebuttal');
      expect(body.source).toContain(comment.original);
      job = { id: 'test-review', project_id: project.id, status: 'running', created_at: new Date().toISOString(), sessions: [], scope: { mode: 'rebuttal', phase: 'parsing', revision: 0, source: body.source, summary: '', responses: [] } };
      return route.fulfill({ status: 202, json: { review: job } });
    }
    if (job?.status === 'running') {
      polls += 1;
      job.scope.phase = 'processing'; job.scope.responses = [{ ...comment }];
      if (polls >= 2) {
        job.status = 'completed'; job.scope.phase = 'done'; job.scope.revision = 2;
        job.scope.responses = [{ ...comment, status: 'blocked', response: 'Thank you. We need the evaluation data to verify the split.', evidence: 'paper/main.tex', blocker: 'Evaluation data missing' }];
      }
    }
    await route.fulfill({ json: { reviews: job ? [job] : [], roles: ['Methodology Reviewer'] } });
  });
  await page.route('**/api/reviews/test-review/responses', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.revision).toBe(job.scope.revision);
    job.scope.responses[0].response = body.responses[0].response; job.scope.revision += 1;
    await route.fulfill({ json: { review: job } });
  });
  await page.addInitScript((pid) => { localStorage.setItem('easyref.project', pid); localStorage.setItem('easyref.workspace', 'Review'); }, project.id);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '自动处理并生成回复' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '开始对抗审查' })).toHaveCount(0);
  await page.getByLabel('审稿意见原文').fill(`Reviewer 1\n${comment.original}`);
  await page.getByRole('button', { name: '自动处理并生成回复' }).click();
  await expect(page.getByText('正在拆解审稿意见', { exact: true })).toBeVisible();
  await expect(page.getByText('正在处理修改、核查证据并撰写回复', { exact: true })).toBeVisible();
  const reply = page.getByLabel('Reviewer 1 · 意见 1 回复草稿');
  await expect(reply).toBeDisabled();
  await expect(reply).toBeEnabled({ timeout: 10000 });
  await expect(page.getByText('待处理：Evaluation data missing')).toBeVisible();
  await reply.fill('Edited response with pending evidence.');
  await expect(page.getByLabel('审稿回复历史')).toBeDisabled();
  await page.getByRole('button', { name: '保存回复', exact: true }).click();
  await expect(page.getByText('回复草稿已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(reply).toHaveValue('Edited response with pending evidence.');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出回复', exact: true }).click();
  const download = await downloadPromise;
  const content = await readFile(await download.path(), 'utf8');
  expect(content).toContain(comment.original);
  expect(content).toContain('Edited response with pending evidence.');
  expect(content).toContain('Evaluation data missing');
  await page.screenshot({ path: 'test-results/review-replies.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(reply).toBeVisible();
  await page.screenshot({ path: 'test-results/review-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Polish 对抗审查' }).click();
  await expect(page.getByRole('button', { name: '开始对抗审查' })).toBeEnabled();
  await expect(page.getByLabel('审稿意见原文')).toHaveCount(0);
  expect(errors).toEqual([]);
});

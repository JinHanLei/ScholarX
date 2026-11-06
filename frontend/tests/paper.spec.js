import { test, expect } from '@playwright/test';

async function projectPage(page, request, source) {
  const r = await request.post('/api/projects', { data: { name: `Paper TEST DATA ${Date.now()}` } });
  const project = (await r.json()).project;
  let doc;
  if (source) doc = await (await request.post(`/api/projects/${project.id}/paper/import`, { data: { filename: 'main.tex', source } })).json();
  await page.addInitScript((id) => { localStorage.setItem('easyref.project', id); localStorage.setItem('easyref.workspace', 'Paper'); }, project.id);
  await page.goto('/');
  return { project, doc };
}

test('bottom outline follows reading and selection revision preserves exact range', async ({ page, request }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const source = '\\begin{document}\n' + Array.from({ length: 15 }, (_, i) => `\\section{Section ${i + 1}}\n😀 repeat repeat. ${'Body test text. '.repeat(30)}\n\n`).join('') + '\\end{document}';
  const { project, doc } = await projectPage(page, request, source);
  const dock = page.getByRole('navigation', { name: '论文底部大纲' });
  await expect(dock).toBeVisible();
  await expect(dock.locator('[aria-current="location"]')).toContainText('Section 1');
  await page.locator('.rw-paragraph').nth(9).scrollIntoViewIfNeeded();
  await expect(dock.locator('[aria-current="location"]')).not.toContainText('Section 1');
  await dock.locator('.paper-outline-rail button').last().click();
  await expect(dock.locator('[aria-current="location"]')).toContainText('Section 15');
  await dock.locator('.paper-outline-rail button').first().click();
  await expect(dock.locator('[aria-current="location"]')).toContainText('Section 1');
  await page.getByRole('button', { name: '划词修改', exact: true }).click();
  let submitted;
  await page.route(`**/projects/${project.id}/paper/assist`, async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: { session_id: 'test-revision' } });
  });
  await page.route(`**/projects/${project.id}/paper/assist/test-revision`, (route) => route.fulfill({ json: { session_id: 'test-revision', status: 'completed', output: { replacement: 'revised', explanation: 'Test revision' } } }));
  await page.route(`**/projects/${project.id}/paper/assist/test-revision/apply`, async (route) => {
    const p = doc.paragraphs[0];
    const content = p.content.slice(0, submitted.start) + route.request().postDataJSON().replacement + p.content.slice(submitted.end);
    const saved = await request.put(`/api/paragraphs/${p.id}`, { data: { content, expected_hash: doc.sha256 } });
    await route.fulfill({ json: await saved.json() });
  });
  await page.locator('[data-paper-text]').first().evaluate((el) => {
    const start = el.textContent.lastIndexOf('repeat');
    const range = document.createRange(); range.setStart(el.firstChild, start); range.setEnd(el.firstChild, start + 6);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    el.dispatchEvent(new Event('pointerup', { bubbles: true }));
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('修改意见').fill('Make this more precise');
  await page.getByRole('button', { name: '生成修改建议' }).click();
  await expect(page.getByLabel('修改预览（可继续编辑）')).toHaveValue('revised');
  expect(submitted.text).toBe('repeat');
  expect(submitted.start).toBe(doc.paragraphs[0].content.lastIndexOf('repeat'));
  await page.getByRole('button', { name: '应用到选中位置' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-paper-text]').first()).toContainText('😀 repeat revised.');
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(dock).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/paper-mobile.png' });
  expect(errors).toEqual([]);
});

test('empty paper requires a reviewed paragraph plan before drafting', async ({ page, request }) => {
  const { project } = await projectPage(page, request);
  const plan = { title: 'Test plan', sections: [{ title: 'Introduction', paragraphs: [{ purpose: 'Explain the gap', main_claim: 'Test claim', evidence_needed: 'Real experiments', references: ['10.1234/test'] }] }] };
  const starts = [];
  await page.route(`**/projects/${project.id}/paper/assist`, async (route) => {
    const body = route.request().postDataJSON(); starts.push(body);
    await route.fulfill({ json: { session_id: body.kind === 'plan' ? 'test-plan' : 'test-draft' } });
  });
  await page.route(`**/projects/${project.id}/paper/assist/test-plan`, (route) => route.fulfill({ json: { session_id: 'test-plan', status: 'completed', output: plan, references: [{ id: '10.1234/test', title: 'Source TEST DATA', url: 'https://doi.org/10.1234/test', venue: 'Target journal', year: 2025, source: 'Test fixture' }] } }));
  await page.route(`**/projects/${project.id}/paper/assist/test-draft`, (route) => route.fulfill({ json: { session_id: 'test-draft', status: 'completed', output: { paragraphs: ['Draft TEST DATA. [TODO: evidence required]'] } } }));
  await expect(page.getByRole('button', { name: '确认逐段计划，开始写正文' })).toHaveCount(0);
  await page.getByLabel('研究主题 / 检索关键词').fill('graph learning');
  await page.getByLabel('目标期刊', { exact: true }).fill('Target journal');
  await page.getByRole('button', { name: '查找相似工作并生成大纲' }).click();
  await expect(page.getByRole('link', { name: 'Source TEST DATA' })).toBeVisible();
  expect(starts.map((s) => s.kind)).toEqual(['plan']);
  await page.getByLabel('第 1 段 · 写作目的（可修改）').fill('Describe our research gap');
  await page.getByRole('button', { name: '确认逐段计划，开始写正文' }).click();
  await expect(page.getByText('Draft TEST DATA. [TODO: evidence required]', { exact: true })).toBeVisible();
  expect(starts[1].confirmed).toBe(true);
  expect(starts[1].plan.sections[0].paragraphs[0].purpose).toBe('Describe our research gap');
});

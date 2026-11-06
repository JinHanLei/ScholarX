import { test } from 'node:test';
import assert from 'node:assert/strict';
import { researchLink } from '../src/components/research/researchLinks.js';
const project = { id: 'actual-project', root_path: 'D:\\research\\project' };
test('local PDF and code links resolve within the selected project', () => {
  assert.equal(researchLink('D:/research/project/paper/draft.pdf', project), '/api/projects/actual-project/file?path=paper%2Fdraft.pdf');
  assert.equal(researchLink('D:/research/project/models/adapter.py:12', project), '/api/projects/actual-project/file?path=models%2Fadapter.py');
});
test('external protocols retain markdown protections; neighboring projects cannot map', () => {
  assert.equal(researchLink('javascript:alert(1)', project), '');
  assert.equal(researchLink('D:/research/project-other/secret.txt', project), '');
  assert.equal(researchLink('D:/research/project/../outside.txt', project), '');
  assert.equal(researchLink('https://arxiv.org/abs/2604.05543', project), 'https://arxiv.org/abs/2604.05543');
});

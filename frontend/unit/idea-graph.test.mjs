import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { layoutGraph, semanticGraph, changedNodes } from '../src/components/research/idea/ideaGraph.js';
import { buildPresentation } from '../src/components/research/idea/ideaExport.js';

const document = { name: 'TEST DATA · 可编辑模型', description: 'This is an export acceptance fixture.', graph: {
  nodes: [{ id: 'input', label: '输入序列', kind: 'input', description: '', inputs: '', outputs: 'B × T × D', parameters: '', position: { x: 0, y: 0 } },
    { id: 'encoder', label: 'Transformer', kind: 'backbone', description: 'Temporal encoding', inputs: '', outputs: 'B × H', parameters: '', position: { x: 330, y: 50 } }],
  edges: [{ id: 'edge', source: 'input', target: 'encoder', label: 'features' }],
} };
test('layout changes preserve semantic identity; architecture edits do not', () => {
  const updated = structuredClone(document); updated.graph = layoutGraph(updated.graph);
  assert.equal(semanticGraph(updated), semanticGraph(document));
  assert.equal(changedNodes(document, updated).encoder, '');
  updated.graph.nodes[1].parameters = 'hidden dimension 128';
  assert.notEqual(semanticGraph(updated), semanticGraph(document));
  assert.equal(changedNodes(document, updated).encoder, 'modified');
  assert.equal(updated.graph.nodes[0].id, 'input');
});
test('PowerPoint exports native editable shapes and text, not a flattened picture', async () => {
  const buffer = await buildPresentation(document, 3).write({ outputType: 'nodebuffer' });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(xml, /module:input/); assert.match(xml, /module:encoder/);
  assert.match(xml, /输入序列/); assert.match(xml, /Transformer/); assert.match(xml, /V3/);
  assert.ok((xml.match(/<p:sp>/g) || []).length >= 8);
  assert.ok(!xml.includes('<p:pic>'));
  assert.ok(zip.file('ppt/slides/slide2.xml'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { layoutGraph, previewGraph, semanticGraph, changedNodes } from '../src/components/research/idea/ideaGraph.js';
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
  const reordered = JSON.parse(JSON.stringify(document), (key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value);
  assert.equal(semanticGraph(reordered), semanticGraph(document));
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
test('compact preview preserves the draft and routes parallel, cyclic and disconnected modules', () => {
  const graph = structuredClone(document.graph);
  graph.nodes.push({ id: 'candidate', label: 'Disconnected candidate', kind: 'module', position: { x: -500, y: 400 } });
  graph.edges.push({ id: 'parallel', source: 'input', target: 'encoder', label: 'second relation' }, { id: 'loop', source: 'encoder', target: 'encoder', label: 'feedback' });
  const before = structuredClone(graph);
  const preview = previewGraph(graph);
  assert.deepEqual(graph, before);
  assert.deepEqual(preview.nodes.map((n) => n.id), graph.nodes.map((n) => n.id));
  assert.deepEqual(preview.edges.map((e) => e.id), graph.edges.map((e) => e.id));
  assert.ok(preview.width > 0 && preview.height > 0);
  for (const edge of preview.edges) {
    assert.ok(edge.points.length > 1);
    assert.ok(edge.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  }
  assert.notDeepEqual(preview.edges[0].points, preview.edges[1].points);
  assert.deepEqual(previewGraph({ nodes: [], edges: [] }).nodes, []);
});
test('narrow previews fold a pipeline without inventing connections to an isolated candidate', () => {
  const graph = {
    nodes: Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, label: `Module ${i}`, position: { x: i * 100, y: 0 } })),
    edges: Array.from({ length: 4 }, (_, i) => ({ id: `e${i}`, source: `n${i}`, target: `n${i + 1}` })),
  };
  const original = structuredClone(graph);
  const preview = previewGraph(graph, 660);
  assert.ok(preview.width <= 660 && preview.height < 310);
  assert.equal(preview.nodes[2].position.y, preview.nodes[0].position.y);
  assert.ok(preview.nodes[3].position.y > preview.nodes[2].position.y);
  assert.deepEqual(preview.edges.map(({ id, source, target }) => ({ id, source, target })), graph.edges);
  assert.deepEqual(graph, original);
});

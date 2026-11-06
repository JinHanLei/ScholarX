export function paperDocument() {
  return { name: 'TEST DATA · Research method', description: '### 研究问题\nThis is a UI acceptance fixture.\n\n### 核心方法\nCompare two hypothetical branches.\n\n### 验证方案\nNo real research experiment is executed.', graph: {
    nodes: [{ id: 'input', label: 'Input', kind: 'input', position: { x: 0, y: 0 } }, { id: 'encoder', label: 'Encoder', kind: 'backbone', position: { x: 300, y: 0 } }],
    edges: [{ id: 'features', source: 'input', target: 'encoder', label: 'features' }],
  }, figure: { width: 800, height: 300, title: 'TEST DATA · Two-branch method', caption: 'Schematic acceptance fixture; no scientific result.', elements: [
    { id: 'group', type: 'rect', x: 190, y: 30, width: 330, height: 240, radius: 8, fill: '#f7f9fc', stroke: '#cbd5e1', dash: true },
    { id: 'group-title', type: 'text', x: 210, y: 48, width: 280, height: 25, text: 'Representation branches', fontSize: 17, bold: true },
    { id: 'input', type: 'rect', x: 25, y: 120, width: 120, height: 60, radius: 4, fill: '#edf4ff' },
    { id: 'input-label', type: 'text', x: 40, y: 138, width: 90, height: 25, text: 'Input x', fontSize: 18 },
    { id: 'branch-a', type: 'rect', x: 245, y: 95, width: 220, height: 50, fill: '#eef8f4' },
    { id: 'branch-a-label', type: 'text', x: 265, y: 109, width: 180, height: 25, text: 'Spatial encoder', fontSize: 17 },
    { id: 'branch-b', type: 'rect', x: 245, y: 180, width: 220, height: 50, fill: '#f3effa' },
    { id: 'branch-b-label', type: 'text', x: 265, y: 194, width: 180, height: 25, text: 'Temporal encoder', fontSize: 17 },
    { id: 'a', type: 'polyline', points: [[145, 150], [175, 150], [175, 120], [245, 120]], arrowEnd: true },
    { id: 'b', type: 'polyline', points: [[145, 150], [175, 150], [175, 205], [245, 205]], arrowEnd: true },
    { id: 'fusion', type: 'ellipse', x: 590, y: 120, width: 60, height: 60, fill: '#ffffff' },
    { id: 'fusion-label', type: 'text', x: 590, y: 136, width: 60, height: 30, text: '+', fontSize: 24, align: 'center' },
    { id: 'c', type: 'polyline', points: [[465, 120], [550, 120], [550, 150], [590, 150]], arrowEnd: true },
    { id: 'd', type: 'polyline', points: [[465, 205], [550, 205], [550, 150], [590, 150]], arrowEnd: true },
    { id: 'output', type: 'text', x: 680, y: 136, width: 100, height: 25, text: 'Output', fontSize: 18 },
    { id: 'e', type: 'line', points: [[650, 150], [675, 150]], arrowEnd: true },
  ] } };
}
export function decisionRecord(title = 'TEST DATA · Confirm two branches') {
  return { id: crypto.randomUUID(), kind: 'decision', title, change: 'Use two branches in the method.', reason: 'Capture a confirmed discussion decision.', validation: 'Inspect the figure and save explicitly before execution.', source: 'Codex acceptance fixture' };
}

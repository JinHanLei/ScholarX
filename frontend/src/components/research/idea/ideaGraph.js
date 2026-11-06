import dagre from '@dagrejs/dagre';

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 116;
export const KINDS = {
  input: { label: '输入', color: '#168a78', fill: '#edf8f4' },
  backbone: { label: 'Backbone', color: '#3978e8', fill: '#edf3ff' },
  module: { label: '模块', color: '#8160c7', fill: '#f5f0ff' },
  output: { label: '输出', color: '#bc7a25', fill: '#fff7e9' },
  loss: { label: '目标 / Loss', color: '#c35e74', fill: '#fff0f3' },
};
export const STAGES = {
  queued: '已排队', snapshotting: '固定源码', implementing: '更新实现', validating: '校验实现',
  waiting_approval: '等待原生授权', running: '实验运行中', summarizing: '汇总结果', completed: '已完成',
  blocked: '等待处理', failed: '失败', cancelled: '已停止', interrupted: '已中断',
};
export const ACTIVE = ['queued', 'snapshotting', 'implementing', 'validating', 'running', 'summarizing', 'waiting_approval'];
export function layoutGraph(graph) {
  const model = new dagre.graphlib.Graph();
  model.setGraph({ rankdir: 'LR', nodesep: 65, ranksep: 95, marginx: 35, marginy: 35 });
  model.setDefaultEdgeLabel(() => ({}));
  graph.nodes.forEach((node) => model.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  graph.edges.forEach((edge) => model.setEdge(edge.source, edge.target));
  dagre.layout(model);
  return { ...graph, nodes: graph.nodes.map((node) => ({ ...node, position: { x: model.node(node.id).x - NODE_WIDTH / 2, y: model.node(node.id).y - NODE_HEIGHT / 2 } })) };
}
export function newNode(kind, index = 0) {
  return { id: crypto.randomUUID(), kind, label: kind === 'backbone' ? 'Backbone' : KINDS[kind].label,
    description: '', inputs: '', outputs: '', parameters: '', position: { x: 50 + (index % 4) * 280, y: 70 + Math.floor(index / 4) * 170 } };
}
export function semanticGraph(document) {
  return JSON.stringify({ description: document.description,
    nodes: document.graph.nodes.map(({ position, ...node }) => node).sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...document.graph.edges].sort((a, b) => a.id.localeCompare(b.id)) });
}
export function changedNodes(before, after) {
  const old = new Map((before?.graph.nodes || []).map(({ position, ...node }) => [node.id, JSON.stringify(node)]));
  return Object.fromEntries(after.graph.nodes.map(({ position, ...node }) => [node.id, !old.has(node.id) ? 'added' : old.get(node.id) !== JSON.stringify(node) ? 'modified' : '']));
}
export function graphBounds(graph) {
  if (!graph.nodes.length) return { x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT };
  const x = Math.min(...graph.nodes.map((n) => n.position.x));
  const y = Math.min(...graph.nodes.map((n) => n.position.y));
  return { x, y, width: Math.max(...graph.nodes.map((n) => n.position.x + NODE_WIDTH)) - x,
    height: Math.max(...graph.nodes.map((n) => n.position.y + NODE_HEIGHT)) - y };
}

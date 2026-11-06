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
  blocked: '等待处理', failed: '失败', cancelled: '已停止', interrupted: '已中断', imported: '历史设计',
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
// A display-only layout: opening the overview must never move saved nodes or create a draft.
export const PREVIEW_WIDTH = 184;
export const PREVIEW_HEIGHT = 72;
export function previewGraph(graph, availableWidth = Infinity) {
  if (!graph.nodes.length) return { nodes: [], edges: [], width: 0, height: 0 };
  // Fold simple pipelines into reading rows. Branches and cycles retain Dagre routing.
  const incoming = new Map(), outgoing = new Map();
  graph.edges.forEach((edge) => {
    incoming.set(edge.target, [...(incoming.get(edge.target) || []), edge]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge]);
  });
  const linear = graph.nodes.every((node) => (incoming.get(node.id)?.length || 0) <= 1 && (outgoing.get(node.id)?.length || 0) <= 1);
  if (linear && Number.isFinite(availableWidth)) {
    const ordered = [], visited = new Set(), byId = new Map(graph.nodes.map((node) => [node.id, node]));
    // Connected paths precede isolated candidates; no relation is inferred between them.
    const starts = graph.nodes.filter((node) => !incoming.has(node.id)).sort((a, b) => Number(outgoing.has(b.id)) - Number(outgoing.has(a.id)));
    for (let node of starts) {
      while (node && !visited.has(node.id)) {
        ordered.push(node); visited.add(node.id);
        node = byId.get(outgoing.get(node.id)?.[0]?.target);
      }
    }
    if (ordered.length === graph.nodes.length) {
      const gap = 32, margin = 14, rowGap = 24;
      const columns = Math.min(ordered.length, Math.max(2, Math.floor((availableWidth - margin * 2 + gap) / (PREVIEW_WIDTH + gap))));
      const positions = new Map(ordered.map((node, index) => {
        const row = Math.floor(index / columns), column = row % 2 ? columns - 1 - index % columns : index % columns;
        return [node.id, { x: margin + column * (PREVIEW_WIDTH + gap), y: margin + row * (PREVIEW_HEIGHT + rowGap) }];
      }));
      return {
        folded: true,
        width: margin * 2 + columns * (PREVIEW_WIDTH + gap) - gap,
        height: margin * 2 + Math.ceil(ordered.length / columns) * (PREVIEW_HEIGHT + rowGap) - rowGap,
        nodes: graph.nodes.map((node) => ({ ...node, position: positions.get(node.id) })),
        edges: graph.edges.map((edge) => {
          const from = positions.get(edge.source), to = positions.get(edge.target);
          const points = from.y === to.y
            ? [{ x: from.x + (to.x > from.x ? PREVIEW_WIDTH : 0), y: from.y + PREVIEW_HEIGHT / 2 }, { x: to.x + (to.x > from.x ? 0 : PREVIEW_WIDTH), y: to.y + PREVIEW_HEIGHT / 2 }]
            : [{ x: from.x + PREVIEW_WIDTH / 2, y: from.y + PREVIEW_HEIGHT }, { x: to.x + PREVIEW_WIDTH / 2, y: to.y }];
          return { ...edge, points };
        }),
      };
    }
  }
  const model = new dagre.graphlib.Graph({ multigraph: true });
  model.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 48, marginx: 20, marginy: 20 });
  model.setDefaultEdgeLabel(() => ({}));
  graph.nodes.forEach((node) => model.setNode(node.id, { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }));
  const ids = new Set(graph.nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  edges.forEach((edge) => model.setEdge(edge.source, edge.target, {}, edge.id));
  dagre.layout(model);
  return {
    ...model.graph(),
    nodes: graph.nodes.map((node) => ({ ...node, position: { x: model.node(node.id).x - PREVIEW_WIDTH / 2, y: model.node(node.id).y - PREVIEW_HEIGHT / 2 } })),
    edges: edges.map((edge) => ({ ...edge, points: model.edge({ v: edge.source, w: edge.target, name: edge.id }).points })),
  };
}
export function newNode(kind, index = 0) {
  return { id: crypto.randomUUID(), kind, label: kind === 'backbone' ? 'Backbone' : KINDS[kind].label,
    description: '', inputs: '', outputs: '', parameters: '', position: { x: 50 + (index % 4) * 280, y: 70 + Math.floor(index / 4) * 170 } };
}
export function semanticGraph(document) {
  return JSON.stringify({ description: document.description,
    ...(document.figure?.presentation ? { presentation: document.figure.presentation.sha256 } : {}),
    nodes: document.graph.nodes.map((node) => Object.fromEntries(['id', 'label', 'kind', 'description', 'inputs', 'outputs', 'parameters'].map((key) => [key, node[key] || '']))).sort((a, b) => a.id.localeCompare(b.id)),
    edges: document.graph.edges.map(({ id, source, target, label }) => ({ id, source, target, label: label || '' })).sort((a, b) => a.id.localeCompare(b.id)) });
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

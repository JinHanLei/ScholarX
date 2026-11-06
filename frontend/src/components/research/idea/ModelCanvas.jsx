import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, MarkerType, applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react';
import { Boxes, Plus, Trash2, X, GitBranch, ArrowRight, Maximize2, WandSparkles } from 'lucide-react';
import { KINDS, NODE_WIDTH, NODE_HEIGHT, layoutGraph, newNode } from './ideaGraph.js';
import '@xyflow/react/dist/style.css';

function ModelNode({ data, selected }) {
  const palette = KINDS[data.kind] || KINDS.module;
  return <div className={`idea-node ${selected ? 'is-selected' : ''} ${data.change || ''}`} style={{ '--node-color': palette.color, '--node-fill': palette.fill }}>
    <Handle type="target" position={Position.Left} />
    <div className="idea-node-kind"><span />{palette.label}{data.change && <b>{data.change === 'added' ? '新增' : '修改'}</b>}</div>
    <strong>{data.label}</strong><small>{data.outputs || data.description || '点击编辑模块说明'}</small>
    <Handle type="source" position={Position.Right} />
  </div>;
}
const nodeTypes = { model: ModelNode };

export default function ModelCanvas({ graph, onChange, readOnly = false, differences = {}, onInteraction, initialSelection }) {
  const [selected, setSelected] = useState(initialSelection ? { kind: 'node', id: initialSelection } : null);
  const [flow, setFlow] = useState(null);
  const viewport = useRef(null);
  useEffect(() => {
    if (!flow || !graph.nodes.length) return;
    let frame;
    // The native dialog starts hidden. Fit after it has a real size, also on resize.
    const observer = new ResizeObserver(([entry]) => {
      if (!entry.contentRect.width || !entry.contentRect.height) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => flow.fitView({ padding: .25, maxZoom: 1.1 }));
    });
    observer.observe(viewport.current);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [flow, graph.nodes.length]);
  const nodes = useMemo(() => graph.nodes.map((node) => ({ id: node.id, type: 'model', position: node.position, data: { ...node, change: differences[node.id] }, selected: selected?.kind === 'node' && selected.id === node.id, width: NODE_WIDTH, height: NODE_HEIGHT })), [graph.nodes, differences, selected]);
  const edges = useMemo(() => graph.edges.map((edge) => ({ ...edge, type: 'smoothstep', selected: selected?.kind === 'edge' && selected.id === edge.id, markerEnd: { type: MarkerType.ArrowClosed, width: 17, height: 17 }, style: { stroke: '#9aabc3', strokeWidth: 1.6 }, labelStyle: { fontSize: 11, fill: '#62748d' } })), [graph.edges, selected]);
  const onNodesChange = useCallback((changes) => {
    if (readOnly) return;
    const editing = changes.filter((change) => ['position', 'remove'].includes(change.type));
    if (!editing.length) return;
    const updated = applyNodeChanges(editing, nodes);
    const ids = new Set(updated.map((node) => node.id));
    onChange({ nodes: updated.map((node) => { const { change, ...data } = node.data; return { ...data, position: node.position }; }), edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) });
  }, [graph, nodes, readOnly, onChange]);
  const onEdgesChange = useCallback((changes) => {
    if (readOnly) return;
    const deleted = changes.filter((change) => change.type === 'remove');
    if (deleted.length) onChange({ ...graph, edges: applyEdgeChanges(deleted, graph.edges) });
  }, [graph, readOnly, onChange]);
  const add = (kind) => { const node = newNode(kind, graph.nodes.length); onChange({ ...graph, nodes: [...graph.nodes, node] }); setSelected({ kind: 'node', id: node.id }); };
  const current = selected?.kind === 'node' ? graph.nodes.find((n) => n.id === selected.id) : selected?.kind === 'edge' ? graph.edges.find((e) => e.id === selected.id) : null;
  const updateNode = (key, value) => onChange({ ...graph, nodes: graph.nodes.map((node) => node.id === current.id ? { ...node, [key]: value } : node) });
  const remove = () => { if (selected.kind === 'node') onChange({ nodes: graph.nodes.filter((n) => n.id !== current.id), edges: graph.edges.filter((e) => e.source !== current.id && e.target !== current.id) }); else onChange({ ...graph, edges: graph.edges.filter((e) => e.id !== current.id) }); setSelected(null); };
  return <section className={`idea-canvas-card ${readOnly ? 'readonly' : ''}`} aria-label="可编辑模型图">
    <div className="idea-canvas-toolbar"><div><GitBranch size={15} /><span>MODEL CANVAS</span><small>{graph.nodes.length} 个模块 · {graph.edges.length} 条连接</small></div><div>
      {!readOnly && <button title="自动排版" onClick={() => { onChange(layoutGraph(graph)); setTimeout(() => flow?.fitView({ padding: .22, duration: 250 }), 100); }}><WandSparkles size={14} /><span>自动排版</span></button>}
      <button title="适应画布" onClick={() => flow?.fitView({ padding: .22, duration: 250 })}><Maximize2 size={15} /></button>
    </div></div>
    <div className="idea-canvas" ref={viewport}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onInit={setFlow} fitView fitViewOptions={{ padding: .25 }} minZoom={.15} maxZoom={1.8}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={(edge) => !readOnly && onChange({ ...graph, edges: addEdge({ ...edge, id: crypto.randomUUID(), label: '' }, graph.edges) })}
        onNodeClick={(_, node) => setSelected({ kind: 'node', id: node.id })} onEdgeClick={(_, edge) => setSelected({ kind: 'edge', id: edge.id })} onPaneClick={() => setSelected(null)}
        onNodeDragStart={() => onInteraction?.(true)} onNodeDragStop={() => onInteraction?.(false)} nodesDraggable={!readOnly} nodesConnectable={!readOnly} edgesReconnectable={false} deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
        ariaLabelConfig={{ 'controls.zoomIn.ariaLabel': '放大模型图', 'controls.zoomOut.ariaLabel': '缩小模型图', 'controls.fitView.ariaLabel': '适应模型图' }}>
        <Background color="#dce3ef" gap={22} size={1} /><Controls showInteractive={false} />
      </ReactFlow>
      {!graph.nodes.length && <div className="idea-canvas-empty"><span><Boxes size={31} strokeWidth={1.4} /></span><h2>让构想成为模型</h2><p>在 Codex 中讨论你的 backbone，模型图会在这里更新。</p><small>也可以从下方添加模块，拖动端点建立连接。</small>{!readOnly && <button className="idea-primary" onClick={() => add('backbone')}><Plus size={16} />添加 Backbone</button>}</div>}
      {current && <aside className="idea-inspector"><header><strong>{selected.kind === 'node' ? '模块说明' : '连接说明'}</strong><button title="关闭模块说明" onClick={() => setSelected(null)}><X size={16} /></button></header>
        {selected.kind === 'node' ? <><label>名称<input aria-label="模块名称" value={current.label} readOnly={readOnly} onChange={(e) => updateNode('label', e.target.value)} /></label>
          <label>类型<select aria-label="模块类型" value={current.kind} disabled={readOnly} onChange={(e) => updateNode('kind', e.target.value)}>{Object.entries(KINDS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>
          {[['description', '方法说明'], ['inputs', '输入'], ['outputs', '输出'], ['parameters', '参数与约束']].map(([key, label]) => <label key={key}>{label}<textarea aria-label={`模块${label}`} rows={key === 'description' ? 3 : 2} value={current[key] || ''} readOnly={readOnly} onChange={(e) => updateNode(key, e.target.value)} /></label>)}</> : <><div className="idea-edge-path">{graph.nodes.find((n) => n.id === current.source)?.label}<ArrowRight size={14} />{graph.nodes.find((n) => n.id === current.target)?.label}</div><label>连接标注<input aria-label="连接标注" value={current.label} readOnly={readOnly} onChange={(e) => onChange({ ...graph, edges: graph.edges.map((edge) => edge.id === current.id ? { ...edge, label: e.target.value } : edge) })} /></label></>}
        {!readOnly && <button className="idea-delete" onClick={remove}><Trash2 size={13} />删除{selected.kind === 'node' ? '模块' : '连接'}</button>}
      </aside>}
    </div>
    <div className="idea-palette">{!readOnly ? <><span>添加模块</span>{Object.entries(KINDS).map(([key, theme]) => <button key={key} onClick={() => add(key)}><i style={{ background: theme.color }} />{theme.label}<Plus size={12} /></button>)}<small>拖动连接点连接 · Delete 删除</small></> : <span>历史版本 · 图和说明保持原样</span>}</div>
  </section>;
}

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { GitBranch, Pencil, Maximize2, X } from 'lucide-react';
import { KINDS, PREVIEW_WIDTH, PREVIEW_HEIGHT, previewGraph } from './ideaGraph.js';

export default function ModelPreview({ graph, readOnly = false, differences = {}, onEdit }) {
  const viewport = useRef(null);
  const [width, setWidth] = useState(Infinity);
  useEffect(() => {
    const element = viewport.current;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(0, entry.contentRect.width - 20)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const layout = useMemo(() => previewGraph(graph, width), [graph, width]);
  const [selected, setSelected] = useState(null);
  const marker = `idea-arrow-${useId().replace(/:/g, '')}`;
  const current = graph.nodes.find((node) => node.id === selected);
  return <section ref={viewport} className="idea-model-preview" aria-label="模型结构预览">
    <header><div><GitBranch size={16} /><h2>模型结构</h2><small>{graph.nodes.length} 个模块 · {graph.edges.length} 条连接</small></div>
      <button onClick={() => onEdit()}>{readOnly ? <Maximize2 size={14} /> : <Pencil size={14} />}{readOnly ? '展开查看' : '编辑模型'}</button>
    </header>
    {layout.nodes.length ? <div className="idea-preview-viewport" tabIndex={0} aria-label="模型图，点击模块查看说明">
      <svg className="idea-preview-diagram" viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ width: layout.width, minWidth: Math.min(layout.width, layout.folded ? 320 : 860) }} aria-label="模型连接关系">
        <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#9aaec8" /></marker></defs>
        {layout.edges.map((edge) => {
          const middle = edge.points[Math.floor(edge.points.length / 2)];
          return <g key={edge.id}><path d={edge.points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ')} fill="none" stroke="#9aaec8" strokeWidth="1.5" strokeLinejoin="round" markerEnd={`url(#${marker})`}><title>{edge.label || `${graph.nodes.find((n) => n.id === edge.source)?.label} → ${graph.nodes.find((n) => n.id === edge.target)?.label}`}</title></path>
            {edge.label && <text x={middle.x} y={middle.y - 8} textAnchor="middle" className="idea-preview-edge-label"><title>{edge.label}</title>{edge.label.length > 12 ? `${edge.label.slice(0, 12)}…` : edge.label}</text>}
          </g>;
        })}
        {layout.nodes.map((node) => {
          const theme = KINDS[node.kind] || KINDS.module;
          return <foreignObject key={node.id} x={node.position.x} y={node.position.y} width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT}>
            <button className={`idea-preview-node ${current?.id === node.id ? 'selected' : ''} ${differences[node.id] || ''}`} style={{ '--node-color': theme.color, '--node-fill': theme.fill }} onClick={() => setSelected(current?.id === node.id ? null : node.id)} aria-pressed={current?.id === node.id} title={node.label}>
              <small>{theme.label}{differences[node.id] && <span>{differences[node.id] === 'added' ? '新增' : '修改'}</span>}</small><strong>{node.label}</strong>
              {node.outputs && <span className="idea-preview-output" title={node.outputs}>{node.outputs}</span>}
            </button>
          </foreignObject>;
        })}
      </svg>
    </div> : <div className="idea-preview-empty"><GitBranch size={25} /><div><strong>从一个 backbone 开始</strong><p>和 Codex 讨论结构，模型图会在这里更新。</p></div>{!readOnly && <button onClick={() => onEdit()}>添加模型</button>}</div>}
    {current && <div className="idea-preview-details">
      <header><strong>{current.label}</strong><div>{!readOnly && <button onClick={() => onEdit(current.id)}><Pencil size={12} />编辑此模块</button>}<button aria-label="收起模块详情" onClick={() => setSelected(null)}><X size={15} /></button></div></header>
      <dl>{[['description', '方法'], ['inputs', '输入'], ['outputs', '输出'], ['parameters', '参数与约束']].filter(([key]) => current[key]).map(([key, title]) => <div key={key}><dt>{title}</dt><dd>{current[key]}</dd></div>)}</dl>
      {!['description', 'inputs', 'outputs', 'parameters'].some((key) => current[key]) && <p>此模块暂未填写说明。</p>}
    </div>}
  </section>;
}

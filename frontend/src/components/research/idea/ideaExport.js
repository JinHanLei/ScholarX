import PptxGenJS from 'pptxgenjs';
import { graphBounds, KINDS, NODE_WIDTH, NODE_HEIGHT } from './ideaGraph.js';
import { addPaperFigure } from './paperFigure.js';

export function buildPresentation(document, version) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'EasyRef'; pptx.subject = 'Versioned model architecture'; pptx.title = document.name;
  pptx.lang = 'zh-CN';
  pptx.theme = { headFontFace: 'Microsoft YaHei', bodyFontFace: 'Microsoft YaHei', lang: 'zh-CN' };
  const slide = pptx.addSlide(); slide.background = { color: document.figure ? 'FFFFFF' : 'F8FAFD' };
  slide.addText(document.name, { x: .5, y: .3, w: 11.5, h: .45, fontSize: 23, bold: true, color: '22324B' });
  slide.addText(version ? `V${version}` : 'DRAFT', { x: 11.6, y: .35, w: 1.1, h: .3, fontSize: 13, color: '3978E8', align: 'right' });
  if (document.figure) {
    addPaperFigure(slide, pptx, document.figure);
  } else {
  const bounds = graphBounds(document.graph);
  const scale = Math.min(12 / bounds.width, 5.7 / bounds.height);
  if (NODE_WIDTH * scale < .35) throw new Error('模型布局过大，请先自动排版或缩小模块间距再导出');
  const ox = (13.333 - bounds.width * scale) / 2;
  const oy = 1.05 + (5.7 - bounds.height * scale) / 2;
  const project = (node) => ({ x: ox + (node.position.x - bounds.x) * scale, y: oy + (node.position.y - bounds.y) * scale, w: NODE_WIDTH * scale, h: NODE_HEIGHT * scale });
  const nodes = new Map(document.graph.nodes.map((node) => [node.id, node]));
  for (const edge of document.graph.edges) {
    const from = nodes.get(edge.source), to = nodes.get(edge.target);
    if (!from || !to) continue;
    const a = project(from), b = project(to);
    const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
    slide.addShape(pptx.ShapeType.line, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(.001, Math.abs(x2 - x1)), h: Math.max(.001, Math.abs(y2 - y1)),
      flipH: x2 < x1, flipV: y2 < y1, line: { color: '9AABC3', width: 1.6, endArrowType: 'triangle' }, objectName: `edge:${edge.id}` });
    if (edge.label) slide.addText(edge.label, { x: (x1 + x2) / 2 - .6, y: (y1 + y2) / 2 - .22, w: 1.2, h: .25, fontSize: 10, color: '64748B', align: 'center', fill: { color: 'F8FAFD' }, breakLine: false });
  }
  for (const node of document.graph.nodes) {
    const p = project(node), theme = KINDS[node.kind] || KINDS.module;
    slide.addShape(pptx.ShapeType.roundRect, { ...p, radius: .12, rectRadius: .12, fill: { color: theme.fill.slice(1) }, line: { color: theme.color.slice(1), width: 1.3 }, objectName: `module:${node.id}` });
    slide.addText(theme.label.toUpperCase(), { x: p.x + .1, y: p.y + .07, w: p.w - .2, h: p.h * .16, fontSize: Math.min(10, p.w * 4.8), color: theme.color.slice(1), margin: 0 });
    slide.addText(node.label, { x: p.x + .1, y: p.y + p.h * .29, w: p.w - .2, h: p.h * .3, fontSize: Math.min(18, p.w * 8), color: '22324B', bold: true, margin: 0, fit: 'shrink', objectName: `label:${node.id}` });
    const caption = node.outputs || node.description;
    if (caption) slide.addText(caption.slice(0, 100), { x: p.x + .1, y: p.y + p.h * .67, w: p.w - .2, h: p.h * .23, fontSize: Math.min(10, p.w * 4.7), color: '64748B', margin: 0, fit: 'shrink' });
  }
  }
  slide.addNotes(document.description || '');
  slide.addText(document.figure?.caption || 'EasyRef · Model design', { x: .5, y: 6.95, w: 12.3, h: .4, fontSize: 9, color: '64748B', margin: 0 });
  if (document.description) {
    // Bound text per slide so long design notes remain editable and readable.
    const chunks = document.description.match(/[\s\S]{1,1100}/g) || [];
    chunks.forEach((text, index) => {
      const note = pptx.addSlide();
      note.addText(`${document.name} · 设计说明${chunks.length > 1 ? ` ${index + 1}` : ''}`, { x: .6, y: .5, w: 12, h: .5, fontSize: 23, color: '22324B', bold: true });
      note.addText(text, { x: .7, y: 1.3, w: 11.9, h: 5.5, fontSize: 16, color: '475569', breakLine: false, fit: 'shrink', valign: 'top' });
    });
  }
  return pptx;
}
export async function exportPresentation(document, version) {
  const safeName = document.name.replace(/[<>:"/\\|?*]/g, '-').slice(0, 80);
  await buildPresentation(document, version).writeFile({ fileName: `${safeName}-${version ? `V${version}` : 'draft'}.pptx` });
}

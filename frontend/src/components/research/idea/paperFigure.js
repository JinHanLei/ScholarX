// One vector source drives the in-app figure, SVG download, and editable PPT shapes.
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
export function figureSvg(figure) {
  const elements = figure.elements.map((e) => {
    const paint = `fill="${escape(e.fill || 'none')}" stroke="${escape(e.stroke || '#334155')}" stroke-width="${e.strokeWidth ?? 1.5}"${e.dash ? ' stroke-dasharray="6 4"' : ''}`;
    if (e.type === 'rect') return `<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="${e.radius || 0}" ${paint}/>`;
    if (e.type === 'ellipse') return `<ellipse cx="${e.x + e.width / 2}" cy="${e.y + e.height / 2}" rx="${e.width / 2}" ry="${e.height / 2}" ${paint}/>`;
    if (e.type === 'text') {
      const size = e.fontSize || 16, lines = e.text.split('\n');
      const x = e.x + (e.align === 'center' ? e.width / 2 : e.align === 'right' ? e.width : 0);
      return `<text fill="${escape(e.color || '#1e293b')}" font-size="${size}" font-weight="${e.bold ? 600 : 400}" text-anchor="${e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start'}">${lines.map((line, i) => `<tspan x="${x}" y="${e.y + size + i * size * 1.3}">${escape(line)}</tspan>`).join('')}</text>`;
    }
    const points = e.points.map((p) => p.join(',')).join(' ');
    return `<polyline points="${points}" ${paint}${e.arrowEnd ? ' marker-end="url(#paper-arrow)"' : ''}/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${figure.width} ${figure.height}" width="${figure.width}" height="${figure.height}" font-family="Arial, Microsoft YaHei, sans-serif"><title>${escape(figure.title)}</title><defs><marker id="paper-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="#475569"/></marker></defs><rect width="100%" height="100%" fill="#ffffff"/>${elements}</svg>`;
}

export function downloadFigure(figure, name) {
  const url = URL.createObjectURL(new Blob([figureSvg(figure)], { type: 'image/svg+xml;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `${name.replace(/[<>:"/\\|?*]/g, '-')}.svg`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function addPaperFigure(slide, pptx, figure) {
  const scale = Math.min(12.2 / figure.width, 5.7 / figure.height), ox = (13.333 - figure.width * scale) / 2, oy = 1.05 + (5.7 - figure.height * scale) / 2;
  const color = (value, fallback) => (value || fallback).replace('#', '');
  for (const e of figure.elements) {
    const line = { color: color(e.stroke === 'none' ? '#ffffff' : e.stroke, '#334155'), width: (e.strokeWidth ?? 1.5) * scale * 72, transparency: e.stroke === 'none' ? 100 : 0, dashType: e.dash ? 'dash' : 'solid' };
    const objectName = `figure:${e.id}`;
    if (e.type === 'line' || e.type === 'polyline') {
      e.points.slice(1).forEach((b, i) => {
        const a = e.points[i];
        slide.addShape(pptx.ShapeType.line, { x: ox + Math.min(a[0], b[0]) * scale, y: oy + Math.min(a[1], b[1]) * scale, w: Math.max(.001, Math.abs(b[0] - a[0]) * scale), h: Math.max(.001, Math.abs(b[1] - a[1]) * scale), flipH: b[0] < a[0], flipV: b[1] < a[1], line: { ...line, ...(e.arrowEnd && i === e.points.length - 2 ? { endArrowType: 'triangle' } : {}) }, objectName: `${objectName}:${i}` });
      });
    } else {
      const box = { x: ox + e.x * scale, y: oy + e.y * scale, w: e.width * scale, h: e.height * scale };
      if (e.type === 'text') slide.addText(e.text, { ...box, fontSize: (e.fontSize || 16) * scale * 72, bold: e.bold, color: color(e.color, '#1e293b'), margin: 0, breakLine: false, valign: 'top', align: e.align || 'left', fontFace: 'Microsoft YaHei', objectName });
      else slide.addShape(e.type === 'ellipse' ? pptx.ShapeType.ellipse : e.radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, { ...box, rectRadius: (e.radius || 0) * scale, radius: (e.radius || 0) * scale, line, fill: { color: color(e.fill === 'none' ? '#ffffff' : e.fill, '#ffffff'), transparency: !e.fill || e.fill === 'none' ? 100 : 0 }, objectName });
    }
  }
}

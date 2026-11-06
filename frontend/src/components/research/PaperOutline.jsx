import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function PaperOutline({ doc, reader }) {
  const [host, setHost] = useState(null);
  const [active, setActive] = useState('');
  const rail = useRef(null);
  useEffect(() => {
    const element = reader.current;
    const scroller = element?.closest('.rw-content');
    setHost(element?.closest('.rw-main'));
    if (!scroller) return;
    let frame;
    const update = () => {
      const top = scroller.getBoundingClientRect().top + 100;
      const paragraphs = [...element.querySelectorAll('.rw-paragraph')];
      const atBottom = scroller.scrollHeight > scroller.clientHeight + 2 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 3;
      const current = atBottom ? paragraphs.at(-1) : paragraphs.find((p) => p.getBoundingClientRect().bottom > top) || paragraphs.at(-1);
      if (current) setActive(current.dataset.paragraphId);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    scroller.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule); observer.observe(element); observer.observe(scroller);
    update();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); scroller.removeEventListener('scroll', schedule); };
  }, [doc, reader]);
  useEffect(() => {
    const list = rail.current, item = list?.querySelector('[aria-current="location"]');
    if (item) list.scrollTo({ left: item.offsetLeft - list.offsetLeft - (list.clientWidth - item.clientWidth) / 2, behavior: 'smooth' });
  }, [active]);
  if (!host || !doc.paragraphs.length) return null;
  return createPortal(<nav className="paper-outline-dock" aria-label="论文底部大纲">
    <div className="paper-outline-label"><strong>段落大纲</strong><small>{Math.max(1, doc.paragraphs.findIndex((p) => p.id === active) + 1)} / {doc.paragraphs.length}</small></div>
    <button aria-label="大纲向左滚动" onClick={() => rail.current.scrollBy({ left: -360, behavior: 'smooth' })}><ChevronLeft size={17} /></button>
    <div className="paper-outline-rail" ref={rail}>{doc.paragraphs.map((p, i) => <button key={p.id} aria-current={p.id === active ? 'location' : undefined} title={p.outline?.purpose || p.section || '尚未填写写作意图'} onClick={() => document.getElementById('paragraph-' + p.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
      <small>{String(i + 1).padStart(2, '0')} · {p.section || '正文'}</small><span>{p.outline?.purpose || '点击定位此段 · 可在蓝条中填写大纲'}</span>
    </button>)}</div>
    <button aria-label="大纲向右滚动" onClick={() => rail.current.scrollBy({ left: 360, behavior: 'smooth' })}><ChevronRight size={17} /></button>
  </nav>, host);
}

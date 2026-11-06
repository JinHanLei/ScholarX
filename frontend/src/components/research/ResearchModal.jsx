import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function ResearchModal({ title, subtitle, children, onClose, wide = false, className = '' }) {
  const ref = useRef(null);
  const titleId = React.useId();
  useEffect(() => { const el = ref.current; el.showModal(); return () => el.close(); }, []);
  return <dialog ref={ref} className={`rw-modal ${wide ? 'wide' : ''} ${className}`} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target !== ref.current) return; const r = ref.current.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); }}>
    <header className="rw-dialog-heading"><div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="rw-icon" aria-label="关闭弹窗" onClick={onClose}><X size={19} /></button></header>
    <div className="rw-modal-body">{children}</div>
  </dialog>;
}

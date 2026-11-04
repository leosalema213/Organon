import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import './modal.css';

// The shell owns spacing. Full application panels opt out of the padded body.
export default function Modal({ title, subtitle, onClose, children, small, wide, className = '', actions, panel = false }) {
  const ref = useRef();
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    const onKey = e => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current('escape'); }
      if (e.key === 'Tab') {
        const items = [...ref.current.querySelectorAll('button:not(:disabled), input, textarea, select, [tabindex="0"], [contenteditable="true"]')].filter(el => el.offsetParent !== null);
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose('outside')}><section ref={ref} className={`modal ${small ? 'small' : ''} ${wide ? 'wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}><div className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><div className="modal-heading-actions">{actions}<button type="button" className="icon-button" title="Fechar" aria-label="Fechar" onClick={() => onClose('close')}><X size={18} /></button></div></div>{panel ? children : <div className="modal-body">{children}</div>}</section></div>;
}

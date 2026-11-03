import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import './popup-menu.css';

export default function PopupMenu({ label, icon: Icon, items = [], className = 'primary', iconOnly = false, children, badge }) {
  const [open, setOpen] = useState(false), [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef(), menu = useRef(), buttons = useRef([]), initialFocus = useRef(0), id = useId();
  const enabled = items.map((item, i) => item.disabled ? -1 : i).filter(i => i >= 0);
  function close(focus = false) { setOpen(false); if (focus) trigger.current?.focus(); }
  function place() {
    const rect = trigger.current?.getBoundingClientRect(), panel = menu.current; if (!rect || !panel) return;
    const width = panel.offsetWidth, height = panel.offsetHeight;
    setPosition({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), top: rect.bottom + height + 14 <= window.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - height - 6) });
  }
  useLayoutEffect(() => { if (open) { place(); if (children) menu.current?.querySelector('button:not(:disabled),[tabindex="0"]')?.focus(); else buttons.current[initialFocus.current]?.focus(); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = e => { if (!menu.current?.contains(e.target) && !trigger.current?.contains(e.target)) close(); };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  function keydown(e) {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (children) return;
    else if (e.key === 'Tab') close(true);
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); const index = enabled.findIndex(i => buttons.current[i] === document.activeElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? enabled.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
      buttons.current[enabled[next]]?.focus();
    }
  }
  return <><button type="button" ref={trigger} className={className} aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined} aria-haspopup={children ? 'dialog' : 'menu'} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { initialFocus.current = enabled[0]; setOpen(!open); }} onKeyDown={e => { if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); initialFocus.current = e.key === 'ArrowUp' ? enabled.at(-1) : enabled[0]; setOpen(true); } }}>{Icon && <Icon size={16} />}{badge > 0 && <span className="popup-badge" aria-hidden="true">{badge > 99 ? '99+' : badge}</span>}{!iconOnly && <>{label}<ChevronDown size={13} /></>}</button>{open && createPortal(<div ref={menu} id={id} role={children ? 'dialog' : 'menu'} aria-label={label} className={`popup-menu${children ? ' popup-panel' : ''}`} style={position} onKeyDown={keydown}>{children ? children({ close: () => close(true) }) : items.map((item, i) => { const ItemIcon = item.icon; return <button type="button" role="menuitem" tabIndex={-1} ref={el => { buttons.current[i] = el; }} key={item.id} disabled={item.disabled} title={item.description} onClick={() => { close(); item.onSelect(); }}>{ItemIcon && <ItemIcon size={16} />}<span>{item.label}{item.description && <small>{item.description}</small>}</span></button>; })}</div>, document.body)}</>;
}

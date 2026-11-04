import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Maximize2, Minus, Plus, X } from 'lucide-react';
import { parseEbook, createEbookEngine } from './ebook-engine.js';

export default function ReflowReader({ book, onChange, onClose, saveError, onAnki }) {
  const [view, setView] = useState(book.view), [error, setError] = useState(''), [ready, setReady] = useState(false);
  const [fraction, setFraction] = useState(book.fraction || 0), [jump, setJump] = useState(Math.floor((book.fraction || 0) * 100));
  const root = useRef(), host = useRef(), engine = useRef(), latest = useRef();
  latest.current = { view, onChange, onClose };
  const settings = fields => {
    const next = { ...latest.current.view, ...fields }; latest.current.view = next; setView(next);
    latest.current.onChange(previous => ({ ...previous, view: next }));
    engine.current?.configure(next);
  };
  const fontBy = step => settings({ fontSize: Math.max(12, Math.min(36, (latest.current.view.fontSize || 20) + step)) });
  const wheel = event => { if (event.ctrlKey && event.deltaY) { event.preventDefault(); fontBy(event.deltaY < 0 ? 2 : -2); } };
  const keydown = event => {
    if ([...document.querySelectorAll('[role="dialog"]')].at(-1) !== root.current) return;
    if (event.key === 'Escape') { latest.current.onClose(); return; }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName) || event.ctrlKey || event.altKey || event.metaKey) return;
    if (['ArrowRight', 'PageDown', 'ArrowLeft', 'PageUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Home') engine.current?.jump(0);
      else if (event.key === 'End') engine.current?.jump(1);
      else if (['ArrowRight', 'PageDown'].includes(event.key)) engine.current?.next();
      else engine.current?.prev();
    }
  };
  useEffect(() => {
    let canceled = false, parsed, instance;
    const focus = document.activeElement; root.current.querySelector('button')?.focus();
    const trap = event => {
      if ([...document.querySelectorAll('[role="dialog"]')].at(-1) !== root.current) return;
      if (event.key !== 'Tab') { keydown(event); return; }
      const controls = [...root.current.querySelectorAll('button:not(:disabled),input,select,[tabindex="0"]')];
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    };
    window.addEventListener('keydown', trap);
    (async () => {
      const bytes = await window.desktop.books.read(book.hash, book.format);
      if (canceled) return;
      parsed = await parseEbook(new Uint8Array(bytes), book.format);
      if (canceled) { parsed.destroy(); return; }
      instance = createEbookEngine(parsed, host.current, { keydown, wheel, error: message => !canceled && setError(message), relocate: position => {
        if (canceled) return;
        setFraction(position.fraction); setJump(Math.floor(position.fraction * 100));
        latest.current.onChange(previous => ({ ...previous, location: position.location, fraction: position.fraction, furthestFraction: Math.max(previous.furthestFraction || 0, position.furthestFraction) }));
      } });
      engine.current = instance;
      await instance.open(latest.current.view, book.location);
      if (!canceled) setReady(true);
    })().catch(err => { if (!canceled) setError(`Não foi possível abrir o livro: ${err.message}`); });
    return () => { canceled = true; window.removeEventListener('keydown', trap); instance?.destroy(); engine.current = null; focus?.focus(); };
  }, [book.hash]);
  return <section ref={root} className="book-reader" role="dialog" aria-modal="true" aria-label={`Lendo ${book.title}`}>
    <header className="drag"><div><small>LEITURA · {book.format.toUpperCase()}</small><h2>{book.title}</h2></div><div className="reader-window-actions no-drag"><button title="Maximizar ou restaurar janela" aria-label="Maximizar ou restaurar janela" onClick={() => window.desktop?.maximize()}><Maximize2 size={18} /></button><button aria-label="Fechar leitor" onClick={onClose}><X size={20} /></button></div></header>
    <div className="reader-toolbar"><label>Páginas<select aria-label="Páginas por tela" value={view.spread} onChange={e => settings({ spread: Number(e.target.value) })}><option value="1">1</option><option value="2">2</option></select></label><label>Fonte<select aria-label="Tamanho da fonte" value={view.fontSize || 20} onChange={e => settings({ fontSize: Number(e.target.value) })}>{Array.from({ length: 13 }, (_, index) => 12 + index * 2).map(size => <option key={size} value={size}>{size}</option>)}</select></label><div className="reader-zoom-actions"><button disabled={(view.fontSize || 20) <= 12} aria-label="Diminuir fonte" title="Diminuir fonte · Ctrl + scroll" onClick={() => fontBy(-2)}><Minus size={15} /></button><button disabled={(view.fontSize || 20) >= 36} aria-label="Aumentar fonte" title="Aumentar fonte · Ctrl + scroll" onClick={() => fontBy(2)}><Plus size={15} /></button></div><label>Contraste<select aria-label="Contraste de leitura" value={view.contrast} onChange={e => settings({ contrast: e.target.value })}><option value="paper">Papel</option><option value="night">Noturno</option><option value="sepia">Sépia</option></select></label>{onAnki && <button type="button" className="secondary reader-anki" onClick={onAnki}><Copy size={15} />Anotar no Anki</button>}</div>
    <div className={`ebook-area ${view.contrast}`} tabIndex={0} aria-label="Área de leitura. Use as setas para mudar de página."><div ref={host} className="ebook-host" />{error ? <p className="ebook-message" role="alert">{error}</p> : !ready && <p className="ebook-message" role="status">Abrindo livro…</p>}</div>
    <footer><button aria-label="Página anterior" disabled={!ready || fraction <= 0} onClick={() => engine.current?.prev()}><ChevronLeft size={18} /></button><form onSubmit={event => { event.preventDefault(); engine.current?.jump(Math.max(0, Math.min(100, Number(jump))) / 100); }}><label>Posição <input aria-label="Ir para porcentagem" type="number" min="0" max="100" value={jump} onChange={e => setJump(e.target.value)} /></label><span>%</span><button type="submit" disabled={!ready}>Ir</button></form><button aria-label="Próxima página" disabled={!ready || fraction >= 1} onClick={() => engine.current?.next()}><ChevronRight size={18} /></button><span className={saveError ? 'reader-save-error' : ''} role="status">{saveError ? 'Falha ao salvar posição. Exporte um backup.' : 'Posição salva automaticamente'}</span></footer>
  </section>;
}

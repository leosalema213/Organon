import React, { useEffect, useRef, useState } from 'react';
import { loadPdf, TextLayer } from './pdf-runtime.js';
import { ChevronLeft, ChevronRight, Copy, Maximize2, Minus, Plus, X } from 'lucide-react';
import { bookPosition } from './books.js';

function PdfPage({ pdf, number, scale, onReady, onError }) {
  const canvas = useRef(), text = useRef(), [size, setSize] = useState(null);
  useEffect(() => {
    const target = canvas.current, textContainer = text.current;
    if (!target || !textContainer) return;
    let canceled = false, render, layer;
    (async () => {
      const page = await pdf.getPage(number);
      if (canceled) return;
      const viewport = page.getViewport({ scale }), ratio = Math.min(window.devicePixelRatio || 1, 2);
      setSize({ width: viewport.width, height: viewport.height });
      target.width = Math.ceil(viewport.width * ratio); target.height = Math.ceil(viewport.height * ratio);
      target.style.width = `${viewport.width}px`; target.style.height = `${viewport.height}px`;
      render = page.render({ canvasContext: target.getContext('2d'), viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await render.promise;
      if (canceled) return;
      textContainer.replaceChildren();
      textContainer.style.setProperty('--total-scale-factor', scale);
      layer = new TextLayer({ textContentSource: page.streamTextContent(), container: textContainer, viewport });
      await layer.render();
      if (!canceled) onReady(number);
    })().catch(error => { if (!canceled) onError(error.message); });
    return () => { canceled = true; render?.cancel(); layer?.cancel(); };
  }, [pdf, number, scale]);
  return <div className="pdf-sheet" style={size || undefined} role="document" aria-label={`Página ${number}`}><canvas ref={canvas} aria-hidden="true" /><div className="textLayer" ref={text} /></div>;
}

export default function PdfReader({ book, onChange, onClose, saveError, onAnki }) {
  const [pdf, setPdf] = useState(null), [error, setError] = useState('');
  const [number, setNumber] = useState(book.page), [jump, setJump] = useState(String(book.page));
  const [view, setView] = useState(book.view), [dimensions, setDimensions] = useState({ width: 800, height: 650 }), [pageSize, setPageSize] = useState({ width: 595, height: 842 });
  const root = useRef(), area = useRef(), latest = useRef(); latest.current = { onChange, onClose, number, view, pdf };
  useEffect(() => {
    let canceled = false, task;
    window.desktop.books.read(book.hash).then(bytes => {
      if (canceled) return;
      task = loadPdf(bytes);
      task.onPassword = () => { setError('Este PDF exige senha. Nesta versão, importe uma cópia sem proteção.'); task.destroy(); };
      return task.promise;
    }).then(async document => {
      if (!document || canceled) return;
      const page = await document.getPage(1), size = page.getViewport({ scale: 1 });
      if (canceled) return;
      setPageSize({ width: size.width, height: size.height });
      setNumber(value => Math.min(value, document.numPages)); setPdf(document);
    }).catch(err => { if (!canceled) setError(`Não foi possível abrir o PDF: ${err.message}`); });
    return () => { canceled = true; task?.destroy(); };
  }, [book.hash]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height }));
    if (area.current) observer.observe(area.current);
    return () => observer.disconnect();
  }, []);
  const go = value => { if (latest.current.pdf) setNumber(Math.max(1, Math.min(latest.current.pdf.numPages, value))); };
  const zoomBy = direction => {
    const levels = [0.5, 0.75, 1, 1.25, 1.5, 2, 3], current = latest.current.view.zoom;
    settings({ zoom: direction > 0 ? levels.find(level => level > current) || 3 : levels.findLast(level => level < current) || 0.5 });
  };
  useEffect(() => {
    const element = area.current;
    const wheel = event => { if (event.ctrlKey && event.deltaY) { event.preventDefault(); zoomBy(event.deltaY < 0 ? 1 : -1); } };
    element?.addEventListener('wheel', wheel, { passive: false });
    return () => element?.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => { setJump(String(number)); if (area.current) area.current.scrollTo(0, 0); }, [number]);
  useEffect(() => {
    const previousFocus = document.activeElement;
    root.current?.querySelector('button')?.focus();
    const handle = event => {
      if ([...document.querySelectorAll('[role="dialog"]')].at(-1) !== root.current) return;
      if (event.key === 'Tab') {
        const controls = [...root.current.querySelectorAll('button:not(:disabled), input, select, [tabindex="0"]')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        return;
      }
      if (event.key === 'Escape') { latest.current.onClose(); return; }
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName) || event.ctrlKey || event.altKey || event.metaKey) return;
      const state = latest.current;
      if (['ArrowRight', 'PageDown', 'ArrowLeft', 'PageUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        if (event.key === 'Home') go(1);
        else if (event.key === 'End') go(state.pdf?.numPages || 1);
        else go(state.number + (['ArrowRight', 'PageDown'].includes(event.key) ? 1 : -1) * state.view.spread);
      }
    };
    window.addEventListener('keydown', handle); return () => { window.removeEventListener('keydown', handle); previousFocus?.focus(); };
  }, []);
  function settings(fields) {
    latest.current.view = { ...latest.current.view, ...fields };
    setView(previous => ({ ...previous, ...fields }));
    onChange(previous => ({ ...previous, view: { ...previous.view, ...fields } }));
  }
  const scale = Math.max(0.1, Math.min((dimensions.width - 60) / view.spread / pageSize.width, (dimensions.height - 36) / pageSize.height)) * view.zoom;
  const ready = page => latest.current.onChange(previous => ({ ...bookPosition(previous, latest.current.number, latest.current.pdf.numPages), furthestPage: Math.max(previous.furthestPage, page) }));
  return <section ref={root} className="book-reader" role="dialog" aria-modal="true" aria-label={`Lendo ${book.title}`}>
    <header className="drag"><div><small>LEITURA · PDF</small><h2>{book.title}</h2></div><div className="reader-window-actions no-drag"><button title="Maximizar ou restaurar janela" aria-label="Maximizar ou restaurar janela" onClick={() => window.desktop?.maximize()}><Maximize2 size={18} /></button><button onClick={onClose} aria-label="Fechar leitor"><X size={20} /></button></div></header>
    <div className="reader-toolbar">
      <label>Páginas<select aria-label="Páginas por tela" value={view.spread} onChange={e => settings({ spread: Number(e.target.value) })}><option value="1">1</option><option value="2">2</option></select></label>
      <label>Zoom<select aria-label="Zoom do PDF" value={view.zoom} onChange={e => settings({ zoom: Number(e.target.value) })}>{[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map(zoom => <option key={zoom} value={zoom}>{zoom === 1 ? 'Ajustar à tela' : `${zoom * 100}%`}</option>)}</select></label>
      <div className="reader-zoom-actions"><button aria-label="Diminuir zoom" title="Diminuir zoom · Ctrl + scroll" disabled={view.zoom <= 0.5} onClick={() => zoomBy(-1)}><Minus size={15} /></button><button aria-label="Aumentar zoom" title="Aumentar zoom · Ctrl + scroll" disabled={view.zoom >= 3} onClick={() => zoomBy(1)}><Plus size={15} /></button></div>
      <label>Contraste<select aria-label="Contraste de leitura" value={view.contrast} onChange={e => settings({ contrast: e.target.value })}><option value="paper">Papel</option><option value="night">Noturno</option><option value="sepia">Sépia</option></select></label>
      {onAnki && <button type="button" className="secondary reader-anki" onClick={onAnki}><Copy size={15} />Anotar no Anki</button>}
    </div>
    <div ref={area} className={`reader-pages ${view.contrast}`} tabIndex={0} aria-label="Área de leitura. Use as setas para mudar de página.">
      {error ? <p role="alert">{error}</p> : !pdf ? <p role="status">Abrindo livro…</p> : <div className="pdf-spread">{Array.from({ length: Math.min(view.spread, pdf.numPages - number + 1) }, (_, index) => <PdfPage key={`${number + index}:${scale}`} pdf={pdf} number={number + index} scale={scale} onReady={ready} onError={setError} />)}</div>}
    </div>
    <footer><button aria-label="Página anterior" disabled={!pdf || number === 1} onClick={() => go(number - view.spread)}><ChevronLeft size={18} /></button><form onSubmit={e => { e.preventDefault(); go(Number(jump) || 1); }}><label>Página <input aria-label="Ir para página" type="number" min="1" max={pdf?.numPages || 1} value={jump} onChange={e => setJump(e.target.value)} /></label><span>de {pdf?.numPages || '…'}</span><button type="submit" disabled={!pdf}>Ir</button></form><button aria-label="Próxima página" disabled={!pdf || number + view.spread > pdf.numPages} onClick={() => go(number + view.spread)}><ChevronRight size={18} /></button><span className={saveError ? 'reader-save-error' : ''} role="status">{saveError ? 'Falha ao salvar posição. Exporte um backup.' : 'Posição salva automaticamente · ← → para navegar'}</span></footer>
  </section>;
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CaptureUpdateAction, Excalidraw, MainMenu, reconcileElements, restoreElements } from '@excalidraw/excalidraw';
import { Maximize, Minimize } from 'lucide-react';
import { boardChange, boardScene, boardText, mergeBoards, validBoard } from './board-data.js';
import { notebookEqual } from './shared-notebook-merge.js';
import { isNoteImage } from './note-document.js';
import { trackImageTask } from './images.js';
import '@excalidraw/excalidraw/index.css';
import './notebook-board.css';

// Excalidraw can paste SVG/GIF images; persist a portable raster supported by backups/Storage.
async function portableImage(file) {
  if (isNoteImage(file.dataURL)) return file;
  if (!/^data:image\/(svg\+xml|gif|avif|bmp)[;,]/.test(file.dataURL)) throw new Error('Use uma imagem PNG, JPG, WebP, SVG, GIF, AVIF ou BMP.');
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Não foi possível ler a imagem da tela de desenho.')); image.src = file.dataURL; });
  const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return { ...file, dataURL: canvas.toDataURL('image/png'), mimeType: 'image/png' };
}

export default function NotebookBoard({ page, onChange, readOnly, shared, saveLabel, saveError, notify, scope }) {
  const host = useRef(), api = useRef(), alive = useRef(false), applying = useRef(false), dragging = useRef(false);
  const latest = useRef(page.board), pending = useRef(null), normalized = useRef(new Map()), request = useRef(0);
  const fullscreenQueue = useRef(Promise.resolve());
  const handlers = useRef(); handlers.current = { onChange, readOnly, notify };
  const [ready, setReady] = useState(false), [fullscreen, setFullscreen] = useState(false), [issue, setIssue] = useState('');
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const cameraKey = `organon:board-camera:${scope}:${page.id}`;
  const initial = useRef(null);
  if (!initial.current) {
    let camera = {};
    try { const value = JSON.parse(sessionStorage.getItem(cameraKey) || 'null'); if (Number.isFinite(value?.scrollX) && Number.isFinite(value?.scrollY) && Number.isFinite(value?.zoom?.value)) camera = value; } catch { /* Camera is optional. */ }
    initial.current = { elements: page.board.elements, files: page.board.files, appState: { ...camera, viewBackgroundColor: '#ffffff' } };
  }
  useEffect(() => {
    alive.current = true;
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const changed = () => setFullscreen(document.fullscreenElement === host.current);
    const escape = event => {
      if (event.key !== 'Escape' || document.fullscreenElement !== host.current) return;
      event.preventDefault(); event.stopImmediatePropagation();
      changeFullscreen(false);
    };
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('keydown', escape, true);
    return () => { alive.current = false; observer.disconnect(); document.removeEventListener('fullscreenchange', changed); document.removeEventListener('keydown', escape, true); };
  }, []);

  function receive(board) {
    if (!api.current) return;
    if (dragging.current) { pending.current = board; return; }
    const local = boardChange(latest.current, api.current.getSceneElementsIncludingDeleted(), api.current.getFiles());
    const next = mergeBoards(local, board);
    latest.current = next;
    if (notebookEqual(local, next)) return;
    applying.current = true;
    try {
      api.current.addFiles(Object.values(next.files));
      const elements = reconcileElements(api.current.getSceneElementsIncludingDeleted(), restoreElements(next.elements, null), api.current.getAppState());
      api.current.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
    } finally { applying.current = false; }
  }
  useLayoutEffect(() => {
    if (ready && !notebookEqual(latest.current, page.board)) receive(page.board);
  }, [page.board, ready]);

  function publish(elements, files) {
    if (!alive.current || handlers.current.readOnly || applying.current) return;
    const next = boardChange(latest.current, elements, files);
    if (notebookEqual(latest.current, next)) return;
    if (!validBoard(next)) { setIssue('Não foi possível salvar este conteúdo da tela de desenho. Remova o último item ou desfaça a alteração.'); return; }
    latest.current = next; setIssue('');
    handlers.current.onChange({ board: next, text: boardText(next), images: [] });
  }
  function change(elements, state, files) {
    if (applying.current || handlers.current.readOnly) return;
    const referenced = boardScene(elements, files).files;
    if (Object.values(referenced).every(file => isNoteImage(file.dataURL))) { request.current++; publish(elements, referenced); return; }
    const current = ++request.current;
    trackImageTask(Promise.all(Object.values(referenced).map(file => {
      if (!normalized.current.has(file.dataURL)) normalized.current.set(file.dataURL, portableImage(file));
      return normalized.current.get(file.dataURL);
    })).then(result => {
      if (current !== request.current || handlers.current.readOnly) return;
      const portable = Object.fromEntries(result.map(file => [file.id, file]));
      if (!alive.current) {
        const next = boardChange(latest.current, elements, portable);
        if (validBoard(next)) handlers.current.onChange({ board: next, text: boardText(next), images: [] });
        return;
      }
      applying.current = true;
      try { api.current.addFiles(result); } finally { applying.current = false; }
      publish(api.current.getSceneElementsIncludingDeleted(), portable);
    }).catch(error => { if (current === request.current) { if (alive.current) setIssue(error.message); else handlers.current.notify(error.message); } }));
  }
  function changeFullscreen(enter) {
    // Both exits use the same API, after any pending entry has finished. A fast
    // Escape must not race the native fullscreen transition or the editor's keys.
    fullscreenQueue.current = fullscreenQueue.current.then(async () => {
      const element = host.current;
      if (!element) return;
      if (enter && document.fullscreenElement !== element) await element.requestFullscreen();
      else if (!enter && document.fullscreenElement === element) await document.exitFullscreen();
    }).catch(() => { if (alive.current) handlers.current.notify('Não foi possível alterar a tela cheia da tela de desenho.'); });
    return fullscreenQueue.current;
  }
  function expand() { return changeFullscreen(document.fullscreenElement !== host.current); }
  return <div className="notebook-board" ref={host} aria-label="Tela de desenho da página">
    <div className="notebook-board-heading">
      <input aria-label="Título da página" maxLength={160} placeholder="Tela de desenho sem título" value={page.title} disabled={readOnly} onChange={event => onChange({ title: event.target.value })} />
      <span role="status" className={saveError ? 'has-error' : ''}>{saveError ? 'Falha ao salvar' : saveLabel || (readOnly ? 'Somente leitura' : 'Salvo automaticamente')}</span>
      <button type="button" className="secondary" onClick={expand}>{fullscreen ? <Minimize size={14} /> : <Maximize size={14} />}{fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}</button>
    </div>
    {issue && <p role="alert" className="form-error notebook-board-error">{issue}</p>}
    <div className="notebook-board-canvas">
      <Excalidraw initialData={initial.current} excalidrawAPI={value => { api.current = value; setReady(true); }} onChange={change}
        langCode="pt-BR" theme={theme} name={page.title || 'Tela de desenho'} viewModeEnabled={readOnly} isCollaborating={shared} aiEnabled={false} validateEmbeddable={false}
        onLinkOpen={(_element, event) => event.preventDefault()} handleKeyboardGlobally={false}
        onPointerDown={() => { dragging.current = true; }} onPointerUp={() => { dragging.current = false; if (pending.current) { const board = pending.current; pending.current = null; queueMicrotask(() => { if (alive.current) receive(board); }); } }}
        onScrollChange={(scrollX, scrollY, zoom) => { try { sessionStorage.setItem(cameraKey, JSON.stringify({ scrollX, scrollY, zoom })); } catch { /* Never block drawing for optional camera storage. */ } }}
        UIOptions={{ canvasActions: { changeViewBackgroundColor: false, toggleTheme: false, saveToActiveFile: false, loadScene: !readOnly, clearCanvas: !readOnly, export: { saveFileToDisk: true } } }}>
        <MainMenu>{!readOnly && <MainMenu.DefaultItems.LoadScene />}<MainMenu.DefaultItems.Export /><MainMenu.DefaultItems.SaveAsImage />{!readOnly && <MainMenu.DefaultItems.ClearCanvas />}<MainMenu.DefaultItems.Help /></MainMenu>
      </Excalidraw>
    </div>
  </div>;
}

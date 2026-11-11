import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Check, Download, Ellipsis, FileText, ImagePlus, NotebookPen, Pencil, PenLine, Plus, Search, Share2, SquarePen, Trash2, Users, X } from 'lucide-react';
import { newNotebook, newPage, seed, validateData } from './model.js';
import CoverPicker, { coverIcons } from './CoverPicker.jsx';
import { customCoverStyle } from './book-appearance.js';
import { documentHeadings, isNoteImage } from './note-document.js';
import { optimizeImage } from './images.js';
import PopupMenu from './PopupMenu.jsx';
import ShareResources from './teams/ShareResources.jsx';
import SharedNotebookReader from './SharedNotebookReader.jsx';
import { useSharedNotebooks } from './shared-notebooks.js';
import { notebookEqual } from './shared-notebook-merge.js';
import { notebookLibrary, personalNotebookCopy, resourceShares, removeResourceShares } from './shared-resources.js';

const NoteEditor = lazy(() => import('./NoteEditor.jsx'));
const NotebookBoard = lazy(() => {
  window.EXCALIDRAW_ASSET_PATH = new URL('./excalidraw/', document.baseURI).href;
  return import('./NotebookBoard.jsx');
});
function indexedTitle(page) { return page.title.trim() || documentHeadings(page.document).find(heading => heading.text.trim())?.text || ''; }
function IconButton({ label, children, ...props }) { return <button type="button" className="icon-button" aria-label={label} title={label} {...props}>{children}</button>; }
function BookCover({ book, small = false }) {
  const Icon = book.icon === 'none' ? null : coverIcons[book.icon] || BookOpen;
  return <div className={`journal-cover cover-${book.color.startsWith('#') ? 'custom' : book.color} ${small ? 'small-cover' : ''}`} style={customCoverStyle(book.color)}>{book.cover && <img src={book.cover} alt="" />}{Icon && <span><Icon size={small ? 18 : 30} strokeWidth={1.4} /></span>}</div>;
}

export default function Library({ notebooks, onChange, notify, saveError, Modal, Sketch, business, user, initialBookId = null, onBack, readOnly = false, sharedView = false, saveLabel, headerMark, headerActions }) {
  const [bookId, setBookId] = useState(initialBookId);
  const [pageId, setPageId] = useState(null);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState(null);
  const [loadingCover, setLoadingCover] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [sketch, setSketch] = useState(null);
  const [sharing, setSharing] = useState(null), [copying, setCopying] = useState(false), [deletingBusy, setDeletingBusy] = useState(false), [deleteError, setDeleteError] = useState('');
  const mounted = useRef(false), working = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const shared = useSharedNotebooks(business?.api, user?.id, business?.spaces);
  const library = notebookLibrary(notebooks, shared.notebooks);
  const editor = useRef(); const file = useRef(); const insertion = useRef(); const sheet = useRef();
  const book = library.find(item => item.notebook.id === bookId)?.notebook;
  const page = book?.pages.find(item => item.id === pageId) || book?.pages[0];
  const headings = documentHeadings(page?.document);
  const filtered = book?.pages.filter(item => `${item.title} ${item.text}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))) || [];

  function editPage(id, changes) {
    if (readOnly) return;
    const origin = book.id;
    onChange(current => current.map(item => item.id === origin ? { ...item, pages: item.pages.map(value => value.id === id ? { ...value, ...changes } : value) } : item));
  }
  function openBook(value) { setBookId(value.id); setPageId(value.pages[0]?.id || null); setQuery(''); }
  function selectPage(id) { setPageId(id); if (sheet.current) sheet.current.scrollTop = 0; }
  function addPage(kind = 'text') {
    if (readOnly) return;
    const next = newPage(kind);
    onChange(current => current.map(item => item.id === book.id ? { ...item, pages: [...item.pages, next] } : item));
    setPageId(next.id); setQuery(''); if (sheet.current) sheet.current.scrollTop = 0;
  }
  async function saveBook(event, publish = false) {
    event.preventDefault(); if (readOnly || !draft.name.trim() || loadingCover) return;
    const value = { ...draft, name: draft.name.trim() };
    if (!sharedView && business) {
      try {
        for (const copy of shared.notebooks.filter(item => item.id === value.id && item.publishedBy === user?.id)) {
          const opened = await business.api.call('teams', 'openResource', { orgId: copy.orgId, module: 'notebooks', resourceId: copy.id });
          const content = { ...opened.content, name: value.name, icon: value.icon, color: value.color, cover: value.cover };
          if (!notebookEqual(content, opened.content)) await business.api.call('teams', 'editResource', { orgId: copy.orgId, module: 'notebooks', resourceId: copy.id, revision: opened.revision, content });
        }
      } catch (error) { notify(`Não foi possível atualizar todos os compartilhamentos. Tente novamente. ${error.message}`); business.api.refresh(); return; }
      business.api.refresh();
    }
    const saved = await onChange(current => current.some(item => item.id === value.id) ? current.map(item => item.id === value.id ? { ...item, name: value.name, icon: value.icon, color: value.color, cover: value.cover } : item) : [...current, value], publish);
    if (saved === false) { notify('Não foi possível salvar o caderno. Tente novamente.'); return; }
    if (!notebooks.some(item => item.id === value.id)) openBook(value);
    setDraft(null);
    if (publish) share(value);
  }
  async function coverImage(image) {
    if (!image) return;
    const id = draft.id; setLoadingCover(true);
    try { const src = await optimizeImage(image); if (isNoteImage(src)) setDraft(current => current?.id === id ? { ...current, cover: src } : current); }
    catch (error) { notify(error.message); }
    finally { setLoadingCover(false); }
  }
  function pickImage() {
    if (!editor.current) return;
    insertion.current = { editor: editor.current, token: editor.current.capture() }; file.current.click();
  }
  function closeSketch() { sketch?.editor.cancel(sketch.token); setSketch(null); }
  function share(value) {
    if (!user) { notify('Entre na sua conta para compartilhar cadernos.'); return; }
    setSharing({ resources: value ? [value] : notebooks, single: !!value, userId: user.id });
  }
  async function saveCopy(value) {
    if (working.current) return;
    working.current = true; setCopying(true);
    try {
      const result = await business.api.call('teams', 'openResource', { orgId: value.orgId, module: 'notebooks', resourceId: value.id });
      const copy = validateData({ ...seed(), notebooks: [personalNotebookCopy(result.content)] }).notebooks[0];
      if (!mounted.current) return;
      if (!await onChange(current => current.some(item => item.id === copy.id) ? current : [...current, copy], true)) throw new Error('Não foi possível salvar a cópia neste dispositivo.');
      if (mounted.current) notify('Cópia salva nos seus cadernos.');
    } catch (error) { if (mounted.current) notify(`Não foi possível baixar a cópia. ${error.message}`); }
    finally { working.current = false; if (mounted.current) setCopying(false); }
  }
  function notebookMenu(value) {
    if (!value.orgId) return [
      { id: 'edit', label: 'Editar caderno', icon: Pencil, onSelect: () => setDraft({ ...value }) },
      { id: 'share', label: 'Compartilhar caderno', icon: Share2, onSelect: () => share(value) },
    ];
    return [
      { id: 'download', label: copying ? 'Baixando cópia…' : 'Baixar cópia', icon: Download, disabled: copying, onSelect: () => saveCopy(value) },
      ...(shared.notebooks.some(item => item.id === value.id && item.publishedBy === user?.id) ? [
        { id: 'share', label: 'Gerenciar compartilhamento', icon: Share2, onSelect: () => share(value) },
        { id: 'delete', label: 'Excluir compartilhamento', icon: Trash2, onSelect: () => { setDeleteError(''); setDeleting({ kind: 'book', bookId: value.id, name: value.name, shared: true }); } },
      ] : []),
    ];
  }
  async function remove() {
    if (readOnly || working.current) return;
    working.current = true; setDeletingBusy(true); setDeleteError('');
    try {
    if (deleting.kind === 'book') {
      if (user && business) {
        const spaces = await business.api.call('teams', 'list');
        const entries = await Promise.all(spaces.map(async space => ({ space, ...resourceShares(await business.api.call('teams', 'resources', { orgId: space.id }), 'notebooks', { id: deleting.bookId }, user.id, space.owner_id) })));
        for (const { space, own } of entries) {
          if (!mounted.current) return;
          await removeResourceShares(business.api, space.id, 'notebooks', own, () => mounted.current);
        }
      }
      if (!mounted.current) return;
      if (!deleting.shared && await onChange(current => current.filter(item => item.id !== deleting.bookId), true) === false) throw new Error('As publicações foram retiradas, mas não foi possível salvar a exclusão local.');
      setBookId(null); setPageId(null);
    } else {
      onChange(current => current.map(item => item.id === deleting.bookId ? { ...item, pages: item.pages.filter(value => value.id !== deleting.id) } : item));
      if (page?.id === deleting.id) setPageId(book.pages.find(value => value.id !== deleting.id)?.id || null);
    }
    setDeleting(null);
    } catch (error) { if (mounted.current) setDeleteError(`Não foi possível concluir a exclusão. Tente novamente. ${error.message}`); }
    finally { working.current = false; if (mounted.current) { setDeletingBusy(false); business?.api.refresh(); } }
  }
  const sharedBook = book?.orgId ? book : book && shared.notebooks.find(item => item.id === book.id && item.publishedBy === user?.id);
  if (sharedBook) return <SharedNotebookReader key={`${user?.id}:${sharedBook.orgId}:${sharedBook.id}`} userId={user.id} notebook={sharedBook} api={business.api} onClose={() => setBookId(null)} onCopy={() => saveCopy(sharedBook)} onSynced={sharedBook.publishedBy === user?.id ? content => onChange(current => current.map(item => item.id === content.id ? personalNotebookCopy(content) : item)) : undefined} copying={copying} notify={notify} Modal={Modal} Sketch={Sketch} Editor={Library} />;
  return <div className={`journal-area${book ? ' journal-opened' : ''}`}>
    <div className="journal-heading">{book ? <><IconButton label="Todos os cadernos" onClick={onBack || (() => setBookId(null))}><ArrowLeft size={19} /></IconButton><BookCover book={book} small /><h1>{book.name}</h1>{headerMark}{!readOnly && <><IconButton label="Editar caderno" onClick={() => setDraft({ ...book })}><Pencil size={15} /></IconButton><PopupMenu label="Nova" icon={Plus} items={[{ id: 'text', label: 'Página', icon: FileText, onSelect: () => addPage() }, { id: 'board', label: 'Tela de desenho', icon: SquarePen, onSelect: () => addPage('board') }]} /></>}{headerActions}</> : <><h1>Cadernos</h1><div className="button-row"><button className="primary" onClick={() => setDraft(newNotebook())}><Plus size={16} />Novo caderno</button>{business && <IconButton label="Compartilhar cadernos" disabled={!notebooks.length} onClick={() => share()}><Share2 size={15} /></IconButton>}</div></>}</div>
    {!book ? <>
      {shared.loading && <p role="status" className="muted">Buscando cadernos compartilhados…</p>}
      {shared.error && <p role="alert" className="form-error">Não foi possível consultar todos os espaços de cadernos compartilhados. <button className="secondary" onClick={shared.retry}>Tentar novamente</button></p>}
      {!library.length ? <div className="journal-empty"><NotebookPen size={34} strokeWidth={1.3} /><h2>Um lugar para suas ideias</h2><p>Diário, casa, pensamentos. Cada caderno, um espaço seu.</p><button className="secondary" onClick={() => setDraft(newNotebook())}><Plus size={15} />Criar caderno</button></div> : <div className="journal-grid">{library.map(({ notebook: value, orgIds }) => <article className="journal-card" key={value.id}><button className="journal-open" aria-label={`Abrir caderno ${value.name}`} onClick={() => openBook(value)}><BookCover book={value} /><div><h2>{value.name}</h2><small>{value.pages.length} {value.pages.length === 1 ? 'página' : 'páginas'}</small>{orgIds.size > 0 && <span className="journal-shared-mark" role="img" aria-label="Caderno compartilhado" title={`Compartilhado · ${business.spaces.filter(space => orgIds.has(space.id)).map(space => space.name).join(', ')}`}><Users size={14} /></span>}</div></button>{value.orgId ? <PopupMenu label={`Opções de ${value.name}`} icon={Ellipsis} iconOnly className="icon-button journal-options" items={notebookMenu(value)} /> : <IconButton label={`Editar caderno ${value.name}`} onClick={() => setDraft({ ...value })}><Pencil size={14} /></IconButton>}</article>)}</div>}
    </> : <div className="journal-layout">
      <aside className="journal-index" aria-label="Índice do caderno"><div className="journal-index-title"><span>PÁGINAS</span><span>{book.pages.length}</span></div><label className="notebook-search"><Search size={13} /><input aria-label="Buscar páginas" placeholder="Buscar páginas" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="journal-pages">{filtered.map(value => <div className={`journal-page-row ${value.id === page?.id ? 'selected' : ''}`} key={value.id}><button aria-current={value.id === page?.id ? 'page' : undefined} onClick={() => selectPage(value.id)}>{value.kind === 'board' ? <SquarePen size={14} /> : <FileText size={14} />}<span>{indexedTitle(value) || `${value.kind === 'board' ? 'Tela de desenho' : 'Página'} ${book.pages.indexOf(value) + 1}`}</span></button>{!readOnly && <IconButton label={`Excluir página ${indexedTitle(value) || book.pages.indexOf(value) + 1}`} onClick={() => { setDeleteError(''); setDeleting({ kind: 'page', bookId: book.id, id: value.id, name: indexedTitle(value) || 'Sem título' }); }}><X size={12} /></IconButton>}</div>)}{!filtered.length && <p className="journal-no-results">{query ? 'Nenhuma página encontrada.' : 'Nenhuma página.'}</p>}</div>
        {!!headings.length && <nav className="journal-outline" aria-label="Títulos desta página"><span>NESTA PÁGINA</span>{headings.map((heading, index) => <button key={index} style={{ paddingLeft: 8 + (heading.level - 1) * 10 }} onClick={() => editor.current?.goToHeading(index)}>{heading.text || 'Título sem texto'}</button>)}</nav>}
      </aside>
      <section className="journal-document" aria-label="Página do caderno">{page?.kind === 'board' ? <Suspense fallback={<p className="muted" role="status">Abrindo tela de desenho…</p>}><NotebookBoard key={page.id} page={page} scope={`${book.orgId || (sharedView ? 'shared' : 'local')}:${book.id}`} onChange={changes => editPage(page.id, changes)} readOnly={readOnly} shared={sharedView} saveLabel={saveLabel} saveError={saveError} notify={notify} /></Suspense> : page ? <>
        <div className="journal-page-tools"><span className={saveError ? 'has-error' : ''}><Check size={12} />{saveError ? 'Falha ao salvar' : saveLabel || 'Salvo automaticamente'}</span>{!readOnly && <div><button className="notebook-tool" onClick={pickImage}><ImagePlus size={15} />Imagem</button><button className="notebook-tool" onClick={() => editor.current && setSketch({ editor: editor.current, token: editor.current.capture() })}><PenLine size={15} />Rabiscar</button></div>}</div>
        <div className="journal-sheet" ref={sheet}><div className="journal-paper"><time dateTime={page.date}>{new Date(`${page.date}T12:00:00`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}</time><input className="notebook-title" aria-label="Título da página" maxLength={160} placeholder="Sem título" value={page.title} disabled={readOnly} onChange={event => editPage(page.id, { title: event.target.value })} />
          <Suspense fallback={<p className="muted">Abrindo página…</p>}><NoteEditor key={`${page.id}:${readOnly}`} note={page} ref={editor} rich disabled={readOnly} syncExternal={sharedView} onChange={changes => editPage(page.id, changes)} notify={notify} /></Suspense>
        </div></div>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden multiple onCancel={() => { const value = insertion.current; if (value) value.editor.cancel(value.token); insertion.current = null; }} onChange={event => { const value = insertion.current; if (value) value.editor.images([...event.target.files], value.token); insertion.current = null; event.target.value = ''; }} />
      </> : <div className="journal-empty"><FileText size={28} /><p>{readOnly ? 'Nenhuma página neste caderno.' : 'Use Nova para adicionar uma página ou tela de desenho.'}</p></div>}</section>
    </div>}
    {draft && <Modal title={notebooks.some(item => item.id === draft.id) ? 'Editar caderno' : 'Novo caderno'} onClose={() => setDraft(null)} small className="journal-book-modal" actions={business && <IconButton label="Compartilhar caderno" disabled={loadingCover || !draft.name.trim()} onClick={event => saveBook(event, true)}><Share2 size={14} /></IconButton>}><form className="journal-book-form" onSubmit={saveBook}>
      <BookCover book={draft} /><label>Nome<input autoFocus required maxLength={80} aria-label="Nome do caderno" placeholder="Meu diário" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <CoverPicker Modal={Modal} icon={draft.icon} color={draft.color} onChange={changes => setDraft(current => ({ ...current, ...changes }))} />
      <div className="journal-cover-actions"><label className="secondary"><ImagePlus size={15} />{loadingCover ? 'Carregando…' : 'Escolher capa'}<input type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label="Imagem de capa" onChange={event => { coverImage(event.target.files[0]); event.target.value = ''; }} /></label>{draft.cover && <button type="button" className="notebook-tool" onClick={() => setDraft({ ...draft, cover: null })}>Remover capa</button>}</div>
      <div className="modal-actions">{!sharedView && notebooks.some(item => item.id === draft.id) && <IconButton label="Excluir caderno" onClick={() => { setDeleteError(''); setDeleting({ kind: 'book', bookId: draft.id, name: draft.name }); setDraft(null); }}><Trash2 size={16} /></IconButton>}<button type="button" className="secondary" onClick={() => setDraft(null)}>Cancelar</button><button type="submit" className="primary" disabled={loadingCover || !draft.name.trim()}>Salvar</button></div>
    </form></Modal>}
    {sketch && <Sketch onClose={closeSketch} onSave={src => { sketch.editor.insert(src, sketch.token); setSketch(null); }} />}
    {sharing && sharing.userId === user?.id && <ShareResources key={user.id} api={business.api} spaces={business.spaces} userId={user.id} module="notebooks" resources={sharing.resources} single={sharing.single} onClose={() => setSharing(null)} notify={notify} />}
    {deleting && <Modal title={deleting.kind === 'book' ? 'Excluir caderno?' : 'Excluir página?'} onClose={() => { if (!deletingBusy) setDeleting(null); }} small><div className="note-delete-body"><Trash2 size={22} /><p><strong>{deleting.name}</strong></p><p>{deleting.kind === 'book' ? deleting.shared ? 'Suas publicações deste caderno serão retiradas dos espaços.' : 'Todas as páginas, imagens e desenhos deste caderno serão removidos. Suas publicações também serão retiradas dos espaços.' : 'O conteúdo desta página será removido.'}</p>{deleting.kind === 'book' && <p>Quem baixou uma cópia pessoal mantém o caderno.{!user && ' Entre na conta para retirar publicações dos espaços.'}</p>}{deleteError && <p className="form-error" role="alert">{deleteError}</p>}<div className="modal-actions"><button className="secondary" disabled={deletingBusy} onClick={() => setDeleting(null)}>Cancelar</button><button className="danger-button" disabled={deletingBusy} onClick={remove}>{deletingBusy ? 'Excluindo…' : deleting.kind === 'book' ? 'Excluir caderno' : 'Excluir página'}</button></div></div></Modal>}
  </div>;
}

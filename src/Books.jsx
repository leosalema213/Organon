import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Check, Ellipsis, Pencil, Plus, Share2, Trash2, Users } from 'lucide-react';
import { bookPercent } from './books.js';
import { dayKey } from './model.js';
import './books.css';
import BookThumbnail from './BookThumbnail.jsx';
import PopupMenu from './PopupMenu.jsx';
import ShareBook from './teams/ShareBook.jsx';
import { useSharedBooks } from './shared-books.js';
const PdfReader = lazy(() => import('./PdfReader.jsx'));
const ReflowReader = lazy(() => import('./ReflowReader.jsx'));

function BookReader({ book, downloadSharedBook, onChange, onClose, saveError, onAnki, Modal }) {
  const [ready, setReady] = useState(!book.orgId), [error, setError] = useState('');
  const { orgId, id, hash } = book;
  useEffect(() => {
    if (!orgId) return;
    let active = true;
    downloadSharedBook(orgId, id).then(result => {
      if (result.book?.hash !== hash) throw new Error('O livro mudou. Abra a cópia atualizada.');
      if (active) setReady(true);
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [downloadSharedBook, orgId, id, hash]);
  if (!ready) return <Modal title="Abrir livro compartilhado" subtitle={book.title} onClose={onClose} small>
    {error ? <p role="alert">{error}</p> : <p role="status">Preparando livro compartilhado…</p>}
    <div className="modal-actions"><button className="secondary" onClick={onClose}>{error ? 'Fechar aviso' : 'Cancelar'}</button></div>
  </Modal>;
  const Reader = book.format === 'pdf' ? PdfReader : ReflowReader;
  return <Suspense fallback={<p role="status">Preparando leitor…</p>}><Reader book={book} onChange={onChange} onClose={onClose} saveError={saveError} onAnki={onAnki} /></Suspense>;
}

const bookKey = book => book.sharedKey || book.id;

function libraryByFile(personal, shared) {
  const byHash = new Map(personal.map(book => [book.hash, { book, orgIds: new Set() }]));
  for (const book of shared) {
    const entry = byHash.get(book.hash);
    if (!entry) {
      byHash.set(book.hash, { book, orgIds: new Set([book.orgId]) });
      continue;
    }
    entry.orgIds.add(book.orgId);
    if (entry.book.orgId && (book.furthestPage > entry.book.furthestPage ||
      (book.furthestFraction || 0) > (entry.book.furthestFraction || 0))) entry.book = book;
  }
  return [...byHash.values()];
}

export default function Books({ books, plans, onChange, notify, Modal, saveError, initialPlan = '', onAnki, business, user }) {
  const [reading, setReading] = useState(null), [filter, setFilter] = useState('all'), [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState(initialPlan), [editing, setEditing] = useState(null), [deleting, setDeleting] = useState(null), [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(null);
  const [source, setSource] = useState('all'), [sharedSaveError, setSharedSaveError] = useState(false);
  const shared = useSharedBooks(business.api, user?.id, business.spaces);
  const patch = (id, change) => onChange(items => items.map(book => book.id === id ? typeof change === 'function' ? change(book) : { ...book, ...change } : book));
  function patchBook(book, change) {
    if (!book.orgId) return patch(book.id, change);
    try { shared.patch(book, change); setSharedSaveError(false); }
    catch { setSharedSaveError(true); }
  }
  async function importBooks() {
    setBusy(true);
    try {
      const results = await window.desktop.books.import();
      let duplicates = 0;
      onChange(items => {
        const next = [...items];
        for (const result of results) {
          if (!result.book) continue;
          if (next.some(book => book.hash === result.book.hash)) { duplicates++; continue; }
          next.push({ ...result.book, planIds: planFilter ? [planFilter] : [] });
        }
        return next;
      });
      const failures = results.filter(result => result.error);
      if (failures.length) notify(failures.map(result => result.error).join(' '));
      else if (results.length) notify(duplicates ? `${results.length - duplicates} importados; ${duplicates} já estavam na biblioteca.` : `${results.length} livro(s) importado(s).`);
    } catch (error) { notify(`Não foi possível importar: ${error.message}`); }
    finally { setBusy(false); }
  }
  const library = libraryByFile(books, shared.books);
  const visible = library.filter(({ book, orgIds }) => (source === 'all' || (source === 'shared' ? orgIds.size > 0 : !book.orgId)) && (!planFilter || book.planIds.includes(planFilter)) && (filter === 'all' || (filter === 'read' ? !!book.completedAt : !book.completedAt)) && book.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const current = library.find(({ book }) => bookKey(book) === reading)?.book;
  useEffect(() => { if (reading && !current) setReading(null); }, [reading, current]);
  return <>
    <div className="page-heading books-heading"><h1>Livros</h1><div className="button-row"><button className="primary" disabled={busy || !window.desktop?.books} onClick={importBooks}><Plus size={17} />{busy ? 'Importando…' : 'Importar livros'}</button></div></div>
    {!window.desktop?.books && <p className="muted">Abra o Organon desktop para importar e ler livros offline.</p>}
    <div className="books-filters"><input aria-label="Buscar livros" placeholder="Buscar livros" value={search} onChange={e => setSearch(e.target.value)} /><select aria-label="Livros por plano" value={planFilter} onChange={e => setPlanFilter(e.target.value)}><option value="">Todos os planos e independentes</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select><select aria-label="Origem dos livros" value={source} onChange={e => setSource(e.target.value)}><option value="all">Todas as origens</option><option value="personal">Pessoais</option><option value="shared">Compartilhados</option></select><div className="tabs">{[['all', 'Todos'], ['reading', 'Em leitura'], ['read', 'Lidos']].map(([key, label]) => <button key={key} aria-pressed={filter === key} className={filter === key ? 'selected' : ''} onClick={() => setFilter(key)}>{label}</button>)}</div></div>
    <div className="books-grid">{visible.map(({ book, orgIds }) => <article className="reading-card" key={bookKey(book)}><button className="reading-cover" aria-label={`Ler ${book.title}`} onClick={() => setReading(bookKey(book))}><BookThumbnail book={book} downloadSharedBook={business.api.downloadSharedBook} /></button><div className="reading-title"><h2>{book.title}</h2>
      {orgIds.size > 0 && <span className="reading-shared" role="img" aria-label="Livro compartilhado" title={`Compartilhado · ${business.spaces.filter(space => orgIds.has(space.id)).map(space => space.name).join(', ')}`}><Users size={14} /></span>}
    </div><p>{book.format !== 'pdf' ? book.location ? `Retomar em ${Math.floor((book.fraction || 0) * 100)}%` : 'Pronto para começar' : book.pageCount ? `Retomar na página ${book.page} de ${book.pageCount}` : 'Pronto para começar'}</p><p>Ponto mais avançado: {bookPercent(book)}%{book.furthestPage > 0 && ` · pág. ${book.furthestPage}`}</p><progress aria-label={`Ponto mais avançado de ${book.title}`} max="100" value={bookPercent(book)} /><div className="reading-plan-tags">{book.planIds.map(id => plans.find(plan => plan.id === id)).filter(Boolean).map(plan => <span key={plan.id}>{plan.name}</span>)}</div><div className="reading-actions"><button className="secondary" onClick={() => setReading(bookKey(book))}>Continuar</button><button className="secondary" aria-label={`${book.completedAt ? 'Reabrir' : 'Concluir'} livro ${book.title}`} aria-pressed={!!book.completedAt} onClick={() => patchBook(book, { completedAt: book.completedAt ? null : dayKey() })}><Check size={16} />{book.completedAt ? 'Lido' : 'Concluir'}</button>{!book.orgId && <PopupMenu label={`Opções de ${book.title}`} icon={Ellipsis} iconOnly className="secondary reading-options" items={[
      { id: 'edit', label: 'Editar livro', icon: Pencil, onSelect: () => setEditing({ ...book, planIds: [...book.planIds] }) },
      { id: 'share', label: 'Compartilhar livro', icon: Share2, onSelect: () => user ? setSharing({ book, userId: user.id }) : notify('Entre na sua conta para compartilhar livros.') },
      { id: 'delete', label: 'Excluir livro', icon: Trash2, onSelect: () => setDeleting(book) },
    ]} />}</div></article>)}</div>
    {source !== 'personal' && shared.error && <p className="form-error" role="alert">Não foi possível consultar todos os espaços de livros compartilhados.</p>}
    {sharedSaveError && !current && <p className="form-error" role="alert">Não foi possível salvar o progresso do livro compartilhado neste dispositivo.</p>}
    {source !== 'personal' && shared.loading && <p className="muted" role="status">Buscando livros compartilhados…</p>}
    {!visible.length && (source === 'personal' || !shared.loading) && <p className="books-empty">{library.length || source === 'shared' ? 'Nenhum livro com esses filtros.' : 'Importe seus livros. Eles também podem ficar independentes dos planos.'}</p>}
    {sharing && sharing.userId === user?.id && <ShareBook key={user.id} userId={user.id} api={business.api} spaces={business.spaces} book={sharing.book} onClose={() => setSharing(null)} notify={notify} />}
    {current && <BookReader key={bookKey(current)} book={current} downloadSharedBook={business.api.downloadSharedBook} onChange={change => patchBook(current, change)} onClose={() => setReading(null)} saveError={current.orgId ? sharedSaveError : saveError} onAnki={onAnki ? () => onAnki(current) : undefined} Modal={Modal} />}
    {editing && <Modal title="Editar livro" onClose={() => setEditing(null)} small><form className="book-link-form" onSubmit={e => { e.preventDefault(); if (!editing.title.trim()) return; patch(editing.id, { title: editing.title.trim(), planIds: editing.planIds }); setEditing(null); }}><label>Título<input required maxLength={300} value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} /></label><p>Escolha quantos planos quiser. Sem seleção, o livro permanece independente.</p>{plans.map(plan => <label className="book-plan-check" key={plan.id}><input type="checkbox" checked={editing.planIds.includes(plan.id)} onChange={e => setEditing({ ...editing, planIds: e.target.checked ? [...editing.planIds, plan.id] : editing.planIds.filter(id => id !== plan.id) })} />{plan.name}</label>)}<div className="modal-actions"><button type="button" onClick={() => setEditing(null)}>Cancelar</button><button className="primary" type="submit" disabled={!editing.title.trim()}>Salvar alterações</button></div></form></Modal>}
    {deleting && <Modal title="Excluir este livro?" onClose={() => setDeleting(null)} small><p className="confirm-text">“{deleting.title}” sairá da biblioteca, dos planos e do progresso. O arquivo original permanece intacto.</p><div className="modal-actions"><button onClick={() => setDeleting(null)}>Cancelar</button><button className="primary" onClick={() => { onChange(items => items.filter(book => book.id !== deleting.id)); setDeleting(null); }}>Excluir livro</button></div></Modal>}
  </>;
}

import React, { lazy, Suspense, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { bookPercent } from './books.js';
import { dayKey } from './model.js';
import './books.css';
import BookThumbnail from './BookThumbnail.jsx';
const PdfReader = lazy(() => import('./PdfReader.jsx'));
const ReflowReader = lazy(() => import('./ReflowReader.jsx'));

export default function Books({ books, plans, onChange, notify, Modal, saveError, initialPlan = '', onAnki, onShared }) {
  const [reading, setReading] = useState(null), [filter, setFilter] = useState('all'), [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState(initialPlan), [editing, setEditing] = useState(null), [deleting, setDeleting] = useState(null), [busy, setBusy] = useState(false);
  const patch = (id, change) => onChange(items => items.map(book => book.id === id ? typeof change === 'function' ? change(book) : { ...book, ...change } : book));
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
  const visible = books.filter(book => (!planFilter || book.planIds.includes(planFilter)) && (filter === 'all' || (filter === 'read' ? !!book.completedAt : !book.completedAt)) && book.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const current = books.find(book => book.id === reading);
  const Reader = current?.format === 'pdf' ? PdfReader : ReflowReader;
  return <>
    <div className="page-heading"><h1>Livros</h1><div className="button-row">{onShared && <button className="secondary" onClick={onShared}>Livros compartilhados</button>}<button className="primary" disabled={busy || !window.desktop?.books} onClick={importBooks}><Plus size={17} />{busy ? 'Importando…' : 'Importar livros'}</button></div></div>
    {!window.desktop?.books && <p className="muted">Abra o Organon desktop para importar e ler livros offline.</p>}
    <div className="books-filters"><input aria-label="Buscar livros" placeholder="Buscar livros" value={search} onChange={e => setSearch(e.target.value)} /><select aria-label="Livros por plano" value={planFilter} onChange={e => setPlanFilter(e.target.value)}><option value="">Todos os planos e independentes</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select><div className="tabs">{[['all', 'Todos'], ['reading', 'Em leitura'], ['read', 'Lidos']].map(([key, label]) => <button key={key} aria-pressed={filter === key} className={filter === key ? 'selected' : ''} onClick={() => setFilter(key)}>{label}</button>)}</div></div>
    <div className="books-grid">{visible.map(book => <article className="reading-card" key={book.id}><button className="reading-cover" aria-label={`Ler ${book.title}`} onClick={() => setReading(book.id)}><BookThumbnail book={book} /></button><h2>{book.title}</h2><p>{book.format !== 'pdf' ? book.location ? `Retomar em ${Math.floor((book.fraction || 0) * 100)}%` : 'Pronto para começar' : book.pageCount ? `Retomar na página ${book.page} de ${book.pageCount}` : 'Pronto para começar'}</p><p>Ponto mais avançado: {bookPercent(book)}%{book.furthestPage > 0 && ` · pág. ${book.furthestPage}`}</p><progress aria-label={`Ponto mais avançado de ${book.title}`} max="100" value={bookPercent(book)} /><div className="reading-plan-tags">{book.planIds.map(id => plans.find(plan => plan.id === id)).filter(Boolean).map(plan => <span key={plan.id}>{plan.name}</span>)}</div><div className="reading-actions"><button className="secondary" onClick={() => setReading(book.id)}>Continuar</button><button aria-label={`${book.completedAt ? 'Reabrir' : 'Concluir'} livro ${book.title}`} aria-pressed={!!book.completedAt} onClick={() => patch(book.id, { completedAt: book.completedAt ? null : dayKey() })}><Check size={16} />{book.completedAt ? 'Lido' : 'Concluir'}</button><button aria-label={`Vincular ${book.title} a planos`} onClick={() => setEditing({ ...book, planIds: [...book.planIds] })}>Planos</button><button aria-label={`Excluir livro ${book.title}`} onClick={() => setDeleting(book)}><Trash2 size={15} /></button></div></article>)}</div>
    {!visible.length && <p className="books-empty">{books.length ? 'Nenhum livro com esses filtros.' : 'Importe seus livros. Eles também podem ficar independentes dos planos.'}</p>}
    {current && <Suspense fallback={<p role="status">Preparando leitor…</p>}><Reader key={current.id} book={current} onChange={change => patch(current.id, change)} onClose={() => setReading(null)} saveError={saveError} onAnki={onAnki ? () => onAnki(current) : undefined} /></Suspense>}
    {editing && <Modal title="Livros e planos" onClose={() => setEditing(null)} small><form className="book-link-form" onSubmit={e => { e.preventDefault(); if (!editing.title.trim()) return; patch(editing.id, { title: editing.title.trim(), planIds: editing.planIds }); setEditing(null); }}><label>Título<input required maxLength={300} value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} /></label><p>Escolha quantos planos quiser. Sem seleção, o livro permanece independente.</p>{plans.map(plan => <label className="book-plan-check" key={plan.id}><input type="checkbox" checked={editing.planIds.includes(plan.id)} onChange={e => setEditing({ ...editing, planIds: e.target.checked ? [...editing.planIds, plan.id] : editing.planIds.filter(id => id !== plan.id) })} />{plan.name}</label>)}<div className="modal-actions"><button type="button" onClick={() => setEditing(null)}>Cancelar</button><button className="primary" type="submit" disabled={!editing.title.trim()}>Salvar vínculos</button></div></form></Modal>}
    {deleting && <Modal title="Excluir este livro?" onClose={() => setDeleting(null)} small><p className="confirm-text">“{deleting.title}” sairá da biblioteca, dos planos e do progresso. O arquivo original permanece intacto.</p><div className="modal-actions"><button onClick={() => setDeleting(null)}>Cancelar</button><button className="primary" onClick={() => { onChange(items => items.filter(book => book.id !== deleting.id)); setDeleting(null); }}>Excluir livro</button></div></Modal>}
  </>;
}

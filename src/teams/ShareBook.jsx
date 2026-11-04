import { useEffect, useRef, useState } from 'react';
import Modal from '../Modal.jsx';
import { findBookShares, removeBookShares } from '../shared-books.js';
import './teams.css';

export default function ShareBook({ api, spaces, userId, book, onClose, notify }) {
  const [selected, setSelected] = useState({});
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);
  const [catalog, setCatalog] = useState(null), [refresh, setRefresh] = useState(0);
  const mounted = useRef(false);
  const spaceIds = spaces.map(space => space.id).sort().join(',');
  const entries = catalog?.spaceIds === spaceIds && catalog?.refresh === refresh ? catalog.entries : null;
  const changes = spaces.filter(space => {
    const entry = entries?.get(space.id);
    return entry && !entry.error && Object.hasOwn(selected, space.id) &&
      (selected[space.id] ? !entry.own.length && !entry.other : entry.own.length > 0);
  });
  const managing = entries && [...entries.values()].some(entry => entry.own?.length);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!spaceIds) return;
    let active = true;
    Promise.all(spaceIds.split(',').map(async orgId => {
      try {
        return [orgId, await findBookShares(api, spaces.find(space => space.id === orgId), book, userId)];
      } catch {
        return [orgId, { error: true }];
      }
    })).then(results => {
      if (active) setCatalog({ spaceIds, refresh, entries: new Map(results) });
    });
    return () => { active = false; };
  }, [api, book.id, book.hash, spaceIds, userId, refresh]);

  async function share(event) {
    event.preventDefault();
    if (busy || !changes.length) return;
    setBusy(true);
    setErrors([]);
    const failed = [];
    for (const space of changes) {
      if (!mounted.current) return;
      try {
        if (selected[space.id]) await api.call('teams', 'publish', { orgId: space.id, module: 'books', resourceId: book.id, revision: 0 });
        else await removeBookShares(api, space.id, entries.get(space.id).own, () => mounted.current);
      } catch (error) {
        failed.push({ id: space.id, message: `${space.name}: ${error.message}` });
      }
    }
    if (!mounted.current) return;
    setBusy(false);
    setSelected(Object.fromEntries(failed.map(item => [item.id, selected[item.id]])));
    setErrors(failed);
    api.refresh();
    if (changes.length > failed.length) notify('Compartilhamentos atualizados.');
    if (!failed.length) onClose();
    else setRefresh(value => value + 1);
  }

  return <Modal title="Compartilhar livro" subtitle={book.title} small onClose={() => { if (!busy) onClose(); }}>
    <form className="teams-form" onSubmit={share} aria-busy={busy || !!spaceIds && !entries}>
      {spaces.length ? <><p>Marque os espaços para compartilhar. Desmarque um espaço e salve para retirar a sua publicação.</p>
        {!entries && <p role="status">Consultando compartilhamentos…</p>}
        {entries && <fieldset className="teams-resource-options book-share-spaces" disabled={busy}>
          <legend>Compartilhar com</legend>
          {spaces.map(space => {
            const entry = entries.get(space.id);
            if (entry.error) return <p className="teams-error" key={space.id}>{space.name} · status indisponível</p>;
            const statusId = `book-share-status-${space.id}`;
            const own = entry.own.length > 0, otherOnly = entry.other && !own;
            return <label className="teams-check" key={space.id}><input type="checkbox" aria-label={space.name} aria-describedby={own || otherOnly ? statusId : undefined} disabled={otherOnly} checked={otherOnly || (selected[space.id] ?? own)} onChange={event => {
              const checked = event.target.checked;
              setSelected(current => ({ ...current, [space.id]: checked }));
            }} /><span>{space.name}{(own || otherOnly) && <small id={statusId}>{own ? 'Já compartilhado por você' : 'Já disponível neste espaço por outra pessoa'}</small>}</span></label>;
          })}
        </fieldset>}
        {entries && [...entries.values()].some(entry => entry.error) && <button className="secondary" type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Consultar novamente</button>}
        <small>Para ajustar o acesso de uma pessoa, use Equipes → Rever permissões.</small>
      </> : <p>Crie um espaço em Equipes ou aceite um convite para compartilhar livros.</p>}
      {errors.length > 0 && <ul role="alert" className="teams-error">{errors.map(item => <li key={item.id}>{item.message}</li>)}</ul>}
      <div className="modal-actions"><button className="secondary" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="primary" type="submit" disabled={busy || !changes.length}>{busy ? 'Salvando…' : managing ? 'Salvar alterações' : 'Compartilhar'}</button></div>
    </form>
  </Modal>;
}

import { useEffect, useRef, useState } from 'react';
import Modal from '../Modal.jsx';
import './teams.css';

export default function ShareBook({ api, spaces, book, onClose, notify }) {
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);
  const mounted = useRef(false);
  const destinations = spaces.filter(space => selected.includes(space.id));
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function share(event) {
    event.preventDefault();
    if (busy || !destinations.length) return;
    setBusy(true);
    setErrors([]);
    const failed = [];
    for (const space of destinations) {
      if (!mounted.current) return;
      try {
        const resources = await api.call('teams', 'resources', { orgId: space.id });
        if (!mounted.current) return;
        const copy = resources.find(row => row.module === 'books' && row.resource_id === book.id);
        await api.call('teams', 'publish', { orgId: space.id, module: 'books', resourceId: book.id, revision: copy?.revision ?? 0 });
      } catch (error) {
        failed.push({ id: space.id, message: `${space.name}: ${error.message}` });
      }
    }
    if (!mounted.current) return;
    setBusy(false);
    setSelected(failed.map(item => item.id));
    setErrors(failed);
    const shared = destinations.length - failed.length;
    if (shared) notify(shared === 1 ? 'Livro compartilhado em 1 espaço.' : `Livro compartilhado em ${shared} espaços.`);
    if (!failed.length) onClose();
  }

  return <Modal title="Compartilhar livro" subtitle={book.title} small onClose={() => { if (!busy) onClose(); }}>
    <form className="teams-form" onSubmit={share} aria-busy={busy}>
      {spaces.length ? <><p>Escolha os espaços. Em cada um, a cópia ficará disponível aos membros com acesso a este livro.</p>
        <fieldset className="teams-resource-options book-share-spaces" disabled={busy}>
          <legend>Compartilhar com</legend>
          {spaces.map(space => <label className="teams-check" key={space.id}><input type="checkbox" checked={selected.includes(space.id)} onChange={event => {
            const checked = event.target.checked;
            setSelected(current => checked ? [...current, space.id] : current.filter(id => id !== space.id));
          }} />{space.name}</label>)}
        </fieldset>
        <small>Para ajustar o acesso de uma pessoa, use Equipes → Rever permissões.</small>
      </> : <p>Crie um espaço em Equipes ou aceite um convite para compartilhar livros.</p>}
      {errors.length > 0 && <ul role="alert" className="teams-error">{errors.map(item => <li key={item.id}>{item.message}</li>)}</ul>}
      <div className="modal-actions"><button className="secondary" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="primary" type="submit" disabled={busy || !destinations.length}>{busy ? 'Compartilhando…' : 'Compartilhar'}</button></div>
    </form>
  </Modal>;
}

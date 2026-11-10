import { useEffect, useRef, useState } from 'react';
import Modal from '../Modal.jsx';
import { resourceShares, shareChanges, removeResourceShares } from '../shared-resources.js';
import './teams.css';

function Choice({ mixed, ...props }) {
  const input = useRef();
  useEffect(() => { input.current.indeterminate = mixed; }, [mixed]);
  return <input ref={input} type="checkbox" {...props} />;
}

export default function ShareResources({ api, spaces, userId, module, resources, single = false, onClose, notify }) {
  const [ids, setIds] = useState(single ? resources.map(item => item.id) : []);
  const [selected, setSelected] = useState({}), [busy, setBusy] = useState(false), [errors, setErrors] = useState([]);
  const [catalog, setCatalog] = useState(null), [refresh, setRefresh] = useState(0);
  const mounted = useRef(false), working = useRef(false);
  const spaceIds = spaces.map(space => space.id).sort().join(',');
  const entries = catalog?.spaceIds === spaceIds && catalog.refresh === refresh ? catalog.entries : null;
  const chosen = resources.filter(item => ids.includes(item.id));
  const changes = shareChanges(spaces, entries, chosen, selected, module, userId);
  const managing = entries && spaces.some(space => chosen.some(item => resourceShares(entries.get(space.id)?.rows || [], module, item, userId, space.owner_id).own.length));
  const noun = module === 'books' ? 'livro' : 'caderno', plural = module === 'books' ? 'livros' : 'cadernos';
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!spaceIds) return;
    let active = true;
    Promise.all(spaceIds.split(',').map(async orgId => {
      try { return [orgId, { rows: await api.call('teams', 'resources', { orgId }) }]; }
      catch { return [orgId, { error: true }]; }
    })).then(results => { if (active) setCatalog({ spaceIds, refresh, entries: new Map(results) }); });
    return () => { active = false; };
  }, [api, spaceIds, refresh]);

  async function save(event) {
    event.preventDefault();
    if (working.current || !changes.length) return;
    working.current = true; setBusy(true); setErrors([]);
    const failed = [];
    for (const change of changes) {
      if (!mounted.current) return;
      const { space, resource, own, publish } = change;
      try {
        if (publish) await api.call('teams', 'publish', { orgId: space.id, module, resourceId: resource.id, revision: 0 });
        else await removeResourceShares(api, space.id, module, own, () => mounted.current);
      } catch (error) { failed.push(`${resource.title || resource.name} · ${space.name}: ${error.message}`); }
    }
    working.current = false;
    api.refresh();
    if (!mounted.current) return;
    setBusy(false); setErrors(failed);
    if (changes.length > failed.length) notify('Compartilhamentos atualizados.');
    if (!failed.length) onClose();
    else setRefresh(value => value + 1);
  }

  return <Modal title={`Compartilhar ${single ? noun : plural}`} subtitle={single ? resources[0]?.title || resources[0]?.name : undefined} small onClose={() => { if (!busy) onClose(); }}>
    <form className="teams-form" onSubmit={save} aria-busy={busy || !!spaceIds && !entries}>
      {!single && <fieldset className="teams-resource-options" disabled={busy}>
        <legend>Selecionar {plural}</legend>
        <label className="teams-check"><Choice mixed={chosen.length > 0 && chosen.length < resources.length} checked={!!resources.length && chosen.length === resources.length} onChange={event => { setIds(event.target.checked ? resources.map(item => item.id) : []); setSelected({}); }} />Todos os {plural}</label>
        {resources.map(item => <label className="teams-check" key={item.id}><input type="checkbox" checked={ids.includes(item.id)} onChange={event => { setIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id)); setSelected({}); }} />{item.title || item.name}</label>)}
        {!resources.length && <p>Nenhum {noun} pessoal disponível. Salve uma cópia dos recebidos para compartilhar.</p>}
      </fieldset>}
      {spaces.length ? <><p>Marque os espaços para compartilhar. Desmarque um espaço e salve para retirar suas publicações. Quem baixou uma cópia pessoal mantém o conteúdo.</p>
        {!entries && <p role="status">Consultando compartilhamentos…</p>}
        {entries && <fieldset className="teams-resource-options book-share-spaces" disabled={busy || !chosen.length}>
          <legend>Compartilhar com</legend>
          {spaces.map(space => {
            const entry = entries.get(space.id);
            if (entry.error) return <p className="teams-error" key={space.id}>{space.name} · status indisponível</p>;
            const shares = chosen.map(item => resourceShares(entry.rows, module, item, userId, space.owner_id));
            const own = shares.some(item => item.own.length), allAvailable = shares.length > 0 && shares.every(item => item.own.length || item.other);
            const otherOnly = shares.length > 0 && shares.every(item => item.other && !item.own.length);
            const mixed = !Object.hasOwn(selected, space.id) && !allAvailable && shares.some(item => item.own.length || item.other);
            const statusId = `share-status-${space.id}`;
            return <label className="teams-check" key={space.id}><Choice mixed={mixed} aria-label={space.name} aria-describedby={own || otherOnly || mixed ? statusId : undefined} disabled={otherOnly} checked={selected[space.id] ?? allAvailable} onChange={event => setSelected(current => ({ ...current, [space.id]: event.target.checked }))} /><span>{space.name}{(own || otherOnly || mixed) && <small id={statusId}>{mixed ? 'Parte da seleção já está compartilhada' : own ? 'Já compartilhado por você' : 'Já disponível neste espaço por outra pessoa'}</small>}</span></label>;
          })}
        </fieldset>}
        {entries && [...entries.values()].some(entry => entry.error) && <button className="secondary" type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Consultar novamente</button>}
        <small>Para ajustar o acesso de uma pessoa, use Equipes → Rever permissões.</small>
      </> : <p>Crie um espaço em Equipes ou aceite um convite para compartilhar {plural}.</p>}
      {!!errors.length && <ul role="alert" className="teams-error">{errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}
      <div className="modal-actions"><button className="secondary" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="primary" type="submit" disabled={busy || !changes.length}>{busy ? 'Salvando…' : managing ? 'Salvar alterações' : 'Compartilhar'}</button></div>
    </form>
  </Modal>;
}

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
  const [recipients, setRecipients] = useState({});
  const [selected, setSelected] = useState({}), [busy, setBusy] = useState(false), [errors, setErrors] = useState([]);
  const [catalog, setCatalog] = useState(null), [refresh, setRefresh] = useState(0);
  const mounted = useRef(false), working = useRef(false);
  const spaceIds = spaces.map(space => space.id).sort().join(',');
  const chosen = resources.filter(item => ids.includes(item.id));
  const chosenIds = chosen.map(item => item.id).sort().join(',');
  const entries = catalog?.spaceIds === spaceIds && catalog.refresh === refresh && catalog.chosenIds === chosenIds ? catalog.entries : null;
  const changes = shareChanges(spaces, entries, chosen, selected, module, userId, recipients);
  const managing = entries && spaces.some(space => chosen.some(item => resourceShares(entries.get(space.id)?.rows || [], module, item, userId, space.owner_id).own.length));
  const noun = module === 'books' ? 'livro' : 'caderno', plural = module === 'books' ? 'livros' : 'cadernos';
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!spaceIds) return;
    let active = true;
    Promise.all(spaceIds.split(',').map(async orgId => {
      try {
        const rows = await api.call('teams', 'resources', { orgId });
        const audiences = Object.fromEntries(await Promise.all(chosen.map(async resource => {
          const shares = resourceShares(rows, module, resource, userId, spaces.find(space => space.id === orgId)?.owner_id);
          if (shares.other && !shares.own.length) return [resource.id, null];
          const copies = await Promise.all((shares.own.length ? shares.own : [{ resource_id: resource.id, revision: 0 }]).map(async copy => ({
            resourceId: copy.resource_id, revision: copy.revision,
            ...await api.call('teams', 'shareRecipients', { orgId, module, resourceId: copy.resource_id }),
          })));
          return [resource.id, { ...copies[0], copies }];
        })));
        return [orgId, { rows, audiences }];
      }
      catch { return [orgId, { error: true }]; }
    })).then(results => { if (active) setCatalog({ spaceIds, refresh, chosenIds, entries: new Map(results) }); });
    return () => { active = false; };
  }, [api, spaceIds, refresh, chosenIds, module, userId]);

  async function save(event) {
    event.preventDefault();
    if (working.current || !changes.length) return;
    working.current = true; setBusy(true); setErrors([]);
    const failed = [];
    for (const change of changes) {
      if (!mounted.current) return;
      const { space, resource, own, publish } = change;
      try {
        if (publish) {
          const audience = entries.get(space.id).audiences[resource.id];
          for (const copy of audience.copies) {
            const recipientIds = change.recipientIds || copy.members.filter(member => member.selected).map(member => member.user_id);
            await api.call('teams', own.length ? 'setRecipients' : 'publish', { orgId: space.id, module, resourceId: copy.resourceId, revision: copy.revision, recipientIds, audienceToken: copy.token });
          }
        }
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
        <label className="teams-check"><Choice mixed={chosen.length > 0 && chosen.length < resources.length} checked={!!resources.length && chosen.length === resources.length} onChange={event => { setIds(event.target.checked ? resources.map(item => item.id) : []); setSelected({}); setRecipients({}); }} />Todos os {plural}</label>
        {resources.map(item => <label className="teams-check" key={item.id}><input type="checkbox" checked={ids.includes(item.id)} onChange={event => { setIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id)); setSelected({}); setRecipients({}); }} />{item.title || item.name}</label>)}
        {!resources.length && <p>Nenhum {noun} pessoal disponível. Salve uma cópia dos recebidos para compartilhar.</p>}
      </fieldset>}
      {spaces.length ? <>
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
            const audiences = chosen.flatMap(item => entry.audiences[item.id]?.copies || []);
            const members = [...new Map(audiences.flatMap(audience => audience.members).map(member => [member.user_id, member])).values()];
            const enabled = selected[space.id] ?? allAvailable;
            return <div key={space.id}><label className="teams-check"><Choice mixed={mixed} aria-label={space.name} aria-describedby={own || otherOnly || mixed ? statusId : undefined} disabled={otherOnly} checked={selected[space.id] ?? allAvailable} onChange={event => { setSelected(current => ({ ...current, [space.id]: event.target.checked })); if (event.target.checked) setRecipients(current => ({ ...current, [space.id]: null })); }} /><span>{space.name}{(own || otherOnly || mixed) && <small id={statusId}>{mixed ? 'Parte da seleção já está compartilhada' : own ? 'Já compartilhado por você' : 'Já disponível neste espaço por outra pessoa'}</small>}</span></label>
              {enabled && !otherOnly && <div className="share-recipients">
                <label className="teams-check"><Choice aria-label={`Todos os membros de ${space.name}`} checked={Object.hasOwn(recipients, space.id) ? recipients[space.id] === null || members.every(member => member.fixed || recipients[space.id].includes(member.user_id)) : audiences.every(audience => audience.members.every(member => member.selected))} onChange={event => setRecipients(current => ({ ...current, [space.id]: event.target.checked ? null : [] }))} />Todos os membros</label>
                {members.map(member => {
                  const values = audiences.map(audience => audience.members.find(item => item.user_id === member.user_id)).filter(Boolean);
                  const checked = member.fixed || (Object.hasOwn(recipients, space.id) ? recipients[space.id] === null || recipients[space.id].includes(member.user_id) : values.every(item => item.selected));
                  return <label className="teams-check" key={member.user_id}><Choice checked={checked} mixed={!Object.hasOwn(recipients, space.id) && !checked && values.some(item => item.selected)} disabled={member.fixed} onChange={event => setRecipients(current => {
                    const previous = Object.hasOwn(current, space.id) ? current[space.id] === null ? members.map(item => item.user_id) : current[space.id] : members.filter(item => audiences.some(audience => audience.members.some(value => value.user_id === item.user_id && value.selected))).map(item => item.user_id);
                    return { ...current, [space.id]: event.target.checked ? [...new Set([...previous, member.user_id])] : previous.filter(id => id !== member.user_id) };
                  })} />{member.name || member.nickname || 'Membro da equipe'}{member.fixed && ' (proprietário)'}</label>;
                })}
                {!members.length && <small>Nenhum outro membro aceito nesta equipe.</small>}
              </div>}
            </div>;
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

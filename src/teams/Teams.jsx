import React, { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '../Modal.jsx';
import Permissions, { emptyGrants, MODULE_LABELS } from './Permissions.jsx';
import Sharing from './Sharing.jsx';
import './teams.css';

const statuses = { pending: 'Convite pendente', accepted: 'Aceito', declined: 'Recusado', revoked: 'Acesso removido' };
export default function Teams({ api, user, workspace }) {
  const [spaces, setSpaces] = useState([]), [active, setActive] = useState(workspace || null);
  const [members, setMembers] = useState([]), [notifications, setNotifications] = useState([]), [catalog, setCatalog] = useState({});
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [form, setForm] = useState(null);
  const [query, setQuery] = useState(''), [results, setResults] = useState([]), [person, setPerson] = useState(null);
  const [access, setAccess] = useState(emptyGrants), [name, setName] = useState('');
  const owner = !!user && active?.owner_id === user.id, epoch = useRef(0), searchEpoch = useRef(0);
  useEffect(() => { setActive(workspace || null); setMembers([]); setCatalog({}); setForm(null); }, [workspace?.id, user?.id]);
  const refresh = useCallback(async () => {
    const current = ++epoch.current;
    if (!user) { setSpaces([]); setNotifications([]); setMembers([]); setCatalog({}); return; }
    const [nextSpaces, nextNotifications, nextMembers] = await Promise.all([
      api.call('teams', 'list'), api.call('teams', 'notifications'), owner ? api.call('teams', 'members', { orgId: active.id }) : Promise.resolve([]),
    ]);
    if (current !== epoch.current) return;
    setSpaces(nextSpaces); setNotifications(nextNotifications); setMembers(nextMembers);
    if (active && !nextSpaces.some(s => s.id === active.id)) { setActive(null); setForm(null); setCatalog({}); }
  }, [api, user?.id, active?.id, owner]);
  useEffect(() => {
    let alive = true;
    const update = () => refresh().catch(e => alive && setError(e.message));
    update(); const unsubscribe = api.subscribe('teams', update);
    return () => { alive = false; epoch.current++; unsubscribe(); };
  }, [api, refresh]);
  async function run(task, success) {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { await task(); await refresh(); if (success) setMessage(success); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function edit(member = null) {
    setError(''); setResults([]); setPerson(null); setQuery(''); searchEpoch.current++;
    setAccess(member ? { ...emptyGrants(), ...member.grants } : emptyGrants()); setForm(member ? { type: 'permissions', member } : { type: 'invite' });
    setCatalog({});
    try { setCatalog(await api.call('teams', 'catalog', { orgId: active.id })); }
    catch (e) { setError(e.message); }
  }
  async function search(e) {
    e.preventDefault(); const current = ++searchEpoch.current; setPerson(null); setResults([]);
    await run(async () => { const rows = await api.call('teams', 'search', { query }); if (current === searchEpoch.current) setResults(rows); });
  }
  function close() { if (!busy) { searchEpoch.current++; setForm(null); setResults([]); setPerson(null); } }
  if (!user) return <section className="teams-page"><h1>Equipes</h1><p>Entre na sua conta para criar espaços e responder aos convites. Seus estudos locais continuam disponíveis.</p></section>;
  return <section className="teams-page" aria-busy={busy}>
    <header className="page-heading"><h1>Equipes</h1><button className="primary" disabled={busy} onClick={() => { setName(''); setForm({ type: 'create' }); }}>Criar espaço</button></header>
    {error && <p role="alert" className="teams-error">{error}</p>}{message && <p role="status">{message}</p>}
    <label className="teams-space">Espaço<select value={active?.id || ''} onChange={e => { setMembers([]); setCatalog({}); setForm(null); setActive(spaces.find(s => s.id === e.target.value) || null); }}><option value="">Selecione um espaço</option>{spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <section className="teams-section"><h2>Notificações e convites</h2>{!notifications.length && <p>Nenhuma notificação.</p>}
      {notifications.map(n => <article className="teams-row" key={n.id}><div><strong>{n.org_name}</strong><p>{n.kind === 'invitation' ? 'Convite para participar' : n.kind === 'permissions' ? 'Permissões atualizadas' : n.kind === 'revoke' ? 'Acesso removido' : statuses[n.kind] || n.kind} · {statuses[n.status]}</p>
        {n.kind === 'invitation' && n.status === 'pending' && <ul>{Object.entries(MODULE_LABELS).map(([key, label]) => { const g = n.grants[key]; return <li key={key}>{label}: {g?.mode === 'all' ? 'todos, incluindo futuros' : g?.mode === 'selected' ? `${g.ids.length} selecionados` : 'nenhum'}{g?.mode !== 'none' && g?.write ? ' · edição' : ''}</li>; })}</ul>}
      </div><div className="teams-actions">
        {n.kind === 'invitation' && n.status === 'pending' && <><button className="primary" disabled={busy} onClick={() => run(() => api.call('teams', 'respond', { id: n.member_id, revision: n.revision, response: 'accepted' }), 'Convite aceito.')}>Aceitar</button><button className="secondary" disabled={busy} onClick={() => run(() => api.call('teams', 'respond', { id: n.member_id, revision: n.revision, response: 'declined' }), 'Convite recusado.')}>Recusar</button></>}
        {!n.read_at && <button className="secondary" disabled={busy} onClick={() => run(() => api.call('teams', 'read', { id: n.id }))}>Marcar como lida</button>}
      </div></article>)}
    </section>
    {active && <section className="teams-section"><div className="teams-section-heading"><h2>{active.name}</h2>{owner && <button className="primary" disabled={busy} onClick={() => edit()}>Convidar pessoa</button>}</div>
      <p>{owner ? 'Você é o proprietário. Convites só liberam acesso após a aceitação.' : 'As permissões são gerenciadas pelo proprietário.'}</p>
      {owner && members.map(m => <article className="teams-row" key={m.id}><div><strong>{m.name || m.nickname || 'Conta cadastrada'}</strong><small>{m.nickname ? `@${m.nickname} · ` : ''}{m.user_id}</small><p>{statuses[m.status]}</p></div><div className="teams-actions">
        {['pending', 'accepted'].includes(m.status) && <><button className="secondary" disabled={busy} onClick={() => edit(m)}>Rever permissões</button><button className="secondary" disabled={busy} onClick={() => setForm({ type: 'revoke', member: m })}>Remover acesso</button></>}
      </div></article>)}
    </section>}
    {active && owner && <Sharing key={active.id} api={api} orgId={active.id} busy={busy} run={run} />}
    {form && <Modal title={form.type === 'create' ? 'Criar espaço' : form.type === 'invite' ? 'Convidar pessoa' : form.type === 'revoke' ? 'Remover acesso' : 'Rever permissões'} onClose={close}>
      {error && <p role="alert" className="teams-error">{error}</p>}
      {form.type === 'create' ? <form className="teams-form" onSubmit={e => { e.preventDefault(); run(async () => { const s = await api.call('teams', 'create', { name }); setActive(s); setForm(null); }, 'Espaço criado.'); }}><label>Nome<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label><button className="primary" disabled={busy}>Criar</button></form>
      : form.type === 'revoke' ? <div className="teams-form"><p>Remover o acesso desta pessoa ao espaço e aos recursos compartilhados?</p><button className="primary" disabled={busy} onClick={() => run(async () => { await api.call('teams', 'revoke', { orgId: active.id, id: form.member.id, revision: form.member.revision }); setForm(null); }, 'Acesso removido.')}>Remover acesso</button></div>
      : <div className="teams-form">
        {form.type === 'invite' && <><form onSubmit={search}><label>E-mail exato, nome ou apelido<input value={query} minLength={3} maxLength={100} required onChange={e => { setQuery(e.target.value); setPerson(null); setResults([]); searchEpoch.current++; }} /></label><button className="secondary" disabled={busy}>Buscar conta</button></form><small>Apenas contas já cadastradas. Até cinco resultados, sem listar e-mails.</small>
          <div role="group" aria-label="Pessoas encontradas">{results.map(p => <label className="teams-person" key={p.id}><input type="radio" name="teams-recipient" checked={person?.id === p.id} onChange={() => setPerson(p)} /><span>{p.name || 'Sem nome'} {p.nickname && `(@${p.nickname})`}<small>{p.id}</small></span></label>)}</div>
          {person && <p>Convidar: <strong>{person.name || person.nickname}</strong> · {person.id}</p>}
        </>}
        <Permissions value={access} onChange={setAccess} catalog={catalog} disabled={busy} />
        <div className="teams-actions"><button className="secondary" disabled={busy} onClick={close}>Cancelar</button><button className="primary" disabled={busy || (form.type === 'invite' && !person)} onClick={() => run(async () => {
          await api.call('teams', form.type === 'invite' ? 'invite' : 'permissions', { orgId: active.id, recipientId: person?.id, id: form.member?.id, revision: form.member?.revision, grants: access }); setForm(null);
        }, form.type === 'invite' ? 'Convite enviado. O acesso depende da aceitação.' : 'Permissões atualizadas.')}>{form.type === 'invite' ? 'Enviar convite' : 'Salvar permissões'}</button></div>
      </div>}
    </Modal>}
  </section>;
}

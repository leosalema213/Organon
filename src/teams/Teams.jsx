import React, { useCallback, useEffect, useRef, useState } from 'react';
import { UserRound } from 'lucide-react';
import Modal from '../Modal.jsx';
import Permissions, { emptyGrants } from './Permissions.jsx';
import Sharing from './Sharing.jsx';
import './teams.css';

const statuses = { pending: 'Convite pendente', accepted: 'Aceito', declined: 'Recusado', revoked: 'Acesso removido' };
function MemberAvatar({ avatar }) {
  const [failed, setFailed] = useState(null);
  return <span className="teams-avatar" aria-hidden="true">{avatar && failed !== avatar ? <img src={avatar} alt="" onError={() => setFailed(avatar)} /> : <UserRound size={18} />}</span>;
}
export default function Teams({ api, user, workspace }) {
  const [spaces, setSpaces] = useState([]), [active, setActive] = useState(workspace || null);
  const [members, setMembers] = useState([]), [tab, setTab] = useState('members'), [catalog, setCatalog] = useState({});
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [form, setForm] = useState(null);
  const [query, setQuery] = useState(''), [results, setResults] = useState([]), [person, setPerson] = useState(null);
  const [access, setAccess] = useState(emptyGrants), [name, setName] = useState('');
  const owner = !!user && active?.owner_id === user.id, epoch = useRef(0), searchEpoch = useRef(0);
  useEffect(() => { setActive(workspace || null); setMembers([]); setCatalog({}); setForm(null); setTab('members'); }, [workspace?.id, user?.id]);
  const refresh = useCallback(async () => {
    const current = ++epoch.current;
    if (!user) { setSpaces([]); setMembers([]); setCatalog({}); return; }
    const nextSpaces = await api.call('teams', 'list');
    if (current !== epoch.current) return;
    setSpaces(nextSpaces);
    if (active && !nextSpaces.some(s => s.id === active.id)) { setActive(null); setMembers([]); setForm(null); setCatalog({}); return; }
    try {
      const nextMembers = active ? await api.call('teams', 'roster', { orgId: active.id }) : [];
      if (current === epoch.current) { setMembers(nextMembers); setError(''); }
    } catch (error) { if (current === epoch.current) { setMembers([]); setForm(null); setCatalog({}); } throw error; }
  }, [api, user?.id, user?.name, user?.nickname, user?.avatar, active?.id, owner]);
  useEffect(() => {
    let alive = true;
    const update = () => refresh().catch(e => alive && setError(e.message));
    update(); const unsubscribe = api.subscribe('teams', update);
    window.addEventListener('focus', update); window.addEventListener('online', update);
    return () => { alive = false; epoch.current++; unsubscribe(); window.removeEventListener('focus', update); window.removeEventListener('online', update); };
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
    <label className="teams-space">Espaço<select value={active?.id || ''} onChange={e => { setMembers([]); setCatalog({}); setForm(null); setTab('members'); setActive(spaces.find(s => s.id === e.target.value) || null); }}><option value="">Selecione um espaço</option>{spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    {active && <div className="tabs" role="group" aria-label="Seções da equipe"><button type="button" aria-pressed={tab === 'members'} className={tab === 'members' ? 'selected' : ''} onClick={() => setTab('members')}>Membros</button>{owner && <button type="button" aria-pressed={tab === 'sharing'} className={tab === 'sharing' ? 'selected' : ''} onClick={() => setTab('sharing')}>Compartilhamento</button>}</div>}
    {active && tab === 'members' && <section className="teams-section"><div className="teams-section-heading"><h2>{active.name}</h2>{owner && <button className="primary" disabled={busy} onClick={() => edit()}>Convidar pessoa</button>}</div>
      <p>{owner ? 'Você é o proprietário. Convites só liberam acesso após a aceitação.' : 'As permissões são gerenciadas pelo proprietário.'}</p>
      {members.map(m => <article className="teams-row" key={m.id}><div className="teams-member"><MemberAvatar avatar={m.avatar} /><div><strong>{m.name || m.nickname || 'Conta cadastrada'}</strong>{m.nickname && <small>@{m.nickname}</small>}<p>{m.role === 'owner' ? 'Proprietário' : statuses[m.status]}</p></div></div><div className="teams-actions">
        {owner && m.role !== 'owner' && ['pending', 'accepted'].includes(m.status) && <><button className="secondary" disabled={busy} onClick={() => edit(m)}>Rever permissões</button><button className="secondary" disabled={busy} onClick={() => setForm({ type: 'revoke', member: m })}>Remover acesso</button></>}
      </div></article>)}
    </section>}
    {active && owner && tab === 'sharing' && <Sharing key={active.id} api={api} orgId={active.id} busy={busy} run={run} />}
    {form && <Modal title={form.type === 'create' ? 'Criar espaço' : form.type === 'invite' ? 'Convidar pessoa' : form.type === 'revoke' ? 'Remover acesso' : 'Rever permissões'} onClose={close}>
      {error && <p role="alert" className="teams-error">{error}</p>}
      {form.type === 'create' ? <form className="teams-form" onSubmit={e => { e.preventDefault(); run(async () => { const s = await api.call('teams', 'create', { name }); setActive(s); setForm(null); }, 'Espaço criado.'); }}><label>Nome<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label><button className="primary" disabled={busy}>Criar</button></form>
      : form.type === 'revoke' ? <div className="teams-form"><p>Remover o acesso desta pessoa ao espaço e aos recursos compartilhados?</p><button className="primary" disabled={busy} onClick={() => run(async () => { await api.call('teams', 'revoke', { orgId: active.id, id: form.member.id, revision: form.member.revision }); setForm(null); }, 'Acesso removido.')}>Remover acesso</button></div>
      : <div className="teams-form">
        {form.type === 'invite' && <><form onSubmit={search}><label>E-mail exato, nome ou apelido<input value={query} minLength={3} maxLength={100} required onChange={e => { setQuery(e.target.value); setPerson(null); setResults([]); searchEpoch.current++; }} /></label><button className="secondary" disabled={busy}>Buscar conta</button></form><small>Apenas contas já cadastradas. Até cinco resultados, sem listar e-mails.</small>
          <div role="group" aria-label="Pessoas encontradas">{results.map(p => <label className="teams-person" key={p.id}><input type="radio" name="teams-recipient" checked={person?.id === p.id} onChange={() => setPerson(p)} /><span>{p.name || 'Sem nome'} {p.nickname && `(@${p.nickname})`}</span></label>)}</div>
          {person && <p>Convidar: <strong>{person.name || person.nickname}</strong></p>}
        </>}
        <Permissions value={access} onChange={setAccess} catalog={catalog} disabled={busy} />
        <div className="teams-actions"><button className="secondary" disabled={busy} onClick={close}>Cancelar</button><button className="primary" disabled={busy || (form.type === 'invite' && !person)} onClick={() => run(async () => {
          await api.call('teams', form.type === 'invite' ? 'invite' : 'permissions', { orgId: active.id, recipientId: person?.id, id: form.member?.id, revision: form.member?.revision, grants: access }); setForm(null);
        }, form.type === 'invite' ? 'Convite enviado. O acesso depende da aceitação.' : 'Permissões atualizadas.')}>{form.type === 'invite' ? 'Enviar convite' : 'Salvar permissões'}</button></div>
      </div>}
    </Modal>}
  </section>;
}

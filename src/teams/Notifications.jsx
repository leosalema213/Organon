import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, RefreshCw, Trash2, X } from 'lucide-react';
import PopupMenu from '../PopupMenu.jsx';
import { MODULE_LABELS } from './Permissions.jsx';
import './notifications.css';

const labels = { invitation: 'Convite para participar', permissions: 'Permissões atualizadas', revoke: 'Acesso removido', accepted: 'Convite aceito', declined: 'Convite recusado' };

export default function Notifications({ api, user, count = 0 }) {
  if (!user) return null;
  return <PopupMenu key={user.id} label={`Notificações${count ? ` · ${count} não lida(s)` : ''}`} icon={Bell} badge={count} iconOnly className="icon-button notification-trigger">
    {({ close }) => <Inbox api={api} close={close} />}
  </PopupMenu>;
}

function Inbox({ api, close }) {
  const [data, setData] = useState({ notifications: [], invitations: [], unreadCount: 0 });
  const [tab, setTab] = useState('notifications'), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [confirmAll, setConfirmAll] = useState(false);
  const epoch = useRef(0), alive = useRef(true), working = useRef(false);
  const refresh = useCallback(async () => {
    const stamp = ++epoch.current;
    try { const next = await api.call('teams', 'inbox'); if (alive.current && stamp === epoch.current) { setData(next); setError(''); } }
    catch (error) { if (alive.current && stamp === epoch.current) { setData({ notifications: [], invitations: [], unreadCount: 0 }); setError(error.message); } }
    finally { if (alive.current && stamp === epoch.current) setLoading(false); }
  }, [api]);
  useEffect(() => {
    alive.current = true; refresh();
    const stop = api.subscribe('teams', event => { if (event.type !== 'connection') refresh(); });
    const reconnect = () => refresh(); window.addEventListener('online', reconnect); window.addEventListener('focus', reconnect);
    return () => { alive.current = false; epoch.current++; stop(); window.removeEventListener('online', reconnect); window.removeEventListener('focus', reconnect); };
  }, [api, refresh]);
  async function run(action, payload = {}) {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { await api.call('teams', action, payload); await refresh(); if (alive.current) setConfirmAll(false); }
    catch (error) { if (alive.current) setError(error.message); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="notification-inbox" aria-busy={busy || loading}>
    <header><h2>Notificações</h2><div className="button-row"><button type="button" className="icon-button" title="Atualizar notificações" aria-label="Atualizar notificações" disabled={busy} onClick={refresh}><RefreshCw size={15} /></button><button type="button" className="icon-button" title="Fechar notificações" aria-label="Fechar notificações" onClick={close}><X size={16} /></button></div></header>
    <div className="tabs" role="group" aria-label="Tipo de aviso"><button type="button" aria-pressed={tab === 'notifications'} className={tab === 'notifications' ? 'selected' : ''} onClick={() => { setTab('notifications'); setConfirmAll(false); }}>Notificações</button><button type="button" aria-pressed={tab === 'invitations'} className={tab === 'invitations' ? 'selected' : ''} onClick={() => { setTab('invitations'); setConfirmAll(false); }}>Convites ({data.invitations.length})</button></div>
    {error && <p role="alert" className="form-error">{error}</p>}
    {loading && <p role="status">Carregando…</p>}
    {tab === 'notifications' ? <>
      <div className="notification-actions"><button type="button" disabled={busy || !data.unreadCount} onClick={() => run('readAll')}>Marcar todas como lidas</button><button type="button" disabled={busy || !data.notifications.length} onClick={() => setConfirmAll(true)}>Excluir todas</button></div>
      {confirmAll && <div className="notification-confirm"><p>Excluir todas as notificações? Os convites pendentes continuam disponíveis na aba Convites.</p><div className="button-row"><button type="button" className="secondary" disabled={busy} onClick={() => setConfirmAll(false)}>Cancelar</button><button type="button" className="secondary" disabled={busy} onClick={() => run('deleteAllNotices')}>Confirmar exclusão</button></div></div>}
      {!loading && !data.notifications.length && <p className="muted">Nenhuma notificação.</p>}
      {data.notifications.map(n => <article key={n.id} className={`notification-item${n.read_at ? '' : ' unread'}`}><div><strong>{n.org_name}</strong><p>{labels[n.kind] || 'Atualização da equipe'}</p><time dateTime={n.created_at}>{new Date(n.created_at).toLocaleString('pt-BR')}</time>{!n.read_at && <button type="button" disabled={busy} onClick={() => run('read', { id: n.id })}>Marcar como lida</button>}</div><button type="button" className="icon-button" aria-label={`Excluir notificação de ${n.org_name}`} title="Excluir notificação" disabled={busy} onClick={() => run('deleteNotice', { id: n.id })}><Trash2 size={15} /></button></article>)}
    </> : <>
      {!loading && !data.invitations.length && <p className="muted">Nenhum convite pendente.</p>}
      {data.invitations.map(n => <article className="notification-item" key={n.member_id}><div><strong>{n.org_name}</strong><p>Convite para participar</p><ul>{Object.entries(MODULE_LABELS).map(([key, label]) => { const g = n.grants[key]; return <li key={key}>{label}: {g?.mode === 'all' ? 'todos, incluindo futuros' : g?.mode === 'selected' ? `${g.ids.length} selecionados` : 'nenhum'}{g?.mode && g.mode !== 'none' && g.write ? ' · edição' : ''}</li>; })}</ul><div className="button-row"><button type="button" className="primary" disabled={busy} onClick={() => run('respond', { id: n.member_id, revision: n.revision, response: 'accepted' })}>Aceitar</button><button type="button" className="secondary" disabled={busy} onClick={() => run('respond', { id: n.member_id, revision: n.revision, response: 'declined' })}>Recusar</button></div></div></article>)}
    </>}
  </section>;
}

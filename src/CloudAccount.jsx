import { useEffect, useRef, useState } from 'react';
import { Cloud, CloudOff, RefreshCw, LogOut } from 'lucide-react';
import wordmark from '../assets/branding/organon-wordmark.svg';
import './cloud.css';
import { waitForImages } from './images.js';
import { prepareProfileImage } from './profile-image.js';

export function syncMessage(status) {
  const progress = status?.progress;
  if (status?.busy) {
    if (progress?.stage === 'auth') return 'Conectando à conta…';
    if (progress?.stage === 'profile') return 'Salvando perfil…';
    if (progress?.stage === 'checking') return 'Conferindo a cópia da nuvem…';
    if (progress?.stage === 'preparing') return 'Preparando seus arquivos…';
    if (progress?.stage === 'uploading' && progress.total) return `Enviando arquivos: ${progress.completed} de ${progress.total}`;
    if (progress?.stage === 'committing') return 'Concluindo sincronização…';
    if (progress?.stage === 'downloading') return progress.total ? `Baixando arquivos e partes: ${progress.completed} de ${progress.total}` : 'Recebendo dados da nuvem…';
    if (progress?.stage === 'restoring') return 'Aplicando dados recebidos…';
    if (progress?.stage === 'plugins') return progress.total ? `Instalando plugins: ${progress.completed} de ${progress.total}` : 'Conferindo seus plugins…';
    return 'Sincronizando…';
  }
  if (status?.conflict) return 'Há cópias para conferir';
  if (status?.error) return 'Não foi possível sincronizar';
  if (status?.pluginError) return 'Plugins pendentes · tente sincronizar';
  if (status?.pending) return 'Envio pendente';
  return status?.lastSync ? 'Dados sincronizados' : 'Conta conectada';
}

export function SyncProgress({ status }) {
  if (!status?.busy) return null;
  const progress = status.progress;
  const measured = ['uploading', 'downloading', 'plugins'].includes(progress?.stage) && progress.total > 0;
  return <><progress className="cloud-progress" aria-label={syncMessage(status)} value={measured ? Math.min(progress.completed, progress.total) : undefined} max={measured ? progress.total : undefined} />{progress?.receivedItem && <small className="cloud-received">Recebido: {progress.receivedItem}</small>}</>;
}

function ProfileAvatar({ user }) {
  const label = user?.nickname || user?.name || user?.email || '?';
  return <span className="account-avatar" aria-hidden="true">{user?.avatar ? <img src={user.avatar} alt="" /> : label.trim().slice(0, 1).toLocaleUpperCase('pt-BR')}</span>;
}

export function AccountBadge({ account, saveError, onClick }) {
  const user = account.status?.user;
  if (!user) return <div className="local-badge"><span className="live-dot" /><span>{saveError ? 'Erro ao salvar' : 'Dados locais'}<small>{saveError ? 'Exporte um backup' : 'Salvos automaticamente'}</small></span></div>;
  return <button type="button" className="account-badge" onClick={onClick} title="Abrir meu perfil" aria-label="Abrir meu perfil"><ProfileAvatar user={user} /><span><strong>{user.nickname || user.name || user.email.split('@')[0]}</strong><small role="status">{saveError ? 'Erro ao salvar neste computador' : syncMessage(account.status)}</small><SyncProgress status={account.status} /></span></button>;
}

export function CloudIndicator({ status, onSync }) {
  const [syncing, setSyncing] = useState(false);
  const busy = syncing || status?.busy;
  const pending = status?.user && !status.conflict && (status.error || status.pluginError || status.pending);
  const label = !status?.user ? 'LOCAL' : busy ? 'SINCRONIZANDO' : status.conflict ? 'CONFERIR CÓPIAS' : pending ? 'ENVIO PENDENTE' : 'CONECTADO';
  const content = <><span className="live-dot" />{label}</>;
  if (onSync && (syncing || pending && !status.busy)) {
    return <button type="button" className="local-pill" title={busy ? 'Sincronizando…' : 'Sincronizar agora'} disabled={busy} onClick={async () => {
      setSyncing(true);
      try { await onSync(); } finally { setSyncing(false); }
    }}>{content}</button>;
  }
  return <span className="local-pill" title={status?.user ? syncMessage(status) : 'Dados salvos neste computador'}>{content}</span>;
}

export function useCloudAccount(ready, { flush, restore, refreshShared }) {
  const [status, setStatus] = useState(null), [open, setOpen] = useState(false), [error, setError] = useState('');
  const [conflictOpen, setConflictOpen] = useState(false);
  const conflictKey = useRef(null);
  const callbacks = useRef(); callbacks.current = { flush, restore, refreshShared };
  useEffect(() => {
    const key = status?.conflict ? `${status.user?.id}:${status.conflict.updatedAt}:${status.conflict.differentAccount}` : null;
    if (key && key !== conflictKey.current) setConflictOpen(true);
    if (!key) setConflictOpen(false);
    conflictKey.current = key;
  }, [status]);
  useEffect(() => {
    if (!ready || !window.desktop?.cloud) return;
    let mounted = true;
    const unsubscribe = window.desktop.cloud.onStatus(value => { if (mounted) setStatus(value); });
    window.desktop.cloud.status().then(value => {
      if (!mounted) return;
      setStatus(value); setOpen(value.enabled !== false && !value.promptSeen && !value.user);
      if (value.user) window.desktop.cloud.sync().catch(() => {});
    }).catch(() => setError('Não foi possível consultar a conta. Continue offline.'));
    const close = window.desktop.cloud.onPrepareClose(async () => {
      await waitForImages();
      await callbacks.current.flush(true);
      window.desktop.cloud.closeReady().catch(() => {});
    });
    return () => { mounted = false; unsubscribe(); close(); };
  }, [ready]);
  async function call(action) {
    setError('');
    try { const value = await action(); if (value) setStatus(value); return value; }
    catch (error) { setError(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); return null; }
  }
  return { status, open, error, conflictOpen, dismissConflict: () => setConflictOpen(false),
    show: () => { setError(''); setOpen(true); },
    close: async () => { if (await call(() => window.desktop.cloud.skip())) setOpen(false); },
    authenticate: async (mode, email, password, profile) => {
      if (!await callbacks.current.flush(false)) { setError('Salve um backup antes de conectar: o salvamento local falhou.'); return; }
      const value = await call(() => window.desktop.cloud.authenticate(mode, email, password, profile));
      if (value?.user) { setOpen(false); call(() => window.desktop.cloud.sync()); }
      return value;
    },
    sync: () => call(async () => { if (!await callbacks.current.flush(false)) throw new Error('Não foi possível salvar os dados locais.'); const result = await window.desktop.cloud.sync(); await callbacks.current.refreshShared?.(); return result; }),
    signOut: () => call(() => window.desktop.cloud.signOut()),
    updateProfile: value => call(() => window.desktop.cloud.updateProfile(value)),
    chooseLocal: () => call(async () => { if (!await callbacks.current.flush(false)) throw new Error('Não foi possível salvar os dados locais.'); return window.desktop.cloud.chooseLocal(); }),
    chooseRemote: () => call(async () => {
      if (!await callbacks.current.flush(true)) throw new Error('Não foi possível preservar seus dados locais.');
      const data = await window.desktop.cloud.download();
      if (!await callbacks.current.restore(data)) throw new Error('Não foi possível salvar o backup neste computador.');
      const result = await window.desktop.cloud.acceptDownload();
      await callbacks.current.refreshShared?.();
      return result;
    }),
  };
}

export function SyncConflictDialog({ account, Modal }) {
  const [choice, setChoice] = useState(null), [working, setWorking] = useState(false);
  const disabled = working || account.status?.busy;
  async function apply() {
    setWorking(true);
    try {
      const result = await (choice === 'remote' ? account.chooseRemote() : account.chooseLocal());
      if (result && !result.conflict) account.dismissConflict();
    } finally { setWorking(false); }
  }
  return <Modal small title="Seus dados estão na nuvem" onClose={() => !disabled && account.dismissConflict()}>
    <p>{account.status?.conflict?.differentAccount ? 'Os dados deste computador estavam vinculados a outra conta.' : 'Encontramos uma cópia diferente na sua conta. Escolha como começar neste computador.'}</p>
    <p>Ao trazer os dados da nuvem, guardaremos uma cópia de recuperação dos dados locais. Os plugins dessa cópia serão instalados automaticamente.</p>
    {choice && <p>{choice === 'remote' ? 'Trazer a cópia da nuvem e substituir os dados deste computador?' : 'Substituir a cópia da nuvem pelos dados deste computador?'}</p>}
    <p role="status">{disabled ? syncMessage(account.status) : ''}</p><SyncProgress status={account.status} />
    {(account.error || account.status?.error) && <p className="form-error" role="alert">{account.error || account.status.error}</p>}
    <div className="modal-actions">
      {working && <button className="secondary" onClick={account.dismissConflict}>Continuar usando</button>}
      <button className="secondary" disabled={disabled} onClick={() => choice ? setChoice(null) : account.dismissConflict()}>{choice ? 'Voltar' : 'Depois'}</button>
      {choice ? <button className="primary" disabled={disabled} onClick={apply}>Confirmar escolha</button> : <><button className="secondary" disabled={disabled} onClick={() => setChoice('local')}>Usar dados locais</button><button className="primary" disabled={disabled} onClick={() => setChoice('remote')}>Trazer dados da nuvem</button></>}
    </div>
  </Modal>;
}

export function AccountDialog({ account, Modal }) {
  const [mode, setMode] = useState('login'), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0), [name, setName] = useState(''), [nickname, setNickname] = useState(''), [avatar, setAvatar] = useState(null), [photoError, setPhotoError] = useState('');
  const firstField = useRef();
  useEffect(() => { firstField.current?.focus(); }, [mode, step]);
  const disabled = busy || account.status?.busy;
  async function photo(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    setBusy(true); setPhotoError('');
    try { setAvatar(await prepareProfileImage(file)); } catch (error) { setPhotoError(error.message); } finally { setBusy(false); }
  }
  async function submit(event) {
    event.preventDefault();
    if (disabled) return;
    if (mode === 'signup' && step < 2) {
      if (step === 0 && (!name.trim() || !nickname.trim())) return;
      setStep(value => value + 1); return;
    }
    setBusy(true);
    try {
      const result = await account.authenticate(mode, email, password, mode === 'signup' ? { name: name.trim(), nickname: nickname.trim(), avatar } : undefined);
      if (!result?.user && mode === 'signup') setStep(1);
    } finally { setBusy(false); setPassword(''); }
  }
  return <Modal title="Sua conta" small className="account-modal" onClose={() => !disabled && account.close()}>
    <span className="account-wordmark" style={{ maskImage: `url(${wordmark})` }} role="img" aria-label="Organon" />
    <p className="account-intro">Seu espaço, onde você estiver.</p>
    <div className="account-tabs" role="tablist" aria-label="Acesso à conta">
      <button role="tab" aria-selected={mode === 'login'} onClick={() => { setMode('login'); setStep(0); setPassword(''); setPhotoError(''); }} disabled={disabled}>Entrar</button>
      <button role="tab" aria-selected={mode === 'signup'} onClick={() => { setMode('signup'); setStep(0); setPassword(''); setPhotoError(''); }} disabled={disabled}>Criar conta</button>
    </div>
    <form className="account-form" onSubmit={submit}>
      {mode === 'signup' && <p className="account-step" role="status">Etapa {step + 1} de 3 · {['Seu perfil', 'Seu acesso', 'Sua foto (opcional)'][step]}</p>}
      {mode === 'signup' && step === 0 && <><label>Nome<input ref={firstField} autoComplete="name" required maxLength={80} value={name} onChange={event => setName(event.target.value)} disabled={disabled} /></label><label>Apelido<input autoComplete="nickname" required maxLength={40} value={nickname} onChange={event => setNickname(event.target.value)} disabled={disabled} /></label></>}
      {(mode === 'login' || step === 1) && <><label>E-mail<input ref={firstField} type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={disabled} /></label><label>Senha<input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={mode === 'signup' ? 8 : 1} maxLength={256} placeholder={mode === 'signup' ? 'Pelo menos 8 caracteres' : ''} value={password} onChange={event => setPassword(event.target.value)} disabled={disabled} /></label></>}
      {mode === 'signup' && step === 2 && <><p>Você pode escolher uma foto agora ou adicionar depois no seu perfil.</p><div className="profile-photo"><ProfileAvatar user={{ name, nickname, avatar }} /><label className="secondary file-label">Escolher foto<input ref={firstField} type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={photo} /></label>{avatar && <button type="button" className="secondary" disabled={disabled} onClick={() => setAvatar(null)}>Remover foto</button>}</div></>}
      {photoError && <p className="form-error" role="alert">{photoError}</p>}
      {account.error && <p className="form-error" role="alert">{account.error}</p>}
      <div className="modal-actions account-actions">
        <button className="primary" type="submit" disabled={disabled || (mode === 'signup' && step === 0 && (!name.trim() || !nickname.trim()))}>{disabled ? 'Aguarde…' : mode === 'signup' ? step < 2 ? 'Continuar' : avatar ? 'Criar minha conta' : 'Pular foto e criar conta' : 'Entrar na minha conta'}</button>
        {mode === 'signup' && step > 0 && <button className="secondary" type="button" disabled={disabled} onClick={() => setStep(value => value - 1)}>Voltar</button>}
        <button className="account-offline" type="button" onClick={account.close} disabled={disabled}><CloudOff size={14} />Continuar offline</button>
      </div>
    </form>
  </Modal>;
}

export function CloudPanel({ account, Modal }) {
  const [choice, setChoice] = useState(null);
  const [editing, setEditing] = useState(false);
  const status = account.status;
  if (!window.desktop?.cloud) return <p>A conexão com a nuvem está disponível no aplicativo para Windows.</p>;
  return <div className="preference-section cloud-panel">
    <div className="cloud-heading">{status?.user ? <ProfileAvatar user={status.user} /> : <Cloud size={21} />}<div><h3>{status?.user?.nickname || status?.user?.name || (status?.user ? 'Sua conta' : 'Seu espaço na nuvem')}</h3><p>{status?.user?.email || 'Conecte quando quiser. Seus dados continuam neste computador.'}</p></div></div>
    {!status?.user ? <button className="primary" onClick={account.show}>Entrar ou criar conta</button> : <>
      <p role="status">{syncMessage(status)}</p>
      {status.busy && status.progress?.stage !== 'profile' && <p>Você já está conectado. Pode continuar usando o Organon enquanto seus dados são sincronizados.</p>}
      <SyncProgress status={status} />
      {status.lastSync && <p>Última sincronização: {new Date(status.lastSync).toLocaleString('pt-BR')}</p>}
      {status.conflict && <div className="cloud-conflict">
        <strong>{status.conflict.differentAccount ? 'Estes dados locais estavam vinculados a outra conta.' : 'Este computador e a nuvem têm cópias diferentes.'}</strong>
        <p>Escolha qual cópia usar. Ao trazer a nuvem, guardamos uma cópia de recuperação dos dados locais.</p>
        {!choice ? <div className="button-row"><button className="secondary" disabled={status.busy} onClick={() => setChoice('local')}>Usar dados deste computador</button><button className="secondary" disabled={status.busy} onClick={() => setChoice('remote')}>Trazer dados da nuvem</button></div> : <>
          <p>{choice === 'local' ? 'Substituir a cópia online desta conta pelos dados deste computador?' : 'Substituir os dados deste computador pela cópia online desta conta?'}</p>
          <div className="button-row"><button className="primary" disabled={status.busy} onClick={async () => { await (choice === 'local' ? account.chooseLocal() : account.chooseRemote()); setChoice(null); }}>Confirmar escolha</button><button className="secondary" onClick={() => setChoice(null)} disabled={status.busy}>Cancelar</button></div>
        </>}
      </div>}
      <div className="button-row"><button className="primary" onClick={account.sync} disabled={status.busy || !!status.conflict}><RefreshCw size={15} />Sincronizar agora</button><button className="secondary" onClick={() => setEditing(true)} disabled={status.busy}>Editar perfil</button><button className="secondary" onClick={account.signOut} disabled={status.busy}><LogOut size={15} />Sair da conta</button></div>
      <p>Envia ao abrir, ao fechar e durante o uso após um dia, somente quando há mudanças.</p>
    </>}
    {(account.error || status?.error) && <p className="form-error" role="alert">{account.error || status.error}</p>}
    {status?.profileError && <p className="form-error" role="alert">{status.profileError}</p>}
    {status?.pluginError && <p className="form-error" role="alert">{status.pluginError}</p>}
    {editing && status?.user && <ProfileEditor account={account} Modal={Modal} onClose={() => setEditing(false)} />}
  </div>;
}

function ProfileEditor({ account, Modal, onClose }) {
  const user = account.status.user;
  const [name, setName] = useState(user.name || ''), [nickname, setNickname] = useState(user.nickname || '');
  const [avatar, setAvatar] = useState(user.avatar || null), [avatarChanged, setAvatarChanged] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function photo(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    setBusy(true); setError('');
    try { setAvatar(await prepareProfileImage(file)); setAvatarChanged(true); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await account.updateProfile({ name, nickname, ...(avatarChanged ? { avatar } : {}) });
      if (result) onClose();
    } finally { setBusy(false); }
  }
  return <Modal title="Meu perfil" small onClose={() => !busy && onClose()}><form className="editor-form account-profile-form" onSubmit={save}>
    <div className="profile-photo"><ProfileAvatar user={{ ...user, name, nickname, avatar }} /><label className="secondary file-label">Alterar foto<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={photo} /></label>{avatar && <button type="button" className="secondary" disabled={busy} onClick={() => { setAvatar(null); setAvatarChanged(true); }}>Remover foto</button>}</div>
    <label>Nome<input autoFocus maxLength={80} value={name} onChange={event => setName(event.target.value)} disabled={busy} /></label>
    <label>Apelido<input maxLength={40} value={nickname} onChange={event => setNickname(event.target.value)} disabled={busy} /></label>
    <p>O apelido aparece na barra lateral. Nome e foto acompanham sua conta nos outros computadores.</p>
    {(error || account.error) && <p className="form-error" role="alert">{error || account.error}</p>}
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" className="primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar perfil'}</button></div>
  </form></Modal>;
}

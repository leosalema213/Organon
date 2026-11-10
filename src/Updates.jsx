import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { version } from '../package.json';

export function useAppUpdates(enabled) {
  const [state, setState] = useState({ status: 'idle', currentVersion: version });
  const [open, setOpen] = useState(false);
  const dismissed = useRef(null);
  useEffect(() => {
    if (!enabled || !window.desktop?.updates) return;
    const receive = value => {
      setState(value);
      if ((value.status === 'available' && dismissed.current !== value.version) || value.status === 'ready') setOpen(true);
    };
    const unsubscribe = window.desktop.onUpdate(receive);
    window.desktop.updates.status().then(receive);
    const id = setTimeout(() => { window.desktop.updates.check().then(receive); }, 2000);
    return () => { clearTimeout(id); unsubscribe(); };
  }, [enabled]);
  return {
    state, open,
    dismiss: () => { dismissed.current = state.version; setOpen(false); },
    show: () => setOpen(true),
    check: async () => { if (window.desktop?.updates) setState(await window.desktop.updates.check()); },
    download: async () => { if (window.desktop?.updates) setState(await window.desktop.updates.download()); },
    install: async () => { if (window.desktop?.updates) setState(await window.desktop.updates.install()); },
    schedule: async () => {
      if (!window.desktop?.updates) return;
      const value = await window.desktop.updates.schedule(); setState(value);
      if (value.status === 'scheduled') setOpen(false);
    },
    cancelSchedule: async () => { if (window.desktop?.updates) setState(await window.desktop.updates.cancelSchedule()); },
  };
}

const messages = {
  idle: 'Verificação ao abrir o aplicativo.',
  checking: 'Verificando…',
  current: 'Você está na versão mais recente.',
  available: 'Há uma nova versão disponível.',
  downloading: 'Baixando a atualização…',
  ready: 'Atualização pronta para instalar.',
  scheduled: 'Atualização agendada para a próxima abertura.',
  installing: 'Aplicando atualização… O app será reaberto.',
  error: 'Não foi possível verificar ou baixar agora. Tente novamente.',
};
export function UpdateSettings({ updates }) {
  const { state } = updates;
  const busy = ['checking', 'downloading', 'installing'].includes(state.status);
  return <section className="update-settings"><div className="setting-row"><div><strong>Organon {state.currentVersion}</strong><p role="status">{state.message || messages[state.status]}</p></div>{['available', 'ready', 'scheduled', 'downloading'].includes(state.status)
    ? <button className="secondary" onClick={updates.show}>Ver atualização</button>
    : <button className="secondary" disabled={busy || !window.desktop} onClick={updates.check}><RefreshCw size={14} />{busy ? 'Verificando…' : 'Verificar atualização'}</button>}</div></section>;
}

export function UpdateDialog({ updates, onInstall, Modal }) {
  const { state, dismiss } = updates;
  const scheduled = state.status === 'scheduled';
  const ready = state.status === 'ready' || scheduled;
  const busy = ['downloading', 'installing'].includes(state.status);
  return <Modal title={state.status === 'installing' ? 'Atualizando o Organon' : scheduled ? 'Atualização agendada' : ready ? 'Pronto para atualizar' : 'Nova versão disponível'} subtitle={`Organon ${state.currentVersion} → ${state.version}`} onClose={dismiss} small={!ready} className={ready ? 'update-ready' : ''}>
    <div className="update-body"><p>{state.message || (state.status === 'installing' ? 'Aplicando a atualização em segundo plano. O aplicativo será reaberto ao terminar.' : scheduled ? 'Você pode continuar usando o app. A atualização será instalada na próxima vez que abrir o Organon. Seus dados serão mantidos.' : ready ? 'Atualize agora ou deixe a instalação para a próxima abertura do Organon. Seus dados serão mantidos.' : busy ? 'Você pode continuar estudando enquanto o download termina.' : 'Deseja baixar e atualizar o aplicativo?')}</p>
      {busy && <><progress max="100" value={state.status === 'installing' ? undefined : state.percent || 0} /><span>{state.status === 'installing' ? 'Reiniciando…' : `${Math.round(state.percent || 0)}%`}</span></>}
      <div className="modal-actions">
        {!ready && state.status !== 'installing' && <button className="secondary" onClick={dismiss}>{busy ? 'Continuar estudando' : 'Depois'}</button>}
        {!busy && ready && <button className="secondary" onClick={scheduled ? updates.cancelSchedule : updates.schedule}>{scheduled ? 'Cancelar agendamento' : 'Instalar na próxima abertura'}</button>}
        {!busy && <button className="primary" onClick={ready ? onInstall : updates.download}><Download size={15} />{ready ? 'Atualizar e reiniciar' : 'Baixar atualização'}</button>}
      </div>
    </div>
  </Modal>;
}

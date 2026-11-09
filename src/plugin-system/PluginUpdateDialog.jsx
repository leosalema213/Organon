import { useRef, useState } from 'react';
import Modal from '../Modal.jsx';
import { pluginBridge } from './runtime.js';

export default function PluginUpdateDialog({ plugins, hidden = false, bridge = pluginBridge() }) {
  const [dismissed, setDismissed] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [progress, setProgress] = useState(null);
  const running = useRef(false);
  const available = plugins.plugins.filter(plugin => plugin.installed && plugin.updateAvailable);
  const key = plugin => `${plugin.id}:${plugin.availableVersion}`;
  const updates = available.filter(plugin => !dismissed.includes(key(plugin)));
  function dismiss() { if (!busy) { setDismissed(current => [...new Set([...current, ...available.map(key)])]); setError(''); } }
  async function update() {
    if (running.current || !bridge || plugins.busy) return;
    running.current = true; setBusy(true); setError('');
    try {
      for (let index = 0; index < updates.length; index++) {
        const plugin = updates[index];
        setProgress({ name: plugin.name, completed: index, total: updates.length });
        await bridge.install(plugin.id);
      }
      setProgress(null);
    } catch (error) { setError(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
    finally { running.current = false; setBusy(false); }
  }
  if ((!updates.length && !busy && !error) || (hidden && !busy)) return null;
  return <Modal small title="Atualizações de plugins" onClose={dismiss}>
    <p>{busy ? `Atualizando ${progress?.name || 'plugins'}…` : 'Um ou mais plugins que você usa têm uma nova versão. Deseja atualizar agora?'}</p>
    <ul>{updates.map(plugin => <li key={plugin.id}>{plugin.name}: {plugin.version} → {plugin.availableVersion}</li>)}</ul>
    {busy && <progress className="cloud-progress" aria-label="Atualizando plugins" value={progress?.completed || 0} max={progress?.total || 1} />}
    {error && <p className="form-error" role="alert">{error}</p>}
    <p>Seus dados serão preservados. Você também pode atualizar depois nas preferências.</p>
    <div className="modal-actions"><button className="secondary" disabled={busy} onClick={dismiss}>Depois</button><button className="primary" disabled={busy || plugins.busy || !updates.length} onClick={update}>{busy ? 'Atualizando…' : 'Atualizar agora'}</button></div>
  </Modal>;
}

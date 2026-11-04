import React, { useCallback, useEffect, useState } from 'react';
import Modal from '../Modal.jsx';
import { pluginBridge } from './runtime.js';
import './plugins.css';

export default function PluginSettings({ bridge = pluginBridge(), onChanged }) {
  const [status, setStatus] = useState(null), [busy, setBusy] = useState(false), [checking, setChecking] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [removing, setRemoving] = useState(null);
  const refresh = useCallback(async () => {
    if (!bridge) return;
    const result = await bridge.list(); setStatus(result); onChanged?.(result.plugins);
  }, [bridge, onChanged]);
  useEffect(() => {
    let live = true;
    async function load() {
      if (!bridge) return;
      setChecking(true);
      try {
        const value = await bridge.list();
        if (!live) return;
        setStatus(value);
        if (!value.configured || value.busy) return;
        await bridge.check();
        const updated = await bridge.list();
        if (live) { setStatus(updated); onChanged?.(updated.plugins); }
      } catch (e) { if (live) setError(e.message || 'Não foi possível consultar os plugins.'); }
      finally { if (live) setChecking(false); }
    }
    load();
    const unsubscribe = bridge?.onChanged?.(value => { if (live) { setStatus(value); onChanged?.(value.plugins); } });
    return () => { live = false; unsubscribe?.(); };
  }, [bridge, onChanged]);
  async function run(action, success) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); await refresh(); setNotice(success); }
    catch (e) { setError(e.message || 'Não foi possível concluir a operação.'); }
    finally { setBusy(false); }
  }
  const disabled = busy || checking || status?.busy;
  return <div className="organon-plugin-settings">
    <div className="preference-section"><h3>Plugins do Organon</h3><p>Instale os adicionais que deseja usar. Remover um plugin preserva seus dados.</p>
      {!bridge ? <p>Os plugins estão disponíveis no aplicativo para computador.</p> : <button className="secondary" disabled={disabled || status?.configured === false} onClick={() => run(() => bridge.check(), 'Catálogo atualizado.')}>{checking ? 'Consultando plugins…' : busy ? 'Aguarde…' : 'Consultar plugins disponíveis'}</button>}
      {status?.configured === false && <p>O catálogo de plugins ainda não está disponível nesta instalação.</p>}
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    </div>
    {status?.plugins.map(plugin => <div className="preference-section" key={plugin.id}>
      <div className="setting-row"><div><h3>{plugin.name}</h3><p>{plugin.id === 'financeiro' ? 'Entradas, gastos, categorias e projeções do espaço.' : 'Filtros, cálculos e relatórios pessoais de MEI.'}</p><small>{plugin.installed ? `Instalado · ${plugin.version}` : 'Não instalado'}{plugin.availableVersion && ` · Disponível: ${plugin.availableVersion}`}</small></div>
        <div className="organon-plugin-actions">
          {(!plugin.installed || plugin.updateAvailable) && <button className="secondary" disabled={disabled || !plugin.availableVersion} onClick={() => run(() => bridge.install(plugin.id), `${plugin.name} instalado.`)}>{plugin.installed ? 'Baixar atualização' : 'Baixar e instalar'}</button>}
          {plugin.canRollback && plugin.version && <button className="secondary" disabled={disabled} onClick={() => run(() => bridge.rollback(plugin.id, plugin.version), 'Versão anterior recuperada.')}>Recuperar versão anterior</button>}
          {plugin.removable && <button className="secondary" disabled={disabled} onClick={() => setRemoving(plugin)}>Remover</button>}
        </div>
      </div>{plugin.error && <p role="alert">{plugin.error} Consulte o catálogo para reinstalar.</p>}
    </div>)}
    {removing && <Modal small title={`Remover ${removing.name}?`} onClose={() => !busy && setRemoving(null)}><p>O adicional será removido deste dispositivo. Seus lançamentos, configurações e relatórios serão preservados.</p><div className="modal-actions"><button className="secondary" disabled={disabled} onClick={() => setRemoving(null)}>Cancelar</button><button className="primary" disabled={disabled} onClick={() => { const id = removing.id; setRemoving(null); run(() => bridge.remove(id), 'Plugin removido. Seus dados foram preservados.'); }}>Remover plugin</button></div></Modal>}
  </div>;
}

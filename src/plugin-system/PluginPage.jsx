import React, { useEffect, useState } from 'react';
import { loadPlugin, pluginBridge } from './runtime.js';

// The shell must mount this only for installed plugins and key it by id + version.
export default function PluginPage({ id, api, user, workspace, bridge = pluginBridge() }) {
  const [loaded, setLoaded] = useState(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true, detach;
    setLoaded(null); setError('');
    loadPlugin(id, bridge).then(result => {
      if (!live) return;
      detach = result.mountStyles(); setLoaded(result);
    }).catch(e => { if (live) setError(e.message || 'Não foi possível abrir o plugin.'); });
    return () => { live = false; detach?.(); };
  }, [id, bridge, attempt]);
  if (error) return <section className="preference-section"><p role="alert">{error}</p><p>Você pode recuperar a versão anterior em Preferências → Plugins.</p><button className="secondary" onClick={() => setAttempt(n => n + 1)}>Tentar novamente</button></section>;
  if (!loaded) return <p role="status">Carregando plugin…</p>;
  return <PluginBoundary key={`${id}:${loaded.version}`}><loaded.Component api={api} user={user} workspace={workspace} /></PluginBoundary>;
}

class PluginBoundary extends React.Component {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (this.state.error) return <section className="preference-section"><p role="alert">Não foi possível exibir este plugin.</p><p>Abra Preferências → Plugins para recuperar a versão anterior ou reinstalar. Seus dados foram preservados.</p></section>;
    return this.props.children;
  }
}

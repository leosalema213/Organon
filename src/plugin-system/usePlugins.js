import { useEffect, useState } from 'react';
import { pluginBridge } from './runtime.js';

// Navigation starts empty, then reflects local installations without a download.
export default function usePlugins(bridge = pluginBridge()) {
  const [status, setStatus] = useState({ plugins: [], loading: !!bridge });
  useEffect(() => {
    let live = true;
    const receive = value => { if (live) setStatus({ ...value, loading: false }); };
    bridge?.list().then(receive).catch(error => { if (live) setStatus({ plugins: [], loading: false, error: error.message }); });
    const unsubscribe = bridge?.onChanged?.(receive);
    let lastCheck = 0, checking = false;
    async function check() {
      if (!bridge?.check || checking || Date.now() - lastCheck < 3600000) return;
      checking = true;
      try {
        const value = await bridge.list();
        if (!live || !value.configured || value.busy) return;
        lastCheck = Date.now();
        await bridge.check();
        if (live) receive(await bridge.list());
      } catch { /* Keep installed plugins available offline; settings provides manual retry. */ }
      finally { checking = false; }
    }
    check();
    const timer = setInterval(check, 3600000);
    window.addEventListener('online', check);
    window.addEventListener('focus', check);
    return () => { live = false; unsubscribe?.(); clearInterval(timer); window.removeEventListener('online', check); window.removeEventListener('focus', check); };
  }, [bridge]);
  return { ...status, installed: status.plugins.filter(plugin => plugin.installed) };
}

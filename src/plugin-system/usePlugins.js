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
    return () => { live = false; unsubscribe?.(); };
  }, [bridge]);
  return { ...status, installed: status.plugins.filter(plugin => plugin.installed) };
}

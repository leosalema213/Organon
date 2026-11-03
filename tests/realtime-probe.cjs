// Essential one-channel diagnostic, using only a new synthetic identity.
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto');
const config = require('../electron/cloud-config.cjs');
const { createClient } = require('../electron/vendor/supabase.cjs');
const run = randomUUID(), email = `organon-realtime-probe-${run}@example.com`;
let session, client;
const output = path.resolve(__dirname, '../test-output/realtime-probe-accounts.json');
const safe = value => String(value || '').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]').slice(0, 600);
(async () => {
  const response = await fetch(config.url + '/auth/v1/signup', { method: 'POST', headers: { apikey: config.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: randomUUID() + 'Aa1!' }), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Signup probe HTTP ${response.status}`);
  session = await response.json();
  if (!session.access_token || !session.user?.id) throw new Error('Synthetic session missing');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ run, account: { id: session.user.id, email } }, null, 2));
  client = createClient(config.url, config.key, { accessToken: async () => session.access_token, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  await client.realtime.setAuth(session.access_token);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime probe timed out')), 20000);
    client.channel('teams:user:' + session.user.id, { config: { private: true } }).on('broadcast', { event: 'invalidate' }, () => {}).subscribe((status, error) => {
      if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) {
        clearTimeout(timer); console.log(JSON.stringify({ status, message: safe(error?.message) }));
        status === 'SUBSCRIBED' ? resolve() : reject(new Error('Realtime probe failed'));
      }
    });
  });
})().catch(error => { console.error(safe(error.message)); process.exitCode = 1; }).finally(async () => {
  if (client) { await client.removeAllChannels().catch(() => {}); await client.realtime.disconnect(); }
  if (session?.access_token) await fetch(config.url + '/auth/v1/logout?scope=global', { method: 'POST', headers: { apikey: config.key, Authorization: 'Bearer ' + session.access_token }, signal: AbortSignal.timeout(10000) }).catch(() => {});
});

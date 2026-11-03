// Focused real Storage cache/revocation diagnostic. Synthetic identities only.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto');
const config = require('../electron/cloud-config.cjs');
const { createService, grants } = require('../electron/modules/teams.cjs');
const { privateDownloadPath, downloadHeaders } = require('../electron/shared-storage.cjs');
const run = randomUUID(), accounts = [], report = { run, ok: false, accounts: [], statuses: [] };
const folder = path.resolve(__dirname, '../test-output/storage-revocation', run);
let owner, member, org, invitation, published;
const resourceId = randomUUID();
async function request(endpoint, { token, method = 'GET', body, binary = false, headers = {} } = {}) {
  const response = await fetch(config.url + endpoint, { method, headers: { apikey: config.key, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: Buffer.isBuffer(body) ? body : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  if (endpoint.startsWith('/storage/v1/object/authenticated/')) report.statuses.push({ status: response.status, cache: response.headers.get('cf-cache-status'), cacheControl: response.headers.get('cache-control') });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
  if (binary) return Buffer.from(await response.arrayBuffer());
  const text = await response.text(); return text ? JSON.parse(text) : null;
}
async function signup(suffix) {
  const email = `organon-storage-probe-${run}-${suffix}@example.com`;
  const session = await request('/auth/v1/signup', { method: 'POST', body: { email, password: randomUUID() + 'Aa1!' } });
  assert(session.access_token && session.user?.id);
  report.accounts.push({ id: session.user.id, email });
  const account = { session, cloud: { ready: Promise.resolve(), enabled: true, status: () => ({ user: { id: session.user.id } }), token: async () => session.access_token,
    request: (endpoint, options = {}) => request(endpoint, { ...options, token: options.token || session.access_token }) } };
  accounts.push(account); return account;
}
(async () => {
  owner = await signup('a'); member = await signup('b');
  const image = Buffer.from('89504e470d0a1a0a01020304', 'hex');
  const notebook = { id: resourceId, name: 'Caderno sintético de diagnóstico', pages: [{ id: randomUUID(), title: 'Teste', text: 'Sintético', images: ['data:image/png;base64,' + image.toString('base64')] }] };
  owner.teams = createService({ cloud: owner.cloud, readData: () => ({ notebooks: [notebook], books: [] }) });
  member.teams = createService({ cloud: member.cloud });
  org = await owner.teams.dispatch('create', { name: 'Diagnóstico Storage ' + run }); report.orgId = org.id;
  published = await owner.teams.dispatch('publish', { orgId: org.id, module: 'notebooks', resourceId, revision: 0 });
  const rows = await owner.teams.dispatch('resources', { orgId: org.id });
  const object = rows.find(row => row.resource_id === resourceId).content.pages[0].images[0].object;
  report.object = object;
  invitation = await owner.teams.dispatch('invite', { orgId: org.id, recipientId: member.session.user.id, grants: grants({ notebooks: { mode: 'selected', ids: [resourceId], write: false } }) });
  invitation = await member.teams.dispatch('respond', { id: invitation.id, revision: invitation.revision, response: 'accepted' });
  assert.deepEqual(await member.cloud.request(privateDownloadPath('organon-shared', object), { binary: true, headers: downloadHeaders }), image);
  const cachedUrl = '/storage/v1/object/authenticated/organon-shared/' + object;
  assert.deepEqual(await member.cloud.request(cachedUrl, { binary: true }), image);
  invitation = await owner.teams.dispatch('revoke', { orgId: org.id, id: invitation.id, revision: invitation.revision });
  await assert.rejects(member.cloud.request(privateDownloadPath('organon-shared', object), { binary: true, headers: downloadHeaders }), error => [400, 401, 403, 404].includes(error.status));
  // Observe an old URL separately; it is never accepted as evidence of fresh authorization.
  try { assert.deepEqual(await member.cloud.request(cachedUrl, { binary: true }), image); report.oldUrlCached = true; }
  catch (error) { if (![400, 401, 403, 404].includes(error.status)) throw error; report.oldUrlCached = false; }
  report.ok = true;
})().catch(error => { report.error = error.message; process.exitCode = 1; }).finally(async () => {
  if (org && published) await owner.teams.dispatch('unpublish', { orgId: org.id, module: 'notebooks', resourceId, revision: published.revision }).catch(() => {});
  for (const account of accounts) await account.cloud.request('/auth/v1/logout?scope=global', { method: 'POST' }).catch(() => {});
  fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, 'audit.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createService, grants, extractResource, createLocalAdapters } = require('../electron/modules/teams.cjs');
const orgId = '11111111-1111-4111-8111-111111111111';
const recipientId = '22222222-2222-4222-8222-222222222222';
function setup(dependencies = {}) {
  const calls = [], events = [];
  const cloud = { enabled: true, ready: Promise.resolve(), token: async () => 'main-only', status: () => ({ user: { id: orgId } }), request: async (path, options) => { calls.push({ path, ...options }); return []; } };
  return { calls, events, cloud, service: createService({ cloud, emit: e => events.push(e), ...dependencies }) };
}
test('matrix rejects MEI/personal scopes and selected books or finance', () => {
  assert.throws(() => grants({ mei: { mode: 'all' } }));
  for (const module of ['books', 'financeiro']) assert.throws(() => grants({ [module]: { mode: 'selected', ids: [orgId] } }));
  assert.throws(() => grants({ notebooks: { mode: 'selected', ids: [] } }));
  const g = grants({ notebooks: { mode: 'selected', ids: [orgId, orgId], write: true } });
  assert.deepEqual(g.notebooks, { mode: 'selected', ids: [orgId], write: true });
  assert.equal(g.books.mode, 'none');
});
test('closed transport ignores renderer identity/status and targets UUID invitation', async () => {
  const { service, calls } = setup();
  await service.dispatch('invite', { orgId, recipientId, grants: {}, owner_id: recipientId, status: 'accepted', token: 'renderer-token' });
  assert.deepEqual(Object.keys(calls[0].body.p_payload).sort(), ['grants', 'orgId', 'recipientId']);
  assert.equal(calls[0].body.p_action, 'invite');
  assert.equal(calls[0].token, 'main-only');
  await assert.rejects(service.dispatch('arbitrarySQL', {}));
});
test('inbox actions discard renderer ownership and do not mutate memberships', async () => {
  const { service, calls, events } = setup();
  for (const action of ['inbox', 'readAll', 'deleteAllNotices']) await service.dispatch(action, { user_id: recipientId, orgId, id: recipientId });
  await service.dispatch('deleteNotice', { id: recipientId, user_id: orgId });
  await service.dispatch('roster', { orgId, owner_id: recipientId });
  assert.deepEqual(calls.slice(0, 3).map(c => c.body.p_payload), [{}, {}, {}]);
  assert.deepEqual(calls[3].body.p_payload, { id: recipientId });
  assert.deepEqual(calls[4].body.p_payload, { orgId });
  assert.equal(events.length, 3);
  assert.ok(calls.every(c => !['revoke', 'respond'].includes(c.body.p_action)));
  await assert.rejects(service.dispatch('deleteNotice', { id: 'invalid' }), /Identificador/);
});

test('roster loads only authenticated profile photos, verifies bytes and rechecks access', async () => {
  const { service, cloud } = setup();
  const bytes = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
  const hash = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  const member = { id: recipientId, user_id: recipientId, name: 'Pessoa sintética', avatar_hash: hash };
  const paths = []; let reads = 0;
  cloud.request = async (path, options) => {
    paths.push(path);
    if (path.includes('/rpc/')) { reads++; return [member]; }
    assert.match(path, new RegExp(`/storage/v1/object/authenticated/organon-assets/${recipientId}/${hash}\\?cacheNonce=`));
    assert.equal(options.headers['Cache-Control'], 'no-cache'); assert.equal(options.token, 'main-only');
    return bytes;
  };
  const result = await service.dispatch('roster', { orgId, avatar: 'https://untrusted.invalid/photo' });
  assert.equal(reads, 2); assert.equal(paths.length, 3);
  assert.equal(result[0].avatar, 'data:image/webp;base64,' + bytes.toString('base64'));
  assert.equal(Object.hasOwn(result[0], 'avatar_hash'), false);
});

test('missing or corrupt roster photos use placeholders; revoked access does not return images', async () => {
  const { service, cloud } = setup();
  const bytes = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
  const hash = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  let corrupt = true, revoke = false, reads = 0;
  cloud.request = async path => {
    if (path.includes('/rpc/')) { if (++reads > 1 && revoke) throw new Error('revoked'); return [{ id: recipientId, user_id: recipientId, avatar_hash: hash }, { id: orgId, user_id: orgId }]; }
    return corrupt ? Buffer.from('invalid') : bytes;
  };
  const result = await service.dispatch('roster', { orgId });
  assert.deepEqual(result.map(m => m.avatar), [null, null]);
  reads = 0; corrupt = false; revoke = true;
  await assert.rejects(service.dispatch('roster', { orgId }), /revoked/);
});

test('responses and permission updates require explicit expected revision', async () => {
  const { service, calls } = setup();
  await assert.rejects(service.dispatch('respond', { id: orgId, response: 'accepted' }));
  await assert.rejects(service.dispatch('respond', { id: orgId, response: 'admin', revision: 1 }));
  await service.dispatch('respond', { id: orgId, response: 'declined', revision: 2 });
  assert.equal(calls[0].body.p_payload.revision, 2);
  await assert.rejects(service.dispatch('permissions', { id: orgId, orgId, revision: -1, grants: {} }));
});
test('sharing serializes a single trusted resource, verifies owner and prepares private assets', async () => {
  const seen = [];
  const { service, calls } = setup({ serializeResource: async p => { seen.push(p); return { title: 'Synthetic book' }; }, prepareAssets: async p => ({ content: p.resource, assets: [] }) });
  await service.dispatch('publish', { orgId, module: 'books', resourceId: recipientId, revision: 0, content: { personalSnapshot: 'must not pass' } });
  assert.deepEqual(seen, [{ module: 'books', resourceId: recipientId }]);
  assert.equal(calls[0].body.p_action, 'members');
  assert.deepEqual(calls[1].body.p_payload.content, { title: 'Synthetic book' });
  await assert.rejects(service.dispatch('publish', { orgId, module: 'mei', resourceId: recipientId, revision: 0 }));
});
test('disabled cloud and absent adapters fail without pretending to share', async () => {
  const { service, cloud, calls } = setup(); cloud.enabled = false;
  await assert.rejects(service.dispatch('list')); assert.equal(calls.length, 0);
  cloud.enabled = true;
  await assert.rejects(service.dispatch('publish', { orgId, module: 'books', resourceId: recipientId, revision: 0 }));
});
test('private realtime lifecycle invalidates and requests full resync on reconnect', async () => {
  let receive, status, removed = 0; const channels = [];
  const realtimeClient = { channel: (topic, options) => { channels.push({ topic, options }); return { on: (_kind, _filter, fn) => { receive = fn; return { subscribe: fn => { status = fn; return { channel: true }; } }; } }; }, removeChannel: async () => { removed++; } };
  const { service, events } = setup({ realtimeClient });
  await service.start(); assert.equal(channels[0].options.config.private, true);
  status('SUBSCRIBED'); receive({ secret: 'never-forward-payload' });
  assert.deepEqual(events, [{ type: 'resync', status: 'SUBSCRIBED' }, { type: 'invalidate' }]);
  await service.stop(); status('SUBSCRIBED'); assert.equal(events.length, 2); assert.equal(removed, 1);
});
test('individual copy excludes personal study links, reading progress and unknown fields', () => {
  const data = { plans: [{ private: true }], books: [{ id: orgId, title: 'Synthetic', hash: 'a'.repeat(64), format: 'pdf', size: 5, page: 8, planIds: ['personal'], private: true }], notebooks: [{ id: recipientId, name: 'Notebook', pages: [{ id: orgId, text: 'Synthetic', images: [], document: { type: 'doc' }, private: true }] }] };
  assert.deepEqual(Object.keys(extractResource(data, 'books', orgId)).sort(), ['format', 'hash', 'id', 'size', 'title']);
  assert.equal(extractResource(data, 'notebooks', recipientId).pages[0].private, undefined);
  assert.throws(() => extractResource(data, 'plans', orgId));
});
test('asset preparation replaces embedded image bytes with private per-resource reference', async () => {
  const { cloud, calls } = setup();
  const adapter = createLocalAdapters({ cloud, readData: async () => ({}) });
  const result = await adapter.prepareAssets({ orgId, module: 'notebooks', resourceId: recipientId, resource: { images: ['data:image/png;base64,aGVsbG8='], text: 'Synthetic' } });
  assert.equal(result.assets.length, 1);
  assert.equal(result.content.images[0].bucket, 'organon-shared');
  assert.ok(result.assets[0].startsWith(`${orgId}/notebooks/${recipientId}/`));
  assert.equal(calls[0].token, 'main-only');
  assert.equal(result.content.text, 'Synthetic');
});
test('conflict invalidates stale data and never retries the write', async () => {
  const { service, cloud, calls, events } = setup();
  let attempts = 0;
  cloud.request = async () => { attempts++; const e = new Error('conflict'); e.code = 'PT409'; throw e; };
  await assert.rejects(service.dispatch('revoke', { orgId, id: recipientId, revision: 1 }), /registro mudou/);
  assert.equal(attempts, 1); assert.equal(calls.length, 0);
  assert.deepEqual(events, [{ type: 'invalidate' }]);
});

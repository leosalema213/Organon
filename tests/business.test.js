import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createBusiness, CHUNK_SIZE } = require('../electron/business.cjs');
const { BookFiles } = require('../electron/books.cjs');
const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORG = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RESOURCE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const BOARD = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function harness(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-business-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let userId = U, data = { books: [], notebooks: [] };
  const events = [], clients = [], requests = [], assets = new Map(), installed = new Set();
  const server = { permission: true, resource: null, spaces: [{ id: ORG, name: 'Espaço sintético', owner_id: U }], reads: 0, beforeRequest: null };
  const cloud = { ready: Promise.resolve(), enabled: true,
    status: () => ({ user: userId ? { id: userId, email: 'synthetic@example.invalid' } : null }),
    token: async () => { if (!userId) throw new Error('Entre novamente'); return 'private-token-for-' + userId; },
    request: async (endpoint, options = {}) => {
      requests.push({ endpoint, ...options });
      if (server.beforeRequest) await server.beforeRequest(endpoint, options);
      if (endpoint === '/rest/v1/rpc/organon_teams') {
        if (options.body.p_action === 'list') return server.spaces;
        if (['members','roster'].includes(options.body.p_action)) return [];
        if (options.body.p_action === 'publish') {
          const p = options.body.p_payload;
          server.resource = { org_id: p.orgId, module: p.module, resource_id: p.resourceId, content: p.content, revision: 1 };
          return server.resource;
        }
        throw new Error('Unexpected teams action');
      }
      if (endpoint === '/rest/v1/rpc/organon_kanban') return options.body.p_action === 'getBoards' ? [{ id: BOARD }] : {};
      if (endpoint === '/rest/v1/rpc/organon_can_access_resource') return server.permission;
      if (endpoint === '/rest/v1/rpc/financeiro_snapshot') return { entries: [], types: [], canWrite: true };
      if (endpoint.startsWith('/rest/v1/organon_shared_resources?')) { server.reads++; return server.permission && server.resource ? [server.resource] : []; }
      if (endpoint.startsWith('/storage/v1/object/authenticated/organon-shared/')) {
        if (!server.permission) throw new Error('Storage access revoked');
        const object = new URL(endpoint, 'https://storage.example.invalid').pathname.split('/organon-shared/')[1];
        if (!assets.has(object)) throw new Error('Missing asset'); return assets.get(object);
      }
      if (endpoint.startsWith('/storage/v1/object/organon-shared/')) {
        assert.equal(options.method, 'POST'); assets.set(endpoint.split('/organon-shared/')[1], options.body); return {};
      }
      throw new Error('Unexpected endpoint: ' + endpoint);
    } };
  const plugins = { list: async () => ({ plugins: ['financeiro', 'mei'].map(id => ({ id, installed: installed.has(id) })) }) };
  const factory = async () => {
    const client = { channels: [], removed: [], tokens: [], realtime: { setAuth: async token => { client.tokens.push(token); }, disconnect: () => {} },
      channel(topic, options) {
        const channel = { topic, options, callbacks: {}, on(_type, filter, callback) { this.callbacks[filter.event] = callback; return this; },
          subscribe(callback) { this.status = callback; callback('SUBSCRIBED'); return this; } };
        client.channels.push(channel); return channel;
      },
      removeChannel: async channel => { client.removed.push(channel); }, removeAllChannels: async () => {} };
    clients.push(client); return client;
  };
  const books = new BookFiles(path.join(directory, 'source'));
  function create(store = books, readData = () => data) {
    const business = createBusiness({ cloud, plugins, readData, books: store, emit: event => events.push(event), createRealtimeClient: factory });
    t.after(() => business.dispose()); return business;
  }
  return { directory, cloud, plugins, server, events, clients, requests, assets, installed, books, create,
    get data() { return data; }, set data(value) { data = value; }, setUser(value) { userId = value; } };
}

test('business router rejects arbitrary endpoints and optional modules before installation', async t => {
  const h = harness(t), business = h.create();
  await assert.rejects(business.dispatch('sql', 'execute', {}), /inválida/);
  await assert.rejects(business.dispatch('teams', 'request', { endpoint: '/rest/v1/secret' }), /inválida/);
  await assert.rejects(business.dispatch('financeiro', 'snapshot', { orgId: ORG }), /Instale/);
  assert(!h.requests.some(r => r.endpoint.includes('financeiro_snapshot')));
  h.installed.add('financeiro'); assert.deepEqual(await business.dispatch('financeiro', 'snapshot', { orgId: ORG }), { entries: [], types: [], canWrite: true });
  h.installed.delete('financeiro'); await assert.rejects(business.dispatch('financeiro', 'snapshot', { orgId: ORG }), /Instale/);
});
test('consulta leve da revisão revalida acesso e não entrega conteúdo ou identidade do renderer', async t => {
  const h = harness(t), business = h.create();
  h.server.resource = { org_id: ORG, module: 'notebooks', resource_id: RESOURCE, revision: 4, content: { private: true } };
  assert.deepEqual(await business.dispatch('teams', 'resourceVersion', { orgId: ORG, module: 'notebooks', resourceId: RESOURCE, userId: OTHER }), { revision: 4, canWrite: true });
  assert(h.requests.some(request => request.endpoint.endsWith('&select=revision')));
  h.server.permission = false;
  await assert.rejects(business.dispatch('teams', 'resourceVersion', { orgId: ORG, module: 'notebooks', resourceId: RESOURCE }), /sem permissão/);
  await assert.rejects(business.dispatch('teams', 'resourceVersion', { orgId: ORG, module: 'notebooks', resourceId: 'invalid' }), /Identificador/);
});

test('busy status does not reopen realtime; private channels emit only sanitized invalidations and resync', async t => {
  const h = harness(t), business = h.create(); h.installed.add('financeiro');
  await business.syncSession(); await business.syncSession();
  assert.equal(h.clients.length, 1); assert.equal(h.clients[0].channels.length, 1);
  await business.watchWorkspace(ORG);
  const client = h.clients[0], finance = client.channels.find(c => c.topic === 'financeiro:' + ORG);
  assert(client.channels.every(c => c.options.config.private === true)); assert(finance);
  finance.callbacks.changed({ payload: { value: 'private record', access_token: 'do-not-forward' } });
  client.channels[0].status('private-token-should-not-be-a-status');
  assert(h.events.some(e => e.module === 'financeiro' && e.type === 'resync'));
  assert(h.events.some(e => e.module === 'mei' && e.type === 'changed'));
  assert(!JSON.stringify(h.events).includes('private-token')); assert(!JSON.stringify(h.events).includes('do-not-forward'));
  const before = h.events.length;
  h.setUser(OTHER); await business.syncSession();
  finance.callbacks.changed({ payload: 'old account data' });
  assert.equal(h.events.length, before + 1, 'Only the new account channel resync may be emitted');
  assert(client.removed.includes(finance)); assert.equal(h.clients.length, 2);
});

test('a request completing after account change cannot return old account records', async t => {
  const h = harness(t), business = h.create(); h.installed.add('financeiro');
  let enter, release; const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  h.server.beforeRequest = async endpoint => { if (endpoint === '/rest/v1/rpc/financeiro_snapshot') { enter(); await gate; } };
  const pending = business.dispatch('financeiro', 'snapshot', { orgId: ORG });
  const rejected = assert.rejects(pending, /conta mudou/);
  await entered; h.setUser(OTHER); await business.syncSession(); release(); await rejected;
});

test('shared book publication strips personal fields and uploads verified chunks within the Free limit', async t => {
  const h = harness(t), business = h.create();
  const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(CHUNK_SIZE + 13, 7)]), hash = digest(bytes);
  h.books.put(bytes, hash);
  h.data = { plans: ['private'], records: { private: 1 }, books: [{ id: RESOURCE, title: 'Livro sintético', format: 'pdf', hash, size: bytes.length, planIds: ['secret'], page: 7 }], notebooks: [] };
  const before = structuredClone(h.data);
  await business.dispatch('teams', 'publish', { orgId: ORG, module: 'books', resourceId: RESOURCE, revision: 0 });
  const file = h.server.resource.content.file;
  assert.equal(file.version, 1); assert.equal(file.chunks.length, 2); assert.equal(file.hash, hash);
  assert(file.chunks.every(c => c.size <= CHUNK_SIZE && digest(h.assets.get(c.object)) === c.sha256));
  assert(!('planIds' in h.server.resource.content)); assert(!('page' in h.server.resource.content));
  assert.deepEqual(h.data, before);
  const receiver = new BookFiles(path.join(h.directory, 'receiver')), second = h.create(receiver, () => ({ books: [], notebooks: [] }));
  const result = await second.dispatch('teams', 'downloadBook', { orgId: ORG, resourceId: RESOURCE });
  assert.deepEqual(receiver.read(hash), bytes); assert.deepEqual(result.book.planIds, []); assert.equal(result.book.page, 1);
  assert(!fs.existsSync(path.join(h.directory, 'receiver', 'compasso.json')));
  const readCount = h.server.reads; h.server.permission = false;
  await assert.rejects(second.dispatch('teams', 'downloadBook', { orgId: ORG, resourceId: RESOURCE }), /indisponível/);
  assert(h.server.reads > readCount, 'Cached binaries do not bypass a new authorization check');
});

test('corrupt book chunk cannot be installed into the local cache', async t => {
  const h = harness(t), bytes = Buffer.from('%PDF-synthetic'), hash = digest(bytes), object = `${ORG}/books/${RESOURCE}/${hash}`;
  h.server.resource = { org_id: ORG, module: 'books', resource_id: RESOURCE, revision: 1, content: { id: RESOURCE, title: 'Livro', format: 'pdf', size: bytes.length, hash,
    file: { version: 1, hash, size: bytes.length, chunks: [{ bucket: 'organon-shared', object, sha256: hash, size: bytes.length }] } } };
  h.assets.set(object, Buffer.from('%PDF-corrupt'));
  const business = h.create();
  await assert.rejects(business.dispatch('teams', 'downloadBook', { orgId: ORG, resourceId: RESOURCE }), /corrompido/);
  assert.equal(fs.existsSync(h.books.file(hash)), false);
});

test('imagens de quadros usam Storage privado, validação de bytes e rechecagem de acesso', async t => {
  const h = harness(t), business = h.create();
  const bytes = Buffer.from('89504e470d0a1a0a01020304', 'hex');
  h.data = { notebooks: [{ id: RESOURCE, name: 'Quadro', pages: [{ id: BOARD, kind: 'board', board: { version: 1, elements: [], files: { image: { id: 'image', mimeType: 'image/png', created: 1, dataURL: 'data:image/png;base64,' + bytes.toString('base64') } } } }] }] };
  await business.dispatch('teams', 'publish', { orgId: ORG, module: 'notebooks', resourceId: RESOURCE, revision: 0 });
  const stored = h.server.resource.content.pages[0].board.files.image;
  assert.equal(stored.dataURL.bucket, 'organon-shared'); assert.equal(stored.mimeType, 'image/png');
  const opened = await business.dispatch('teams', 'openResource', { orgId: ORG, module: 'notebooks', resourceId: RESOURCE });
  assert.equal(opened.content.pages[0].board.files.image.dataURL, 'data:image/png;base64,' + bytes.toString('base64'));
  h.data.notebooks[0].pages[0].board.files.image.dataURL = 'data:image/png;base64,YQ==';
  await assert.rejects(business.dispatch('teams', 'publish', { orgId: ORG, module: 'notebooks', resourceId: RESOURCE, revision: 1 }), /imagem|corresponde/);
  h.server.permission = false;
  await assert.rejects(business.dispatch('teams', 'openResource', { orgId: ORG, module: 'notebooks', resourceId: RESOURCE }), /acesso|permissão|encontrado/i);
});

test('opening a notebook resolves only scoped private images and rechecks authorization', async t => {
  const h = harness(t), business = h.create(), bytes = Buffer.from('89504e470d0a1a0a01020304', 'hex');
  const object = `${ORG}/notebooks/${RESOURCE}/${digest(bytes)}`;
  h.assets.set(object, bytes);
  h.server.resource = { org_id: ORG, module: 'notebooks', resource_id: RESOURCE, revision: 3,
    content: { id: RESOURCE, name: 'Caderno sintético', pages: [{ id: BOARD, title: 'Página', text: 'Conteúdo', images: [{ bucket: 'organon-shared', object }] }] } };
  const row = await business.dispatch('teams', 'openResource', { orgId: ORG, module: 'notebooks', resourceId: RESOURCE });
  assert.equal(row.revision, 3); assert.equal(row.canWrite, true); assert.equal(row.content.pages[0].images[0], 'data:image/png;base64,' + bytes.toString('base64'));
  await business.dispatch('teams', 'openResource', { orgId: ORG, module: 'notebooks', resourceId: RESOURCE });
  const transfers = h.requests.filter(r => r.endpoint.includes('/object/authenticated/'));
  assert.equal(transfers.length, 2);
  assert.notEqual(transfers[0].endpoint, transfers[1].endpoint, 'Cada abertura deve revalidar o Storage sem reutilizar a chave de cache anterior.');
  for (const transfer of transfers) { assert.ok(new URL(transfer.endpoint, 'https://storage.example.invalid').searchParams.get('cacheNonce')); assert.equal(transfer.headers['Cache-Control'], 'no-cache'); }
  h.server.resource.content.pages[0].images[0].object = `${ORG}/notebooks/${OTHER}/${digest(bytes)}`;
  const downloads = h.requests.filter(r => r.endpoint.includes('/object/authenticated/')).length;
  await assert.rejects(business.dispatch('teams', 'openResource', { orgId: ORG, module: 'notebooks', resourceId: RESOURCE }), /fora do recurso/);
  assert.equal(h.requests.filter(r => r.endpoint.includes('/object/authenticated/')).length, downloads);
});

test('workspace watches do not subscribe to spaces missing from the current authorization result', async t => {
  const h = harness(t), business = h.create(); h.server.spaces = [];
  await assert.rejects(business.watchWorkspace(ORG), /acesso ao espaço mudou/);
  assert(h.clients[0].channels.every(channel => channel.topic.startsWith('teams:user:')));
  h.setUser(null); await business.syncSession();
  await assert.rejects(business.dispatch('teams', 'list'), /Entre/);
});

test('notebook card downloads only its cover and rechecks access after the transfer', async t => {
  const h = harness(t), business = h.create(), bytes = Buffer.from('89504e470d0a1a0a01020304', 'hex');
  const object = `${ORG}/notebooks/${RESOURCE}/${digest(bytes)}`;
  h.assets.set(object, bytes);
  h.server.resource = { org_id: ORG, module: 'notebooks', resource_id: RESOURCE, revision: 1,
    content: { id: RESOURCE, cover: { bucket: 'organon-shared', object }, pages: [{ image: { bucket: 'organon-shared', object: 'must-not-download-pages' } }] } };
  assert.deepEqual(await business.dispatch('teams', 'resourceCover', { orgId: ORG, module: 'notebooks', resourceId: RESOURCE }), { cover: 'data:image/png;base64,' + bytes.toString('base64') });
  assert.equal(h.requests.filter(r => r.endpoint.includes('/object/authenticated/')).length, 1);
  h.server.beforeRequest = async endpoint => { if (endpoint.includes('/object/authenticated/')) h.server.permission = false; };
  await assert.rejects(business.dispatch('teams', 'resourceCover', { orgId: ORG, module: 'notebooks', resourceId: RESOURCE }), /revoked|removido/);
});

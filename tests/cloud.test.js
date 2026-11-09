import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { seed, firstPlan } from '../src/model.js';
import { createKind, customBlock } from '../src/block-kinds.js';
const require = createRequire(import.meta.url);
const { CloudSync } = require('../electron/cloud.cjs');
const { packDocument, unpackDocument, canonical } = require('../electron/cloud-document.cjs');
const image = 'data:image/png;base64,aGVsbG8=';

function harness() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-cloud-'));
  const kind = createKind('Revisão', 'brain'), plan = firstPlan(); plan.blocks.push(customBlock(kind));
  let local = { ...seed(), blockKinds: [kind], onboardingCompleted: true, plans: [{ ...plan, name: 'Dados locais', notes: [{ id: 'note', date: '2026-10-28', text: 'Teste', images: [image, image] }] }] };
  const server = { row: null, profile: null, assets: new Map(), calls: 0, uploads: 0, commits: 0, offline: false, race: false };
  const safeStorage = { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async value => Buffer.from(value).reverse(), decryptStringAsync: async bytes => ({ result: Buffer.from(bytes).reverse().toString(), shouldReEncrypt: false }) };
  const fetchImpl = async (url, options) => {
    server.calls++; if (server.offline) throw new Error('offline');
    const endpoint = new URL(url).pathname;
    const body = Buffer.isBuffer(options.body) ? options.body : options.body ? JSON.parse(options.body) : null;
    const response = data => new Response(JSON.stringify(data), { status: 200 });
    if (endpoint === '/auth/v1/signup' || endpoint === '/auth/v1/token') {
      const id = body.email?.startsWith('other') ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      return response({ access_token: 'private-access-token', refresh_token: 'private-refresh-token', expires_in: 3600, user: { id, email: body.email || 'test@example.invalid', user_metadata: body.data || {} } });
    }
    if (endpoint === '/auth/v1/logout') return response(null);
    if (endpoint === '/rest/v1/organon_profiles') {
      if (body) server.profile = { ...server.profile, ...body };
      const owner = new URL(url).searchParams.get('user_id');
      return response(server.profile && (!owner || owner === 'eq.' + server.profile.user_id) ? [server.profile] : []);
    }
    if (endpoint === '/rest/v1/organon_sync_state') return response(server.row ? [server.row] : []);
    if (endpoint.includes('/object/list/')) return response([...server.assets.keys()].map(name => ({ name })));
    if (endpoint.includes('/object/authenticated/')) return new Response(server.assets.get(endpoint.split('/').at(-1)));
    if (endpoint.includes('/object/organon-assets/')) { server.uploads++; server.assets.set(endpoint.split('/').at(-1), body); return response({}); }
    if (endpoint === '/rest/v1/rpc/organon_commit_snapshot') {
      if (server.race) { server.race = false; server.row.revision++; }
      if ((server.row?.revision || 0) !== body.p_expected_revision) return response({ ok: false, current: server.row });
      server.commits++; server.row = { revision: body.p_expected_revision + 1, checksum: body.p_checksum, updated_at: new Date().toISOString(), payload: JSON.parse(canonical(body.p_payload)) };
      return response({ ok: true, current: server.row });
    }
    throw new Error('Unexpected endpoint: ' + endpoint);
  };
  const create = (options = {}) => new CloudSync({ directory, safeStorage, fetchImpl, readData: () => local, ...options });
  return { directory, server, create, get local() { return local; }, set local(value) { local = value; } };
}

test('cloud images are deduplicated, verified and restore despite JSONB key ordering', async () => {
  const h = harness(), packed = packDocument(h.local);
  assert.equal(packed.assets.size, 1);
  assert(!JSON.stringify(packed.payload).includes('base64'));
  const reordered = JSON.parse(canonical(packed.payload));
  const restored = await unpackDocument(reordered, async digest => packed.assets.get(digest).bytes);
  assert.deepEqual(restored, h.local);
  await assert.rejects(unpackDocument(reordered, async () => Buffer.from('corrupted')), /incompleta/);
});

test('first login links existing local data; edits do not cause requests; unchanged sync skips upload', async () => {
  const h = harness(), cloud = h.create(); await cloud.ready;
  assert.equal((await cloud.authenticate('signup', 'test@example.invalid', 'test-password', { name: 'Pessoa sintética', nickname: 'Teste' })).busy, false);
  assert.equal(h.server.uploads, 0); assert.equal(h.server.commits, 0); assert.equal(cloud.status().pending, true);
  const progress = []; cloud.emit = status => { if (status.progress) progress.push(status.progress); };
  await cloud.sync();
  assert(progress.some(value => value.stage === 'uploading' && value.completed === 1 && value.total === 1));
  assert.equal(h.server.uploads, 1); assert.equal(h.server.commits, 1);
  assert.deepEqual(await cloud.download(), h.local);
  const calls = h.server.calls; cloud.markDirty(); cloud.markDirty(); assert.equal(h.server.calls, calls);
  await cloud.sync(); assert.equal(h.server.uploads, 1); assert.equal(h.server.commits, 1);
  h.local = { ...h.local, createdAt: '2026-10-27' }; await cloud.sync();
  assert.equal(h.server.uploads, 1); assert.equal(h.server.commits, 2);
  const restarted = h.create(); await restarted.ready; assert.equal(restarted.status().user.email, 'test@example.invalid');
  assert(!fs.readFileSync(path.join(h.directory, 'cloud-session.enc'), 'utf8').includes('private-refresh-token'));
  assert(!fs.readFileSync(path.join(h.directory, 'cloud-state.json'), 'utf8').includes('token'));
});

test('offline leaves local changes pending and resumes after reconnecting', async () => {
  const h = harness(), cloud = h.create(); await cloud.authenticate('signup', 'test@example.invalid', 'test-password', { name: 'Pessoa sintética', nickname: 'Teste' }); await cloud.sync();
  h.local.plans[0].name = 'Editado offline'; cloud.markDirty(); h.server.offline = true;
  await assert.rejects(cloud.sync(), /Sem conexão/);
  assert.equal(cloud.status().pending, true); assert.equal(h.server.commits, 1);
  h.server.offline = false; await cloud.sync(); assert.equal(h.server.commits, 2); assert.equal(cloud.status().pending, false);
});

test('new profile detects remote data, preserves local copy on download and requires acknowledgment', async () => {
  const h = harness(), cloud = h.create(); await cloud.authenticate('signup', 'test@example.invalid', 'test-password', { name: 'Pessoa sintética', nickname: 'Teste' }); await cloud.sync();
  h.server.row.revision++; h.server.row.payload.plans[0].name = 'Outro computador';
  h.server.row.checksum = packDocument({ ...h.local, plans: [{ ...h.local.plans[0], name: 'Outro computador' }] }).checksum;
  await cloud.sync(); assert(cloud.status().conflict); assert.equal(h.local.plans[0].name, 'Dados locais');
  const restored = await cloud.download(); assert.equal(restored.plans[0].name, 'Outro computador');
  assert.equal(fs.readdirSync(path.join(h.directory, 'recovery')).length, 1);
  h.local = restored; await cloud.acceptDownload(); assert.equal(cloud.status().conflict, null);
  await cloud.sync(); assert.equal(h.server.commits, 1);
});

test('concurrent commit cannot silently overwrite another revision; account switching requires choice', async () => {
  const h = harness(), cloud = h.create(); await cloud.authenticate('signup', 'test@example.invalid', 'test-password', { name: 'Pessoa sintética', nickname: 'Teste' }); await cloud.sync();
  h.local.plans[0].name = 'Editado'; h.server.race = true;
  await cloud.sync(); assert(cloud.status().conflict); assert.equal(h.server.commits, 1);
  await cloud.chooseLocal(); assert.equal(h.server.commits, 2);
  await cloud.signOut(); await cloud.authenticate('login', 'other@example.invalid', 'test-password');
  await cloud.sync();
  assert.equal(cloud.status().conflict.differentAccount, true); assert.equal(h.server.commits, 2);
  await cloud.signOut(); assert.equal(cloud.status().user, null); assert.equal(cloud.status().promptSeen, true);
});

test('lack of secure session storage does not fall back to plaintext', async () => {
  const h = harness(), cloud = h.create(); cloud.safeStorage.isAsyncEncryptionAvailable = async () => false;
  await assert.rejects(cloud.authenticate('signup', 'test@example.invalid', 'test-password', { name: 'Pessoa sintética', nickname: 'Teste' }), /proteção/);
  assert.equal(fs.existsSync(path.join(h.directory, 'cloud-session.enc')), false);
  assert.equal(h.server.commits, 0);
});

test('disabled cloud preserves the session file and makes no network requests', async () => {
  const h = harness(), connected = h.create();
  await connected.authenticate('signup', 'test@example.invalid', 'test-password', { name: 'Pessoa sintética', nickname: 'Teste' });
  const sessionFile = path.join(h.directory, 'cloud-session.enc'), before = fs.readFileSync(sessionFile);
  const cloud = new CloudSync({ directory: h.directory, enabled: false, safeStorage: {}, readData: () => h.local, fetchImpl: async () => { throw new Error('Unexpected network request'); } });
  await cloud.ready; assert.equal(cloud.status().enabled, false); assert.equal(cloud.status().user, null);
  await cloud.sync(); await assert.rejects(cloud.authenticate('login', 'test@example.invalid', 'test-password'), /indisponível/);
  assert.deepEqual(fs.readFileSync(sessionFile), before);
});

test('authentication completes before a slow upload; sync progress is public and credentials stay private', { timeout: 5000 }, async () => {
  const h = harness(), cloud = h.create(), original = cloud.fetch;
  let release, started;
  const gate = new Promise(resolve => { release = resolve; }), uploading = new Promise(resolve => { started = resolve; });
  cloud.fetch = async (url, options) => {
    if (new URL(url).pathname.includes('/object/organon-assets/')) { started(); await gate; }
    return original(url, options);
  };
  await cloud.authenticate('signup', 'test@example.invalid', 'test-password', { name: 'Pessoa sintética', nickname: 'Teste' });
  assert.equal(h.server.uploads, 0); assert.equal(cloud.status().busy, false);
  const sync = cloud.sync(); await uploading;
  try {
    assert.equal(cloud.status().user.email, 'test@example.invalid');
    assert.equal(cloud.status().progress.stage, 'uploading'); assert.equal(cloud.status().busy, true);
    assert(!JSON.stringify(cloud.status()).includes('private-access-token'));
  } finally { release(); }
  await sync; assert.equal(cloud.status().busy, false); assert.equal(cloud.status().pending, false);
});

test('account profile and private avatar survive restart, edit/removal and account switching without changing study data', async () => {
  const h = harness(), cloud = h.create(), before = structuredClone(h.local);
  const photo = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
  await cloud.authenticate('signup', 'test@example.invalid', 'test-password', { name: 'Pessoa sintética', nickname: 'Teste' });
  await cloud.updateProfile({ name: ' Pessoa ', nickname: ' Apelido ', avatar: photo });
  assert.equal(cloud.status().user.name, 'Pessoa'); assert.equal(cloud.status().user.nickname, 'Apelido'); assert.equal(cloud.status().user.avatar, photo);
  assert.deepEqual(h.local, before); assert.equal(h.server.commits, 0);
  const restarted = h.create(); await restarted.ready; assert.equal(restarted.status().user.avatar, photo);
  await cloud.updateProfile({ name: 'Outro nome', nickname: '' }); assert.equal(cloud.status().user.avatar, photo);
  h.server.offline = true;
  await assert.rejects(cloud.updateProfile({ name: 'Não salvo', nickname: '' }), /Sem conexão/);
  assert.equal(cloud.status().user.name, 'Outro nome');
  h.server.offline = false;
  await cloud.updateProfile({ name: 'Outro nome', nickname: '', avatar: null }); assert.equal(cloud.status().user.avatar, null);
  await assert.rejects(cloud.updateProfile({ name: 'a'.repeat(81), nickname: '' }), /80 caracteres/);
  await assert.rejects(cloud.updateProfile({ name: '', nickname: '', avatar: 'data:image/webp;base64,PHNjcmlwdD4=' }));
  await cloud.signOut(); await cloud.authenticate('login', 'other@example.invalid', 'test-password');
  assert.equal(cloud.status().user.name, ''); assert.equal(cloud.status().user.avatar, null);
});

test('signup requires identity before contacting Auth and persists profile without changing study data', async () => {
  const h = harness(), cloud = h.create(), before = structuredClone(h.local);
  await assert.rejects(cloud.authenticate('signup', 'new@example.invalid', 'test-password'), /nome/);
  await assert.rejects(cloud.authenticate('signup', 'new@example.invalid', 'test-password', { name: ' ', nickname: 'Teste' }), /nome e apelido/);
  await assert.rejects(cloud.authenticate('signup', 'new@example.invalid', 'test-password', { name: 'Teste', nickname: ' ', avatar: null }), /nome e apelido/);
  assert.equal(h.server.calls, 0);
  await cloud.authenticate('signup', 'new@example.invalid', 'test-password', { name: ' Pessoa ', nickname: ' Teste ', avatar: null });
  assert.equal(cloud.status().user.name, 'Pessoa'); assert.equal(cloud.status().user.nickname, 'Teste');
  assert.equal(cloud.status().user.avatar, null); assert.equal(h.server.profile.name, 'Pessoa');
  assert.equal(cloud.meta.signupProfile, undefined); assert.deepEqual(h.local, before);
});

test('a profile write failure after signup keeps the account and retries after restart', async () => {
  const h = harness(), cloud = h.create(), original = cloud.fetch;
  cloud.fetch = async (url, options) => {
    if (url.includes('/rest/v1/organon_profiles') && options.method === 'POST') throw new Error('offline');
    return original(url, options);
  };
  const result = await cloud.authenticate('signup', 'new@example.invalid', 'test-password', { name: 'Pessoa', nickname: 'Teste' });
  assert.ok(result.user); assert.match(result.profileError, /perfil será reenviado/);
  assert.equal(result.user.name, 'Pessoa'); assert.ok(cloud.meta.signupProfile);
  const restarted = h.create(); await restarted.ready; await restarted.sync();
  assert.equal(restarted.status().user.nickname, 'Teste'); assert.equal(h.server.profile.name, 'Pessoa');
  assert.equal(restarted.meta.signupProfile, undefined);
});

test('parallel module requests share one token refresh', async () => {
  const h=harness(),cloud=h.create();await cloud.authenticate('login','test@example.invalid','test-password');
  cloud.session.expires_at=0;const before=h.server.calls;
  const tokens=await Promise.all(Array.from({length:10},()=>cloud.token()));
  assert.equal(new Set(tokens).size,1);assert.equal(h.server.calls-before,1);
});

test('refresh finishing after signout cannot restore the old session', {timeout:5000}, async () => {
  const h=harness(),cloud=h.create();await cloud.authenticate('login','test@example.invalid','test-password');
  const original=cloud.fetch;let release,started;
  const gate=new Promise(resolve=>{release=resolve;}),pending=new Promise(resolve=>{started=resolve;});
  cloud.fetch=async(url,options)=>{if(url.includes('grant_type=refresh_token')){started();await gate;}return original(url,options);};
  cloud.session.expires_at=0;const refreshing=cloud.token();await pending;await cloud.signOut();release();
  await assert.rejects(refreshing,/conta mudou/);assert.equal(cloud.status().user,null);assert.equal(fs.existsSync(cloud.sessionFile),false);
});

test('cloud selection restores missing plugins after data acknowledgment and retries failures after restart', async () => {
  const h = harness();
  let installed = ['financeiro', 'mei'], fail = true, attempts = 0;
  const options = { readPlugins: async () => installed, restorePlugins: async ids => {
    attempts++;
    assert.deepEqual(ids, ['financeiro', 'mei']);
    installed = ['financeiro'];
    if (fail) throw new Error('Catálogo indisponível');
    installed = [...ids];
  } };
  const cloud = h.create(options);
  await cloud.authenticate('login', 'test@example.invalid', 'test-password'); await cloud.sync();
  assert.deepEqual(h.server.row.payload.organonPlugins, ['financeiro', 'mei']);
  installed = [];
  const data = await cloud.download();
  assert.equal(attempts, 0, 'Download alone must not install plugins or acknowledge data');
  assert.equal(data.organonPlugins, undefined, 'Transport metadata must not enter the study document');
  h.local = data;
  await cloud.acceptDownload();
  assert.equal(cloud.status().conflict, null);
  assert.match(cloud.status().pluginError, /faltam plugins/);
  assert.deepEqual(cloud.meta.pluginRestore.ids, ['financeiro', 'mei']);
  const restarted = h.create(options); await restarted.ready;
  fail = false; await restarted.sync();
  assert.equal(attempts, 2); assert.deepEqual(installed, ['financeiro', 'mei']);
  assert.equal(restarted.meta.pluginRestore, undefined); assert.equal(restarted.status().pluginError, '');
  installed = ['financeiro']; await restarted.sync();
  assert.deepEqual(h.server.row.payload.organonPlugins, ['financeiro'], 'Explicit removal is reflected in the next snapshot');
});

test('download reports counts, rejects unknown plugins and cannot acknowledge another account backup', async () => {
  const h = harness(), cloud = h.create();
  await cloud.authenticate('login', 'test@example.invalid', 'test-password'); await cloud.sync();
  const progress = []; cloud.emit = status => { if (status.progress) progress.push(status.progress); };
  await cloud.download();
  assert(progress.some(p => p.stage === 'downloading' && p.total === 1 && p.completed === 1));
  await cloud.signOut(); await cloud.authenticate('login', 'other@example.invalid', 'test-password');
  await assert.rejects(cloud.acceptDownload(), /esta conta/);
  h.server.row.payload.organonPlugins = ['arbitrary-code'];
  const { hash } = require('../electron/cloud-document.cjs');
  h.server.row.checksum = hash(canonical(h.server.row.payload));
  await assert.rejects(cloud.download(), /plugins online inválida/);
});

test('transfer workers bound concurrency and wait for in-flight work after a failure', async () => {
  const { mapTransfers, limitTransfers } = require('../electron/cloud-transfer.cjs');
  let active = 0, maximum = 0, finished = 0;
  const transfer = limitTransfers(async value => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setImmediate(resolve));
    active--; finished++; return value;
  });
  assert.deepEqual(await Promise.all(Array.from({ length: 12 }, (_, i) => transfer(i))), Array.from({ length: 12 }, (_, i) => i));
  assert.equal(maximum, 3); assert.equal(finished, 12);
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { started = resolve; });
  let settled = false;
  const result = mapTransfers([0, 1, 2, 3], async value => {
    if (value === 0) throw new Error('transfer failed');
    started(); await gate;
  }).catch(error => { settled = true; assert.match(error.message, /transfer failed/); });
  await waiting; assert.equal(settled, false); release(); await result;
});

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
      return response({ access_token: 'private-access-token', refresh_token: 'private-refresh-token', expires_in: 3600, user: { id, email: body.email || 'test@example.invalid' } });
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
  const create = () => new CloudSync({ directory, safeStorage, fetchImpl, readData: () => local });
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
  assert.equal((await cloud.authenticate('signup', 'test@example.invalid', 'test-password')).busy, false);
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
  const h = harness(), cloud = h.create(); await cloud.authenticate('signup', 'test@example.invalid', 'test-password'); await cloud.sync();
  h.local.plans[0].name = 'Editado offline'; cloud.markDirty(); h.server.offline = true;
  await assert.rejects(cloud.sync(), /Sem conexão/);
  assert.equal(cloud.status().pending, true); assert.equal(h.server.commits, 1);
  h.server.offline = false; await cloud.sync(); assert.equal(h.server.commits, 2); assert.equal(cloud.status().pending, false);
});

test('new profile detects remote data, preserves local copy on download and requires acknowledgment', async () => {
  const h = harness(), cloud = h.create(); await cloud.authenticate('signup', 'test@example.invalid', 'test-password'); await cloud.sync();
  h.server.row.revision++; h.server.row.payload.plans[0].name = 'Outro computador';
  h.server.row.checksum = packDocument({ ...h.local, plans: [{ ...h.local.plans[0], name: 'Outro computador' }] }).checksum;
  await cloud.sync(); assert(cloud.status().conflict); assert.equal(h.local.plans[0].name, 'Dados locais');
  const restored = await cloud.download(); assert.equal(restored.plans[0].name, 'Outro computador');
  assert.equal(fs.readdirSync(path.join(h.directory, 'recovery')).length, 1);
  h.local = restored; await cloud.acceptDownload(); assert.equal(cloud.status().conflict, null);
  await cloud.sync(); assert.equal(h.server.commits, 1);
});

test('concurrent commit cannot silently overwrite another revision; account switching requires choice', async () => {
  const h = harness(), cloud = h.create(); await cloud.authenticate('signup', 'test@example.invalid', 'test-password'); await cloud.sync();
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
  await assert.rejects(cloud.authenticate('signup', 'test@example.invalid', 'test-password'), /proteção/);
  assert.equal(fs.existsSync(path.join(h.directory, 'cloud-session.enc')), false);
  assert.equal(h.server.commits, 0);
});

test('disabled cloud preserves the session file and makes no network requests', async () => {
  const h = harness(), connected = h.create();
  await connected.authenticate('signup', 'test@example.invalid', 'test-password');
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
  await cloud.authenticate('signup', 'test@example.invalid', 'test-password');
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
  await cloud.authenticate('signup', 'test@example.invalid', 'test-password');
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

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { createPluginManager, validatePackage, verifyCatalog, download, hash, registerPluginIpc, CATALOG_URL, scheme } = require('../electron/plugins.cjs');
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' });

function packageFixture({ id = 'financeiro', version = '1.0.0', minHost = '0.5.6', maxHostExclusive = '1.0.0', abi = 1, extra = null } = {}) {
  const js = Buffer.from(`export default function Page(){return "${id}-${version}";}`), css = Buffer.from(`.plugin-${id}{display:block}`);
  const metadata = { 'index.js': { size: js.length, sha256: hash(js) }, 'style.css': { size: css.length, sha256: hash(css) } };
  const files = { 'index.js': js.toString('base64'), 'style.css': css.toString('base64') };
  if (extra) { metadata[extra] = metadata['index.js']; files[extra] = files['index.js']; }
  const manifest = { format: 1, publisher: 'Organon', abi, id, version, minHost, maxHostExclusive, entry: 'index.js', files: metadata };
  const bytes = Buffer.from(JSON.stringify({ manifest, files }));
  const item = { id, version, size: bytes.length, sha256: hash(bytes), tag: 'v0.5.7', url: `https://github.com/leosalema213/app-estudos/releases/download/v0.5.7/organon-plugin-${id}-${version}.organon-plugin` };
  return { bytes, item, js, css };
}
function envelope(items, { sequence = 1, expiresAt = new Date(Date.now() + 3600000).toISOString() } = {}) {
  const payload = JSON.stringify({ format: 1, sequence, expiresAt, plugins: items });
  return { payload, signature: crypto.sign(null, Buffer.from(payload), privateKey).toString('base64') };
}
async function fixture(t, first = packageFixture()) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'organon-plugins-test-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('organon-plugins-test-'));
    return fs.rm(resolved, { recursive: true, force: true });
  });
  let current = first, signed = envelope([first.item]), blocked = false;
  const calls = [], events = [];
  const fetchImpl = async url => {
    calls.push(url); if (blocked) throw new Error('offline');
    return url === CATALOG_URL ? Response.json(signed) : new Response(current.bytes);
  };
  const options = { directory, hostVersion: '0.5.7-preview.1', publicKey: pem, fetchImpl, emit: state => events.push(state) };
  return { directory, options, manager: createPluginManager(options), calls, events,
    update(pkg, sequence = 2) { current = pkg; signed = envelope([pkg.item], { sequence }); },
    setEnvelope(value) { signed = value; }, offline() { blocked = true; },
  };
}

test('first-party signature, descriptor and per-file hash are all required', () => {
  const pkg = packageFixture();
  assert.equal(verifyCatalog(envelope([pkg.item]), pem).plugins[0].id, 'financeiro');
  const signed = envelope([pkg.item]); signed.payload = signed.payload.replace('financeiro', 'arbitrario');
  assert.throws(() => verifyCatalog(signed, pem), /Assinatura/);
  assert.throws(() => verifyCatalog(envelope([pkg.item]), null), /configurado/);
  assert.throws(() => verifyCatalog(envelope([{ ...pkg.item, url: 'https://example.org/evil.js' }]), pem), /não autorizado/);
  assert.throws(() => verifyCatalog(envelope([{ ...pkg.item, id: 'outro' }]), pem), /não pertence/);
  assert.throws(() => verifyCatalog(envelope([pkg.item, pkg.item]), pem), /Descritor/);
  assert.throws(() => verifyCatalog(envelope([pkg.item], { expiresAt: '2000-01-01T00:00:00Z' }), pem), /expirado/);
  assert.equal(validatePackage(pkg.bytes, pkg.item, '0.5.7').files['index.js'].equals(pkg.js), true);
  assert.throws(() => validatePackage(Buffer.concat([pkg.bytes, Buffer.from(' ')]), pkg.item, '0.5.7'), /SHA-256/);
  const parsed = JSON.parse(pkg.bytes); parsed.files['index.js'] = Buffer.from('tampered').toString('base64');
  const corrupt = Buffer.from(JSON.stringify(parsed));
  assert.throws(() => validatePackage(corrupt, { ...pkg.item, size: corrupt.length, sha256: hash(corrupt) }, '0.5.7'), /corrompido/);
});

test('rejects traversal, unknown files, unknown ABI and incompatible host', () => {
  for (const extra of ['../preload.cjs', '/absolute.js', 'folder/index.js', 'C:\\data.js', 'postinstall.cjs']) {
    const pkg = packageFixture({ extra });
    assert.throws(() => validatePackage(pkg.bytes, pkg.item, '0.5.7'), /não permitido/);
  }
  for (const options of [{ abi: 2 }, { minHost: '0.6.0' }, { maxHostExclusive: '0.5.7' }]) {
    const pkg = packageFixture(options);
    assert.throws(() => validatePackage(pkg.bytes, pkg.item, '0.5.7'), /inválido|incompatível/);
  }
});

test('install is separate, survives offline restart and serves only authenticated current files', async t => {
  const f = await fixture(t);
  assert.equal((await f.manager.list()).plugins.some(p => p.installed), false);
  assert.equal(f.calls.length, 0);
  await f.manager.check(); assert.equal(f.calls.length, 1);
  await f.manager.install('financeiro'); assert.equal(f.calls.length, 2);
  const entry = await f.manager.entry('financeiro'); assert.match(entry.url, /^organon-plugin:/);
  const response = await f.manager.handleRequest(new Request(entry.url));
  assert.equal(response.status, 200); assert.match(await response.text(), /export default/);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  for (const url of [entry.url.replace('index.js', 'preload.cjs'), entry.url + '?file=other', entry.url.replace('/modules/', '/else/'), entry.url.replace('financeiro', 'mei')]) {
    assert.equal((await f.manager.handleRequest(new Request(url))).status, 404);
  }
  assert.equal((await f.manager.handleRequest(new Request(entry.url, { method: 'POST' }))).status, 405);
  f.offline(); const restarted = createPluginManager(f.options);
  assert.equal((await restarted.list()).plugins[0].installed, true);
  assert.equal((await restarted.entry('financeiro')).url, entry.url);
  assert.equal(f.calls.length, 2);
});

test('update retains one previous version, rollback is conditional and uninstall preserves domain data', async t => {
  const f = await fixture(t); await f.manager.check(); await f.manager.install('financeiro');
  const first = await f.manager.entry('financeiro');
  const domainFile = path.join(f.directory, 'domain-data.json'); await fs.writeFile(domainFile, '{"synthetic":true}');
  f.update(packageFixture({ version: '1.0.1' })); await f.manager.check();
  assert.equal((await f.manager.list()).plugins[0].updateAvailable, true);
  await f.manager.install('financeiro');
  assert.equal((await f.manager.list()).plugins[0].updateAvailable, false);
  assert.equal((await f.manager.list()).plugins[0].canRollback, true);
  assert.equal((await f.manager.handleRequest(new Request(first.url))).status, 404);
  await assert.rejects(f.manager.rollback('financeiro', '1.0.0'), /instalação mudou/);
  await f.manager.rollback('financeiro', '1.0.1');
  assert.equal((await f.manager.entry('financeiro')).version, '1.0.0');
  await f.manager.remove('financeiro');
  await assert.rejects(f.manager.entry('financeiro'), /não instalado/);
  assert.equal((await f.manager.handleRequest(new Request(first.url))).status, 404);
  assert.equal(await fs.readFile(domainFile, 'utf8'), '{"synthetic":true}');
  assert.deepEqual(await fs.readdir(path.join(f.directory, 'objects')), []);
});

test('Financeiro and MEI install independently and removal affects only the selected package', async t => {
  const f = await fixture(t); await f.manager.check(); await f.manager.install('financeiro');
  f.update(packageFixture({ id: 'mei' })); await f.manager.check(); await f.manager.install('mei');
  assert.equal((await f.manager.list()).plugins.filter(p => p.installed).length, 2);
  const entry = await f.manager.entry('mei');
  await f.manager.remove('financeiro');
  assert.equal((await f.manager.entry('mei')).url, entry.url);
  assert.equal((await f.manager.handleRequest(new Request(entry.url))).status, 200);
  await assert.rejects(f.manager.install('../preload.cjs'), /não pertence/);
  assert.equal((await f.manager.list()).plugins.filter(p => p.installed).length, 1);
});

test('failed update and failed atomic registry write leave current version active', async t => {
  const f = await fixture(t); await f.manager.check(); await f.manager.install('financeiro');
  const first = await f.manager.entry('financeiro');
  f.update(packageFixture({ version: '1.0.1', minHost: '0.6.0' })); await f.manager.check();
  await assert.rejects(f.manager.install('financeiro'), /incompatível/);
  assert.equal((await f.manager.entry('financeiro')).url, first.url);
  f.update(packageFixture({ version: '1.0.2' }), 3); await f.manager.check();
  const registry = path.join(f.directory, 'installed.json'), saved = registry + '.saved';
  await fs.rename(registry, saved); await fs.mkdir(registry);
  await assert.rejects(f.manager.install('financeiro'));
  assert.equal((await f.manager.entry('financeiro')).url, first.url);
  await fs.rmdir(registry); await fs.rename(saved, registry);
  assert.equal((await createPluginManager(f.options).entry('financeiro')).url, first.url);
  assert.equal((await fs.readdir(path.join(f.directory, 'objects'))).length, 1);
});

test('local tampering disables plugin; authenticated reinstall repairs code', async t => {
  const f = await fixture(t); await f.manager.check(); await f.manager.install('financeiro');
  const entry = await f.manager.entry('financeiro'), digest = entry.url.split('/')[4];
  await fs.writeFile(path.join(f.directory, 'objects', `${digest}.json`), 'tampered');
  assert.equal((await f.manager.list()).plugins[0].installed, false);
  assert.equal((await f.manager.handleRequest(new Request(entry.url))).status, 404);
  await f.manager.install('financeiro');
  assert.equal((await f.manager.list()).plugins[0].installed, true);
});

test('old signed catalog is refused even across restart', async t => {
  const f = await fixture(t); f.update(packageFixture(), 7); await f.manager.check();
  f.update(packageFixture(), 6);
  await assert.rejects(createPluginManager(f.options).check(), /Catálogo anterior/);
});

test('an installed package version cannot be silently republished with different bytes', async t => {
  const f = await fixture(t); await f.manager.check(); await f.manager.install('financeiro');
  const original = await f.manager.entry('financeiro');
  f.update(packageFixture({ minHost: '0.5.5' })); await f.manager.check();
  await assert.rejects(f.manager.install('financeiro'), /outro conteúdo/);
  assert.equal((await f.manager.entry('financeiro')).url, original.url);
});

test('download checks redirect destinations and byte limit while streaming', async () => {
  await assert.rejects(download('http://github.com/a', 10), /não autorizado/);
  await assert.rejects(download(CATALOG_URL, 10, async () => new Response(null, { status: 302, headers: { location: 'https://attacker.example/payload' } })), /não autorizado/);
  await assert.rejects(download(CATALOG_URL, 10, async () => new Response('12345678901')), /limite/);
  await assert.rejects(download(CATALOG_URL, 10, async () => new Response('x', { headers: { 'content-length': '20' } })), /limite/);
});

test('download follows permitted redirects manually before reading the asset', async () => {
  const calls = [];
  const asset = 'https://release-assets.githubusercontent.com/test/plugin';
  const result = await download(CATALOG_URL, 10, async (url, options) => {
    calls.push({ url, redirect: options.redirect });
    return url === CATALOG_URL ? new Response(null, { status: 302, headers: { location: asset } }) : new Response('ok');
  });
  assert.equal(result.toString(), 'ok');
  assert.deepEqual(calls, [{ url: CATALOG_URL, redirect: 'manual' }, { url: asset, redirect: 'manual' }]);
});

test('symlink package cannot be served or replaced', async t => {
  const f = await fixture(t); await f.manager.check(); await f.manager.install('financeiro');
  const entry = await f.manager.entry('financeiro'), digest = entry.url.split('/')[4];
  const target = path.join(f.directory, 'objects', `${digest}.json`), outside = path.join(f.directory, 'preserve.txt');
  await fs.writeFile(outside, 'synthetic personal file'); await fs.unlink(target);
  try { await fs.symlink(outside, target, 'file'); } catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Windows exige permissão para criar symlink de teste.'); return; } throw error; }
  assert.equal((await f.manager.handleRequest(new Request(entry.url))).status, 404);
  await assert.rejects(f.manager.install('financeiro'), /inseguro/);
  await f.manager.remove('financeiro');
  assert.equal(await fs.readFile(outside, 'utf8'), 'synthetic personal file');
});

test('IPC requires trusted sender and protocol never bypasses CSP', async () => {
  const handlers = new Map(), ipcMain = { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) };
  assert.throws(() => registerPluginIpc({ ipcMain, manager: {} }), /obrigatória/);
  const stop = registerPluginIpc({ ipcMain, manager: { list: async () => 'ok' }, isTrustedSender: event => event.trusted === true });
  assert.throws(() => handlers.get('plugins:list')({ trusted: false }), /não autorizada/);
  assert.equal(await handlers.get('plugins:list')({ trusted: true }), 'ok');
  assert.equal(scheme.privileges.bypassCSP, undefined);
  stop(); assert.equal(handlers.size, 0);
});

test('package compiler aliases React and shared components without compiling host modules', async () => {
  const { hostPlugin } = await import('../scripts/plugins-build.mjs');
  const plugin = hostPlugin();
  assert.match(plugin.resolveId('react'), /^\0organon-host:/);
  assert.match(plugin.resolveId('react/jsx-runtime'), /^\0organon-host:/);
  const importer = fileURLToPath(new URL('../src/plugins/financeiro/index.jsx', import.meta.url));
  const modal = plugin.resolveId('../../Modal.jsx', importer);
  assert.equal(modal, '\0organon-shared:Modal');
  assert.match(plugin.load(modal), /\.Modal/);
  assert.match(plugin.load(plugin.resolveId('react')), /Symbol\.for\("organon.plugins.host.v1"\)/);
  assert.throws(() => plugin.resolveId('react-dom/client'), /não suportada/);
  assert.throws(() => plugin.generateBundle({}, { a: { type: 'chunk', imports: ['external'], dynamicImports: [], modules: {} } }), /autocontido/);
  assert.throws(() => plugin.generateBundle({}, { a: { type: 'chunk', imports: [], dynamicImports: [], modules: { '/project/node_modules/react/index.js': {} } } }), /compartilhado/);
  assert.throws(() => plugin.generateBundle({}, { a: { type: 'chunk', facadeModuleId: '/project/src/plugins/financeiro/index.jsx', imports: [], dynamicImports: [], modules: { '/project/src/plugins/mei/index.jsx': {} } } }), /outro adicional/);
});

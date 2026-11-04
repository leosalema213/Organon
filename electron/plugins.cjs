// Optional first-party UI packages. Domain services remain in the main process.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const IDS = Object.freeze(['financeiro', 'mei']);
const LABELS = Object.freeze({ financeiro: 'Financeiro', mei: 'MEI' });
const ABI = 1;
const REPOSITORY = 'leosalema213/app-estudos';
const CATALOG_URL = `https://github.com/${REPOSITORY}/releases/latest/download/organon-plugins-catalog.json`;
const MAX_PACKAGE = 8 * 1024 * 1024;
const MAX_CATALOG = 64 * 1024;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function version(value, preview = false) {
  if (typeof value !== 'string' || !(preview ? /^\d+\.\d+\.\d+(?:-preview\.\d+)?$/ : /^\d+\.\d+\.\d+$/).test(value)) fail('Versão de plugin inválida.');
  const parts = value.split('-')[0].split('.').map(Number);
  if (parts.some(n => !Number.isSafeInteger(n))) fail('Versão de plugin inválida.');
  return parts;
}
function compare(a, b) { const x = version(a, true), y = version(b, true); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return Math.sign(x[i] - y[i]); return 0; }
function assertId(id) { if (!IDS.includes(id)) fail('Este plugin não pertence ao catálogo do Organon.'); return id; }
function compatible(manifest, hostVersion) {
  version(manifest.minHost); version(manifest.maxHostExclusive);
  return manifest.abi === ABI && compare(hostVersion, manifest.minHost) >= 0 && compare(hostVersion, manifest.maxHostExclusive) < 0;
}
function validateManifest(manifest) {
  if (!manifest || manifest.format !== 1 || manifest.publisher !== 'Organon' || manifest.abi !== ABI) fail('Manifesto de plugin inválido.');
  assertId(manifest.id); version(manifest.version); version(manifest.minHost); version(manifest.maxHostExclusive);
  if (compare(manifest.minHost, manifest.maxHostExclusive) >= 0 || manifest.entry !== 'index.js') fail('Compatibilidade ou entrada inválida.');
  const names = Object.keys(manifest.files || {});
  if (!names.includes('index.js') || names.length > 2 || names.some(n => !['index.js', 'style.css'].includes(n))) fail('Arquivo de plugin não permitido.');
  for (const name of names) {
    const file = manifest.files[name];
    if (!file || !isHash(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_PACKAGE) fail('Verificação de arquivo inválida.');
  }
  return manifest;
}
function validatePackage(bytes, descriptor, hostVersion) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== descriptor.size || bytes.length > MAX_PACKAGE || hash(bytes) !== descriptor.sha256) fail('O pacote não corresponde ao SHA-256 publicado.');
  const pkg = JSON.parse(bytes.toString('utf8'));
  const manifest = validateManifest(pkg.manifest);
  if (manifest.id !== descriptor.id || manifest.version !== descriptor.version || !compatible(manifest, hostVersion)) fail('Plugin incompatível com esta versão do Organon.');
  if (JSON.stringify(Object.keys(pkg.files || {}).sort()) !== JSON.stringify(Object.keys(manifest.files).sort())) fail('Conteúdo inesperado no pacote.');
  const files = {};
  for (const [name, meta] of Object.entries(manifest.files)) {
    const encoded = pkg.files[name];
    if (typeof encoded !== 'string' || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) fail('Arquivo codificado incorretamente.');
    const content = Buffer.from(encoded, 'base64');
    if (content.toString('base64') !== encoded || content.length !== meta.size || hash(content) !== meta.sha256) fail('Arquivo de plugin corrompido.');
    files[name] = content;
  }
  return { manifest, files };
}
function verifyCatalog(envelope, publicKey, { fresh = true, now = Date.now() } = {}) {
  if (!publicKey) fail('O catálogo de plugins ainda não foi configurado nesta instalação.');
  if (!envelope || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string' || Buffer.byteLength(JSON.stringify(envelope)) > MAX_CATALOG) fail('Catálogo inválido.');
  const key = crypto.createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519' || !crypto.verify(null, Buffer.from(envelope.payload, 'utf8'), key, Buffer.from(envelope.signature, 'base64'))) fail('Assinatura do catálogo inválida.');
  const catalog = JSON.parse(envelope.payload);
  if (catalog.format !== 1 || !Number.isSafeInteger(catalog.sequence) || catalog.sequence < 1 || !Number.isFinite(Date.parse(catalog.expiresAt)) || (fresh && Date.parse(catalog.expiresAt) <= now) || !Array.isArray(catalog.plugins) || catalog.plugins.length > IDS.length) fail('Catálogo inválido ou expirado.');
  const seen = new Set();
  for (const item of catalog.plugins) {
    assertId(item.id); version(item.version);
    if (seen.has(item.id) || !isHash(item.sha256) || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > MAX_PACKAGE) fail('Descritor de plugin inválido.');
    seen.add(item.id);
    const expected = `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(item.tag)}/organon-plugin-${item.id}-${item.version}.organon-plugin`;
    if (typeof item.tag !== 'string' || !/^v\d+\.\d+\.\d+$/.test(item.tag) || item.url !== expected) fail('Endereço de pacote não autorizado.');
  }
  return catalog;
}
// Follow only GitHub's asset redirects; never accept renderer-provided URLs.
function allowedDownload(url) {
  const u = new URL(url);
  return u.protocol === 'https:' && !u.username && !u.password && !u.port && (u.hostname === 'github.com' || u.hostname === 'release-assets.githubusercontent.com' || u.hostname === 'objects.githubusercontent.com');
}
async function download(url, limit, fetchImpl = globalThis.fetch) {
  const signal = AbortSignal.timeout(45000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!allowedDownload(url)) fail('Destino de download não autorizado.');
    const response = await fetchImpl(url, { redirect: 'manual', signal, headers: { 'User-Agent': 'Organon-Plugins', Accept: 'application/octet-stream' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) fail('Redirecionamento inválido.');
      url = new URL(location, url).href; continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); fail('Não foi possível baixar o plugin.'); }
    const declared = response.headers.get('content-length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) { await response.body.cancel(); fail('Download acima do limite permitido.'); }
    const chunks = []; let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) fail('Download acima do limite permitido.'); chunks.push(Buffer.from(value)); }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return Buffer.concat(chunks);
  }
  fail('Redirecionamentos demais no download.');
}

function createPluginManager({ directory, hostVersion, publicKey, fetchImpl = globalThis.fetch, emit = () => {} }) {
  version(hostVersion, true);
  const root = path.resolve(directory), objects = path.join(root, 'objects'), registryFile = path.join(root, 'installed.json');
  let registry = { format: 1, sequence: 0, installed: {} }, catalogEnvelope = null, busy = false, initialized = false, initializing;
  async function plain(target, directory = false) {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) fail('Caminho local de plugins inseguro.');
    return stat;
  }
  async function init() {
    if (initialized) return;
    if (!initializing) initializing = initialize().finally(() => { initializing = null; });
    return initializing;
  }
  async function initialize() {
    await fs.mkdir(root, { recursive: true }); await plain(root, true);
    await fs.mkdir(objects, { recursive: true }); await plain(objects, true);
    try {
      const stat = await plain(registryFile); if (stat.size > MAX_CATALOG * 8) fail('Registro local inválido.');
      const data = JSON.parse(await fs.readFile(registryFile, 'utf8'));
      if (data.format !== 1 || !Number.isSafeInteger(data.sequence) || data.sequence < 0 || !data.installed || Object.keys(data.installed).some(id => !IDS.includes(id))) fail('Registro local inválido.');
      registry = data;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    initialized = true;
  }
  async function write(next) {
    await plain(root, true); await plain(objects, true);
    const temporary = path.join(root, `registry-${crypto.randomUUID()}.tmp`);
    try { await fs.writeFile(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, registryFile); registry = next; }
    finally { await fs.unlink(temporary).catch(() => {}); }
  }
  function descriptor(record, id) {
    const catalog = verifyCatalog(record?.envelope, publicKey, { fresh: false });
    const item = catalog.plugins.find(p => p.id === id);
    if (!item || item.sha256 !== record.sha256) fail('Instalação sem manifesto autenticado.');
    return item;
  }
  async function read(record, id) {
    const item = descriptor(record, id), file = path.join(objects, `${item.sha256}.json`);
    await plain(root, true); await plain(objects, true);
    const stat = await plain(file); if (stat.size !== item.size) fail('Pacote local corrompido.');
    return { item, ...validatePackage(await fs.readFile(file), item, hostVersion) };
  }
  async function list() {
    await init();
    let catalog;
    if (catalogEnvelope) { try { catalog = verifyCatalog(catalogEnvelope, publicKey); } catch { /* Installed code still works offline after catalog expiry. */ } }
    const rows = [];
    for (const id of IDS) {
      const slot = registry.installed[id]; let error, installed = false, currentVersion;
      if (slot) { try { currentVersion = descriptor(slot.current, id).version; await read(slot.current, id); installed = true; } catch (e) { error = e.message; } }
      const candidate = catalog?.plugins.find(p => p.id === id);
      rows.push({ id, name: LABELS[id], installed, version: currentVersion, removable: !!slot, canRollback: !!slot?.previous, availableVersion: candidate?.version, updateAvailable: installed && candidate ? compare(candidate.version, currentVersion) > 0 : false, error });
    }
    return { plugins: rows, configured: !!publicKey, busy };
  }
  async function exclusive(task) {
    if (busy) fail('Aguarde a operação de plugins atual.'); busy = true;
    try { await init(); return await task(); } finally {
      if (initialized) await prune().catch(() => {});
      busy = false; try { emit(await list()); } catch { /* Do not mask an installation error. */ }
    }
  }
  async function prune() {
    await plain(root, true); await plain(objects, true);
    const keep = new Set(Object.values(registry.installed).flatMap(slot => [slot?.current?.sha256, slot?.previous?.sha256]).filter(isHash));
    for (const name of await fs.readdir(objects)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name) || keep.has(name.slice(0, -5))) continue;
      const target = path.resolve(objects, name);
      if (path.dirname(target) !== objects) fail('Caminho de limpeza inválido.');
      const stat = await fs.lstat(target);
      if (stat.isFile() && !stat.isSymbolicLink()) await fs.unlink(target);
    }
  }
  async function check() {
    return exclusive(async () => {
      const envelope = JSON.parse((await download(CATALOG_URL, MAX_CATALOG, fetchImpl)).toString('utf8'));
      const catalog = verifyCatalog(envelope, publicKey);
      if (catalog.sequence < registry.sequence) fail('Catálogo anterior ao já verificado.');
      await write({ ...registry, sequence: catalog.sequence }); catalogEnvelope = envelope;
      return { checked: true };
    });
  }
  async function install(id) {
    assertId(id);
    return exclusive(async () => {
      if (!catalogEnvelope) fail('Consulte o catálogo antes de instalar.');
      const catalog = verifyCatalog(catalogEnvelope, publicKey), item = catalog.plugins.find(p => p.id === id);
      if (!item || catalog.sequence < registry.sequence) fail('Plugin indisponível neste catálogo.');
      const old = registry.installed[id];
      if (old) {
        const previous = descriptor(old.current, id), order = compare(item.version, previous.version);
        if (order < 0) fail('Use a recuperação para voltar à versão anterior.');
        if (order === 0 && item.sha256 !== previous.sha256) fail('Esta versão já foi instalada com outro conteúdo. Publique uma versão nova do plugin.');
      }
      const bytes = await download(item.url, Math.min(item.size, MAX_PACKAGE), fetchImpl);
      validatePackage(bytes, item, hostVersion);
      await plain(root, true); await plain(objects, true);
      const target = path.join(objects, `${item.sha256}.json`), temporary = path.join(objects, `${crypto.randomUUID()}.tmp`);
      try {
        await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
        try { const stat = await plain(target); if (stat.size !== bytes.length || hash(await fs.readFile(target)) !== item.sha256) await fs.rename(temporary, target); }
        catch (error) { if (error.code !== 'ENOENT') throw error; await fs.rename(temporary, target); }
        const current = { sha256: item.sha256, envelope: catalogEnvelope };
        await write({ ...registry, sequence: catalog.sequence, installed: { ...registry.installed, [id]: { current, previous: old?.current?.sha256 !== item.sha256 ? old?.current || null : old?.previous || null } } });
      } finally { await fs.unlink(temporary).catch(() => {}); }
      return { installed: true, id, version: item.version };
    });
  }
  async function remove(id) {
    assertId(id);
    return exclusive(async () => {
      const installed = { ...registry.installed }; delete installed[id]; await write({ ...registry, installed });
      // Only unreferenced package objects are pruned; domain data is never located here.
      return { removed: true, id };
    });
  }
  async function rollback(id, expectedVersion) {
    assertId(id); version(expectedVersion);
    return exclusive(async () => {
      const slot = registry.installed[id];
      if (!slot?.previous || descriptor(slot.current, id).version !== expectedVersion) fail('A instalação mudou ou não há versão anterior.');
      await read(slot.previous, id);
      await write({ ...registry, installed: { ...registry.installed, [id]: { current: slot.previous, previous: null } } });
      return { restored: true, id };
    });
  }
  async function entry(id) {
    assertId(id); await init();
    const slot = registry.installed[id]; if (!slot) fail('Plugin não instalado.');
    const pkg = await read(slot.current, id);
    const base = `organon-plugin://modules/${id}/${pkg.item.sha256}/`;
    return { id, version: pkg.item.version, url: `${base}index.js`, css: pkg.files['style.css'] ? `${base}style.css` : null };
  }
  async function handleRequest(request) {
    try {
      if (request.method !== 'GET') return new Response(null, { status: 405 });
      const url = new URL(request.url);
      const match = /^\/(financeiro|mei)\/([a-f0-9]{64})\/(index\.js|style\.css)$/.exec(url.pathname);
      if (url.protocol !== 'organon-plugin:' || url.hostname !== 'modules' || url.port || url.username || url.password || url.search || url.hash || !match) return new Response(null, { status: 404 });
      await init(); const [, id, digest, name] = match, slot = registry.installed[id];
      if (!slot || slot.current.sha256 !== digest) return new Response(null, { status: 404 });
      const pkg = await read(slot.current, id), bytes = pkg.files[name];
      if (!bytes) return new Response(null, { status: 404 });
      return new Response(bytes, { headers: { 'Content-Type': name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Content-Security-Policy': "default-src 'none'" } });
    } catch { return new Response(null, { status: 404 }); }
  }
  return { list, check, install, remove, rollback, entry, handleRequest };
}

// Call registerSchemesAsPrivileged before app.ready; NEVER enable bypassCSP.
const scheme = { scheme: 'organon-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } };
function registerPluginIpc({ ipcMain, manager, isTrustedSender }) {
  if (typeof isTrustedSender !== 'function') fail('A validação da janela principal é obrigatória.');
  const actions = { list: () => manager.list(), check: () => manager.check(), install: id => manager.install(id), remove: id => manager.remove(id), rollback: (id, expectedVersion) => manager.rollback(id, expectedVersion), entry: id => manager.entry(id) };
  for (const [name, action] of Object.entries(actions)) ipcMain.handle(`plugins:${name}`, (event, ...args) => {
    if (!isTrustedSender(event)) fail('Janela não autorizada.');
    return action(...args);
  });
  return () => { for (const name of Object.keys(actions)) ipcMain.removeHandler(`plugins:${name}`); };
}
module.exports = { createPluginManager, registerPluginIpc, scheme, validateManifest, validatePackage, verifyCatalog, compatible, download, hash, ABI, IDS, MAX_PACKAGE, MAX_CATALOG, CATALOG_URL };

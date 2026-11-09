import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Module from 'node:module';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { prepareRepositories, describeArtifacts, publishRepositoryRelease } = require('../scripts/release-repositories.cjs');
const { REPOSITORY, LEGACY_REPOSITORY } = require('../electron/branding.cjs');
const { AppUpdates } = require('../electron/updates.cjs');
const { downloadCatalog, verifyCatalog } = require('../electron/plugins.cjs');


test('migration creates the new primary without renaming or deleting the update bridge', async () => {
  const calls = [], gitCalls = []; let created = false;
  const request = async (url, options = {}) => {
    calls.push([url, options.method || 'GET', options.body ? JSON.parse(options.body) : null]);
    if (url.endsWith(`/repos/${LEGACY_REPOSITORY}`)) return { permissions: { push: true }, private: false, owner: { login: 'leosalema213' } };
    if (url.endsWith(`/repos/${REPOSITORY}`)) return created ? { full_name: REPOSITORY, permissions: { push: true }, private: false } : null;
    if (url.endsWith('/user')) return { login: 'leosalema213' };
    if (url.endsWith('/user/repos')) { assert.equal(JSON.parse(options.body).name, 'Organon'); created = true; return {}; }
    throw new Error(url);
  };
  const git = (...args) => { gitCalls.push(args); return args.join(' ') === 'remote get-url origin' ? `https://github.com/${LEGACY_REPOSITORY}.git` : args.join(' ') === 'remote' ? 'origin' : ''; };
  assert.deepEqual(await prepareRepositories({ request, git }), [REPOSITORY, LEGACY_REPOSITORY]);
  assert.equal(calls.some(([, method, body]) => method === 'DELETE' || (method === 'PATCH' && Object.hasOwn(body, 'name'))), false);
  assert.equal(gitCalls.some(args => args.includes('--force') || args.includes('--mirror')), false);
  assert(gitCalls.some(args => args.join(' ') === `push https://github.com/${LEGACY_REPOSITORY}.git main --tags`));
  assert(gitCalls.some(args => args.join(' ') === `remote set-url origin https://github.com/${REPOSITORY}.git`));
});
test('migration stops for unexpected remotes before network mutations', async () => {
  await assert.rejects(prepareRepositories({ request: () => { throw new Error('Must not access network'); }, git: () => 'https://github.com/someone/another-project.git' }), /Origem Git inesperada/);
});
test('release uploads identical artifacts in both repos and safely resumes drafts', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-release-mirror-'));
  const files = ['Organon-Instalar.exe', 'Organon-Instalar.exe.sha256'].map(name => { const file = path.join(directory, name); fs.writeFileSync(file, `synthetic ${name}`); return file; });
  const artifacts = await describeArtifacts(files), releases = new Map();
  let failSecond = true, uploads = 0;
  const request = async (url, options = {}) => {
    const repo = [REPOSITORY, LEGACY_REPOSITORY].find(name => url.includes(`/repos/${name}/`) || url.includes(`/${name}/upload`));
    if (options.method === 'POST' && url.endsWith('/releases')) {
      const body = JSON.parse(options.body), release = { ...body, id: releases.size + 1, assets: [], upload_url: `https://uploads.github.com/${repo}/upload{?name}`, html_url: `https://github.com/${repo}/releases/tag/${body.tag_name}` };
      releases.set(repo, release); return release;
    }
    if (options.method === 'POST') {
      const name = new URL(url).searchParams.get('name');
      const bytes = Buffer.from(await new Response(options.body).arrayBuffer());
      assert.equal(bytes.toString(), `synthetic ${name}`);
      if (failSecond && name.endsWith('.sha256')) throw new Error('Simulated upload failure');
      uploads++;
      const asset = artifacts.find(item => item.name === name);
      releases.get(repo).assets.push({ name, size: asset.size, digest: asset.digest, state: 'uploaded' }); return {};
    }
    if (options.method === 'PATCH') { const release = releases.get(repo); release.draft = false; return release; }
    return releases.has(repo) ? [releases.get(repo)] : [];
  };
  const options = { request, version: '0.7.1', commit: 'synthetic-commit', notes: 'Organon', artifacts, log() {} };
  await assert.rejects(publishRepositoryRelease({ ...options, repository: LEGACY_REPOSITORY }), /Simulated/);
  assert.equal(releases.get(LEGACY_REPOSITORY).draft, true);
  failSecond = false;
  for (const repository of [LEGACY_REPOSITORY, REPOSITORY]) await publishRepositoryRelease({ ...options, repository });
  assert.equal(uploads, 4);
  assert.deepEqual(releases.get(REPOSITORY).assets, releases.get(LEGACY_REPOSITORY).assets);
  await publishRepositoryRelease({ ...options, repository: REPOSITORY });
  assert.equal(uploads, 4);
  releases.get(REPOSITORY).assets[0].digest = 'sha256:wrong';
  await assert.rejects(publishRepositoryRelease({ ...options, repository: REPOSITORY }), /divergente/);
});
test('new updater checks Organon first and falls back only while its release is absent', async () => {
  const urls = [];
  const updater = new AppUpdates({ version: '0.7.0', fetchImpl: async url => {
    urls.push(url);
    if (url.includes(`/repos/${REPOSITORY}/`)) return new Response('', { status: 404 });
    return Response.json({ tag_name: 'v0.7.1', assets: [{ name: 'Organon-Instalar.exe', size: 1, digest: `sha256:${'a'.repeat(64)}`, browser_download_url: `https://github.com/${LEGACY_REPOSITORY}/releases/download/v0.7.1/Organon-Instalar.exe` }] });
  } });
  assert.equal((await updater.check()).version, '0.7.1');
  assert(urls[0].includes(`/repos/${REPOSITORY}/`)); assert(urls[1].includes(`/repos/${LEGACY_REPOSITORY}/`));
  urls.length = 0;
  updater.fetch = async url => { urls.push(url); return new Response('', { status: 503 }); };
  assert.equal((await updater.check()).status, 'error'); assert.equal(urls.length, 1);
});
test('the actual 0.7.0 updater accepts the mirrored transition release and rejects a renamed URL', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const source = cp.execFileSync('git', ['show', 'v0.7.0:electron/updates.cjs'], { cwd: root, encoding: 'utf8' });
  const filename = path.join(root, 'electron', 'legacy-updater-test.cjs');
  const legacy = new Module(filename);
  legacy.filename = filename; legacy.paths = Module._nodeModulePaths(path.dirname(filename));
  legacy._compile(source, filename);
  let repository = LEGACY_REPOSITORY;
  const updater = new legacy.exports.AppUpdates({ version: '0.7.0', fetchImpl: async () => Response.json({ tag_name: 'v0.7.1', assets: [{ name: 'Organon-Instalar.exe', size: 1, digest: `sha256:${'b'.repeat(64)}`, browser_download_url: `https://github.com/${repository}/releases/download/v0.7.1/Organon-Instalar.exe` }] }) });
  assert.equal((await updater.check()).status, 'available');
  repository = REPOSITORY;
  assert.equal((await updater.check()).status, 'error');
});
test('plugin catalog fallback preserves the signed legacy envelope without accepting arbitrary URLs', async () => {
  const keys = crypto.generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const payload = JSON.stringify({ format: 1, sequence: 1, expiresAt: '2099-01-01T00:00:00Z', plugins: [{ id: 'financeiro', version: '1.0.0', size: 1, sha256: 'a'.repeat(64), tag: 'v0.7.1', url: `https://github.com/${LEGACY_REPOSITORY}/releases/download/v0.7.1/organon-plugin-financeiro-1.0.0.organon-plugin` }] });
  const sign = payload => ({ payload, signature: crypto.sign(null, Buffer.from(payload), keys.privateKey).toString('base64') });
  const bytes = Buffer.from(JSON.stringify(sign(payload)));
  const urls = [];
  const received = await downloadCatalog(async url => { urls.push(url); return url.includes(`/${REPOSITORY}/`) ? new Response('', { status: 404 }) : new Response(bytes); });
  assert(received.equals(bytes)); assert.equal(urls.length, 2);
  const catalog = verifyCatalog(JSON.parse(received), publicKey);
  assert.equal(catalog.plugins.every(plugin => plugin.url.startsWith(`https://github.com/${LEGACY_REPOSITORY}/`)), true);
  assert.equal(verifyCatalog(sign(payload.replace(LEGACY_REPOSITORY, REPOSITORY)), publicKey).plugins.length, 1);
  assert.throws(() => verifyCatalog(sign(payload.replace(LEGACY_REPOSITORY, 'someone/another-repo')), publicKey), /não autorizado/);
});

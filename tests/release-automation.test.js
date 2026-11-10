import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { acquire } = require('../scripts/build-lock.cjs');
const { fingerprint, approval } = require('../scripts/release-inputs.cjs');
const { gate } = require('../scripts/ci-release.cjs');
const project = path.resolve(import.meta.dirname, '..');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  cp.execFileSync('git', ['init', '--quiet'], { cwd: root });
  fs.writeFileSync(path.join(root, '.gitignore'), '.organon-build/\nrelease/\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.7.7', dependencies: { example: '1.0.0' } }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: '0.7.7', packages: { '': { version: '0.7.7' } } }));
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Histórico\n\n## 0.7.7\n\n- Histórico preservado.\n');
  fs.writeFileSync(path.join(root, 'app.js'), 'console.log("original");\n');
  for (const file of ['scripts/version.cjs', 'scripts/build-lock.cjs', 'scripts/release-inputs.cjs', 'electron/versions.cjs']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(project, file), path.join(root, file));
  }
  return root;
}
function version(root, ...args) {
  const env = { ...process.env }; delete env.ORGANON_BUILD_LOCK;
  return cp.spawnSync(process.execPath, [path.join(root, 'scripts/version.cjs'), ...args], { cwd: root, env, encoding: 'utf8' });
}
function completedPreview(root) {
  const result = version(root, 'preview'); assert.equal(result.status, 0, result.stderr);
  const current = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
  const output = path.join(root, 'release', current); fs.mkdirSync(output, { recursive: true });
  const bytes = Buffer.from('fixture installer'); fs.writeFileSync(path.join(output, 'Organon-Instalar.exe'), bytes);
  const receipt = { schema: 1, version: current, complete: true, sourceSha256: fingerprint(root), installerSha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  fs.writeFileSync(path.join(root, '.organon-build', 'preview.json'), JSON.stringify(receipt));
  return receipt;
}

test('parallel owners are rejected; recovery refuses live processes and accepts a dead owner', t => {
  const root = fixture(t), lock = acquire(root);
  const token = process.env.ORGANON_BUILD_LOCK;
  // A nested version process may reuse the owner, but a separate invocation may not.
  acquire(root).close();
  delete process.env.ORGANON_BUILD_LOCK;
  assert.throws(() => acquire(root), /bloqueado/);
  assert.throws(() => acquire(root, true), /bloqueado/);
  process.env.ORGANON_BUILD_LOCK = token; lock.close();
  const dead = cp.spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' }).pid;
  fs.writeFileSync(path.join(root, '.organon-build', 'lock.json'), JSON.stringify({ token: 'dead', pid: dead, children: [] }));
  assert.throws(() => acquire(root), /bloqueado/);
  acquire(root, true).close();
  assert.equal(fs.existsSync(path.join(root, '.organon-build', 'lock.json')), false);
});

test('promotion and line endings preserve source identity; dependency and binary changes invalidate it', t => {
  const root = fixture(t), original = fingerprint(root);
  require('../scripts/version.cjs').writeVersion(root, '0.7.8-preview.1');
  assert.equal(fingerprint(root), original);
  require('../scripts/version.cjs').writeVersion(root, '0.7.8');
  fs.writeFileSync(path.join(root, 'app.js'), 'console.log("original");\r\n');
  assert.equal(fingerprint(root), original);
  fs.writeFileSync(path.join(root, 'README.md'), 'Documentation only');
  assert.equal(fingerprint(root), original);
  fs.writeFileSync(path.join(root, 'asset.bin'), Buffer.from([0, 255, 254]));
  const withAsset = fingerprint(root);
  fs.writeFileSync(path.join(root, 'asset.bin'), Buffer.from([0, 254, 255]));
  assert.notEqual(fingerprint(root), withAsset);
  fs.unlinkSync(path.join(root, 'asset.bin'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))); pkg.dependencies.example = '2.0.0';
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
  assert.notEqual(fingerprint(root), original);
});

test('final promotion requires explicit acceptance, a completed receipt and unchanged installer/sources', t => {
  const root = fixture(t), receipt = completedPreview(root);
  assert.notEqual(version(root, 'final').status, 0);
  const receiptFile = path.join(root, '.organon-build', 'preview.json');
  fs.writeFileSync(receiptFile, JSON.stringify({ ...receipt, complete: false }));
  assert.notEqual(version(root, 'final', '--approved-preview').status, 0);
  fs.writeFileSync(receiptFile, JSON.stringify(receipt));
  const installer = path.join(root, 'release', receipt.version, 'Organon-Instalar.exe');
  fs.writeFileSync(installer, 'modified installer');
  assert.notEqual(version(root, 'final', '--approved-preview').status, 0);
  fs.writeFileSync(installer, 'fixture installer');
  fs.writeFileSync(path.join(root, 'app.js'), 'changed sources');
  assert.notEqual(version(root, 'final', '--approved-preview').status, 0);
  fs.writeFileSync(path.join(root, 'app.js'), 'console.log("original");\n');
  const result = version(root, 'final', '--approved-preview'); assert.equal(result.status, 0, result.stderr);
  const record = approval(root, '0.7.8');
  assert.equal(record.preview, receipt.version); assert.equal(record.installerSha256, receipt.installerSha256);
  assert.match(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), /## 0\.7\.7\n\n- Histórico preservado/);
  fs.writeFileSync(path.join(root, 'app.js'), 'post-approval change');
  assert.throws(() => approval(root, '0.7.8'), /fontes alteradas/);
});

test('allocated preview identities survive pruning and an old version checkout', t => {
  const root = fixture(t);
  assert.equal(version(root, 'preview').status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '0.7.8-preview.1');
  require('../scripts/version.cjs').writeVersion(root, '0.7.7');
  assert.equal(version(root, 'preview').status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '0.7.8-preview.2');
});

function git(root, ...args) {
  return cp.execFileSync('git', ['-c', 'user.name=Release fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: root, encoding: 'utf8' }).trim();
}
function ciFixture(t, changedPlugin = false) {
  const root = fixture(t);
  git(root, 'add', '.'); git(root, 'commit', '--quiet', '-m', 'base'); git(root, 'tag', 'v0.7.7');
  const before = git(root, 'rev-parse', 'HEAD');
  if (changedPlugin) {
    fs.mkdirSync(path.join(root, 'src', 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'plugins', 'example.js'), 'changed plugin');
  }
  completedPreview(root);
  const result = version(root, 'final', '--approved-preview'); assert.equal(result.status, 0, result.stderr);
  git(root, 'add', '.'); git(root, 'commit', '--quiet', '-m', 'approved promotion');
  const eventFile = path.join(root, '.organon-build', 'event.json');
  fs.writeFileSync(eventFile, JSON.stringify({ before }));
  return { directory: root, env: { GITHUB_REPOSITORY: 'leosalema213/Organon', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: eventFile }, requestImpl: async url => url.endsWith('/latest') ? { tag_name: 'v0.7.7' } : null };
}

test('CI allows the approved next stable and skips unchanged versions and public releases', async t => {
  const options = ciFixture(t);
  assert.equal(await gate(options), true);
  assert.equal(await gate({ ...options, requestImpl: async url => url.endsWith('/latest') ? { tag_name: 'v0.7.8' } : { draft: false } }), false);
  fs.writeFileSync(options.env.GITHUB_EVENT_PATH, JSON.stringify({ before: git(options.directory, 'rev-parse', 'HEAD') }));
  assert.equal(await gate({ ...options, requestImpl: async () => { throw new Error('Unchanged version must not query publication'); } }), false);
});

test('CI rejects a wrong repository, wrong sequence, post-approval changes and unsigned plugin changes', async t => {
  const options = ciFixture(t);
  await assert.rejects(gate({ ...options, env: { ...options.env, GITHUB_REPOSITORY: 'leosalema213/app-estudos' } }), /restrito/);
  await assert.rejects(gate({ ...options, requestImpl: async url => url.endsWith('/latest') ? { tag_name: 'v0.7.6' } : null }), /próxima/);
  fs.writeFileSync(path.join(options.directory, 'app.js'), 'post-approval modification');
  await assert.rejects(gate(options), /fontes alteradas/);
  await assert.rejects(gate(ciFixture(t, true)), /adicionais mudaram/);
});

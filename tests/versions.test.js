import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseVersion, isProductionVersion, nextStable, nextPreview } = require('../electron/versions.cjs');
const { writeVersion } = require('../scripts/version.cjs');

test('version sequence rolls PATCH after nine and retains legacy versions for comparison', () => {
  assert.equal(nextStable('0.4.8'), '0.4.9');
  assert.equal(nextStable('0.4.9'), '0.5.0');
  assert.equal(nextStable('0.4.10'), '0.5.0');
  assert.equal(nextStable('0.5.9'), '0.6.0');
  assert.equal(parseVersion('v0.4.10').base, '0.4.10');
  assert.equal(isProductionVersion('0.5.0'), true);
  for (const version of ['0.4.10', '0.5.0-preview.1', 'v0.5.0', '0.5', '../0.5.0', '00.5.0']) assert.equal(isProductionVersion(version), false);
});

test('each preview has a unique counter and the final shares its target numeric version', () => {
  assert.equal(nextPreview('0.5.0'), '0.5.1-preview.1');
  assert.equal(nextPreview('0.4.9'), '0.5.0-preview.1');
  assert.equal(nextPreview('0.5.1-preview.1'), '0.5.1-preview.2');
  assert.equal(nextStable('0.5.1-preview.2'), '0.5.1');
  for (const version of ['0.5.0-preview.0', '0.5.0-preview.01', '0.5.0-beta', 'invalid']) assert.equal(parseVersion(version), null);
});

test('version preparation preserves unrelated metadata, dependency versions and changelog history', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-version-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'organon', version: '0.5.0', custom: { retained: true } }, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: '0.5.0', packages: { '': { name: 'organon', version: '0.5.0' }, 'node_modules/example': { version: '0.5.0' } } }, null, 2) + '\n');
  const history = '# Histórico\n\n## 0.5.0\n\n- Dados anteriores.\n';
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), history);
  writeVersion(root, '0.5.1-preview.1');
  writeVersion(root, '0.5.1-preview.2');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(pkg.version, '0.5.1-preview.2'); assert.deepEqual(pkg.custom, { retained: true });
  assert.equal(lock.version, pkg.version); assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(lock.packages['node_modules/example'].version, '0.5.0');
  let changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.equal(changelog.split('## 0.5.1').length, 2); assert(changelog.endsWith(history.split('\n\n').slice(1).join('\n\n')));
  writeVersion(root, '0.5.1');
  changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /## 0\.5\.1\n/); assert(!changelog.includes('em desenvolvimento'));
  assert.throws(() => writeVersion(root, '0.5.10'), /inválida/);
});

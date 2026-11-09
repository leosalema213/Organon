import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { AppUpdates, INSTALLER } = require('../electron/updates.cjs');
const payload = Buffer.from('inert update fixture, never executed');
const sha256 = crypto.createHash('sha256').update(payload).digest('hex');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-update-schedule-'));
  t.after(() => {
    const target = path.resolve(directory);
    if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('organon-update-schedule-')) fs.rmSync(target, { recursive: true, force: true });
  });
  const file = path.join(directory, '0.7.3', INSTALLER);
  fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, payload);
  const calls = [];
  const reopen = (version = '0.7.2', fail = false) => new AppUpdates({ version, cacheDir: directory,
    fetchImpl: async () => { throw new Error('Offline fixture: network forbidden'); },
    launchInstaller: async installer => { if (fail) throw new Error('Installer unavailable'); calls.push(installer); },
    onQuit: () => calls.push('quit'),
  });
  const updater = reopen();
  updater.candidate = { version: '0.7.3', size: payload.length, sha256 };
  updater.installer = file; updater.installerHash = sha256;
  updater.set({ status: 'ready', version: '0.7.3', percent: 100 });
  return { updater, reopen, directory, file, calls };
}

test('scheduling persists authorization without quitting or launching; periodic checks preserve it', async t => {
  const f = fixture(t);
  const results = await Promise.all([f.updater.schedule(), f.updater.schedule()]);
  assert(results.every(value => value.status === 'scheduled'));
  assert.deepEqual(f.calls, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.updater.pendingFile)), { schema: 1, version: '0.7.3', size: payload.length, sha256, attempted: false });
  assert.equal((await f.updater.check()).status, 'scheduled');
  assert.equal((await f.updater.download()).status, 'scheduled');
  await f.updater.cleanupInstalled(); assert(fs.existsSync(f.file));
});

test('next launch works offline and consumes automatic execution before handing off to the installer', async t => {
  const f = fixture(t); await f.updater.schedule();
  const next = f.reopen();
  assert.equal(await next.resumeScheduled(), true);
  assert.deepEqual(f.calls, [f.file, 'quit']);
  assert.equal(JSON.parse(fs.readFileSync(next.pendingFile)).attempted, true);
  const cancelledInstaller = f.reopen();
  assert.equal(await cancelledInstaller.resumeScheduled(), false);
  assert.equal(cancelledInstaller.state.status, 'ready');
  assert.equal(fs.existsSync(next.pendingFile), false);
  assert.deepEqual(f.calls, [f.file, 'quit']);
});

test('cancel keeps the downloaded update available and prevents automatic installation', async t => {
  const f = fixture(t); await f.updater.schedule();
  assert.equal((await f.updater.cancelSchedule()).status, 'ready');
  assert.equal(fs.existsSync(f.file), true);
  assert.equal(await f.reopen().resumeScheduled(), false);
  assert.deepEqual(f.calls, []);
  assert.equal((await f.updater.install()).status, 'installing');
  assert.deepEqual(f.calls, [f.file, 'quit']);
});

test('install now can replace scheduling without an automatic installation loop', async t => {
  const f = fixture(t); await f.updater.schedule();
  await f.updater.install();
  assert.equal(await f.reopen().resumeScheduled(), false);
  assert.deepEqual(f.calls, [f.file, 'quit']);
});

test('installer launch failure opens the old version and never retries automatically', async t => {
  const f = fixture(t); await f.updater.schedule();
  assert.equal(await f.reopen('0.7.2', true).resumeScheduled(), false);
  assert.equal(await f.reopen().resumeScheduled(), false);
  assert.deepEqual(f.calls, []);
});

test('tampering before scheduling or next launch cannot execute an installer', async t => {
  const f = fixture(t);
  fs.writeFileSync(f.file, 'tampered');
  assert.equal((await f.updater.schedule()).status, 'ready');
  assert.equal(fs.existsSync(f.updater.pendingFile), false);
  fs.writeFileSync(f.file, payload); await f.updater.schedule();
  fs.writeFileSync(f.file, 'tampered');
  assert.equal(await f.reopen().resumeScheduled(), false);
  assert.deepEqual(f.calls, []);
});

test('missing installer, malformed metadata and traversal paths preserve startup without execution', async t => {
  const f = fixture(t); await f.updater.schedule();
  const metadata = JSON.parse(fs.readFileSync(f.updater.pendingFile));
  for (const value of ['invalid json', JSON.stringify({ ...metadata, version: '../0.7.3' }), JSON.stringify({ ...metadata, size: -1 }), JSON.stringify({ ...metadata, sha256: 'x' })]) {
    fs.writeFileSync(f.updater.pendingFile, value);
    assert.equal(await f.reopen().resumeScheduled(), false);
  }
  fs.writeFileSync(f.updater.pendingFile, JSON.stringify(metadata)); fs.unlinkSync(f.file);
  assert.equal(await f.reopen().resumeScheduled(), false);
  assert.deepEqual(f.calls, []);
});

test('already updated versions clear the schedule without reinstalling or removing personal files', async t => {
  const f = fixture(t); await f.updater.schedule();
  const personal = path.join(f.directory, 'study-data.json'); fs.writeFileSync(personal, 'preserved');
  assert.equal(await f.reopen('0.7.3').resumeScheduled(), false);
  assert.equal(fs.existsSync(f.updater.pendingFile), false);
  assert.equal(fs.readFileSync(personal, 'utf8'), 'preserved');
  assert.deepEqual(f.calls, []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { seed } from '../src/model.js';
const require = createRequire(import.meta.url);
const { CloudFiles, CHUNK_SIZE } = require('../electron/cloud-files.cjs');
const { packDocument, unpackDocument, hash } = require('../electron/cloud-document.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-files-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const files = new CloudFiles(directory), data = seed();
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(CHUNK_SIZE + 17, 7)]), digest = hash(pdf);
  files.books.put(pdf, digest);
  data.books = [{ id: 'book', hash: digest, size: pdf.length, format: 'pdf' }];
  const audio = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(128, 2)]);
  data.anki.media['sound.mp3'] = files.books.ankiMedia.put(audio, 'sound.mp3');
  return { directory, files, data, pdf, audio };
}

test('cloud files roundtrip book chunks and Anki media without changing portable metadata', async t => {
  const h = fixture(t), packed = packDocument(h.data, h.files);
  assert.equal(packed.payload.organonFiles.version, 1);
  assert.equal(packed.payload.organonFiles.books[h.data.books[0].hash].chunks.length, 2);
  assert.equal(packed.assets.size, 3);
  for (const [digest, asset] of packed.assets) { assert.equal(hash(asset.load()), digest); assert(asset.load().length <= CHUNK_SIZE); }
  const destination = path.join(h.directory, 'second-computer'), files = new CloudFiles(destination);
  const restored = await unpackDocument(packed.payload, async digest => packed.assets.get(digest).load(), files);
  assert.deepEqual(restored, h.data);
  assert.deepEqual(files.books.read(h.data.books[0].hash), h.pdf);
  assert.deepEqual(files.books.ankiMedia.read(h.data.anki.media['sound.mp3']), h.audio);
  assert.equal(packDocument(restored, files).checksum, packed.checksum);
  const backup = path.join(destination, 'backup.json'); files.books.export(backup, restored);
  const verified = files.books.verifyBackup(JSON.parse(fs.readFileSync(backup)));
  assert.equal(verified.files.size, 1); assert.equal(verified.ankiFiles.size, 1);
  const again = await unpackDocument(packed.payload, () => { throw new Error('Existing binaries must be reused'); }, files);
  assert.deepEqual(again, restored);
});

test('missing local binary prevents packing rather than committing incomplete data', t => {
  const h = fixture(t);
  fs.unlinkSync(h.files.books.ankiMedia.file(h.data.anki.media['sound.mp3'].hash));
  assert.throws(() => packDocument(h.data, h.files));
});

test('corrupt chunks and invalid sizes cannot install an online book', async t => {
  const h = fixture(t), packed = packDocument(h.data, h.files), target = new CloudFiles(path.join(h.directory, 'corrupt'));
  await assert.rejects(unpackDocument(packed.payload, () => Buffer.from('bad'), target), /corrompido/);
  assert.equal(fs.existsSync(target.books.file(h.data.books[0].hash)), false);
  packed.payload.organonFiles.books[h.data.books[0].hash].chunks = [];
  await assert.rejects(unpackDocument(packed.payload, () => { throw new Error('Do not download'); }, target), /Manifesto/);
});

test('files changed after packing are rejected and old cloud documents remain compatible', async t => {
  const h = fixture(t), packed = packDocument(h.data, h.files);
  fs.writeFileSync(h.files.books.file(h.data.books[0].hash), Buffer.from('%PDF-changed'));
  assert.throws(() => packed.assets.values().next().value.load(), /alterado/);
  const old = seed(); assert.deepEqual(await unpackDocument(packDocument(old).payload, () => {}), old);
  await assert.rejects(unpackDocument(h.data, () => {}, h.files), /não contém/);
});

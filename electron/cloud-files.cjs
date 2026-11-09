const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { BookFiles, LIMIT: BOOK_LIMIT } = require('./books.cjs');
const { LIMIT: MEDIA_LIMIT } = require('./anki-media.cjs');
const { mapTransfers } = require('./cloud-transfer.cjs');
const CHUNK_SIZE = 4 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// Binary manifests belong only to the cloud transport, never to the working document.
class CloudFiles {
  constructor(directory) { this.books = new BookFiles(directory); }
  entries(data) {
    return [
      ...(data.books || []).map(meta => ({ kind: 'books', meta, limit: BOOK_LIMIT,
        file: () => this.books.file(meta.hash, meta.format), check: bytes => this.books.check(bytes, meta.hash, meta.size, meta.format),
        install: bytes => this.books.put(bytes, meta.hash, meta.format) })),
      ...Object.values(data.anki?.media || {}).map(meta => ({ kind: 'anki', meta, limit: MEDIA_LIMIT,
        file: () => this.books.ankiMedia.file(meta.hash), check: bytes => this.books.ankiMedia.check(bytes, meta),
        install: bytes => this.books.ankiMedia.install(bytes, meta) })),
    ];
  }
  prepare(data) {
    const manifest = { version: 1, books: {}, anki: {} }, assets = new Map();
    for (const entry of this.entries(data)) {
      const { meta, kind } = entry;
      if (!validHash(meta.hash) || !Number.isInteger(meta.size) || meta.size < 1 || meta.size > entry.limit) throw new Error('Arquivo inválido para sincronizar.');
      const file = entry.file();
      if (fs.statSync(file).size !== meta.size) throw new Error('Arquivo local ausente ou incompleto. Exporte um backup antes de sincronizar.');
      const bytes = fs.readFileSync(file); entry.check(bytes);
      const chunks = [];
      for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
        const length = Math.min(CHUNK_SIZE, bytes.length - offset), digest = hash(bytes.subarray(offset, offset + length));
        chunks.push(digest);
        // Keep descriptors rather than every book/audio buffer in memory during network I/O.
        assets.set(digest, { type: 'application/octet-stream', load: () => {
          const buffer = Buffer.alloc(length), fd = fs.openSync(file, 'r');
          try {
            if (fs.readSync(fd, buffer, 0, length, offset) !== length || hash(buffer) !== digest) throw new Error('Arquivo local alterado durante a sincronização. Tente novamente.');
            return buffer;
          } finally { fs.closeSync(fd); }
        } });
      }
      manifest[kind][meta.hash] = { size: meta.size, chunks };
    }
    return { manifest: assets.size ? manifest : null, assets };
  }
  async restore(data, manifest, download, onItem = () => {}) {
    const entries = this.entries(data);
    if (!entries.length && !manifest) return;
    if (manifest?.version !== 1 || !manifest.books || !manifest.anki) throw new Error('A cópia online não contém todos os arquivos.');
    for (const entry of entries) {
      const { meta } = entry, item = manifest[entry.kind][meta.hash];
      if (!validHash(meta.hash) || !Number.isInteger(meta.size) || meta.size < 1 || meta.size > entry.limit || item?.size !== meta.size || !Array.isArray(item.chunks) || item.chunks.length !== Math.ceil(meta.size / CHUNK_SIZE) || !item.chunks.every(validHash)) throw new Error('Manifesto de arquivos online inválido.');
      try {
        if (fs.statSync(entry.file()).size === meta.size) { entry.check(fs.readFileSync(entry.file())); onItem(meta.title || meta.name || (entry.kind === 'books' ? 'Livro' : 'Mídia de carta')); continue; }
      } catch { /* A missing/corrupt local file can be recovered from the verified cloud copy. */ }
      const bytes = Buffer.alloc(meta.size);
      await mapTransfers(item.chunks, async (digest, index) => {
        const chunk = await download(digest);
        if (chunk.length !== Math.min(CHUNK_SIZE, meta.size - index * CHUNK_SIZE) || hash(chunk) !== item.chunks[index]) throw new Error('Arquivo online incompleto ou corrompido.');
        chunk.copy(bytes, index * CHUNK_SIZE);
      });
      entry.check(bytes); entry.install(bytes);
      onItem(meta.title || meta.name || (entry.kind === 'books' ? 'Livro' : 'Mídia de carta'));
    }
  }
}
module.exports = { CloudFiles, CHUNK_SIZE };

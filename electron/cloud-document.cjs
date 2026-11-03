const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, function (key, item) { return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item; });
const imagePattern = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
function packDocument(data, files) {
  // Book binaries live outside the snapshot. Never advertise an incomplete remote backup.
  if (data.books?.length && !files) throw new Error('A sincronização de livros exige acesso aos arquivos locais. Exporte um backup local completo.');
  if (Object.keys(data.anki?.media || {}).length && !files) throw new Error('A sincronização de mídia Anki exige acesso aos arquivos locais. Exporte um backup local completo.');
  const prepared = files?.prepare(data), assets = prepared?.assets || new Map();
  function visit(value) {
    if (typeof value === 'string') {
      const match = value.match(imagePattern);
      if (match) {
        const bytes = Buffer.from(match[2], 'base64'), digest = hash(bytes);
        assets.set(digest, { bytes, type: `image/${match[1]}` });
        return { organonAsset: digest, mime: `image/${match[1]}` };
      }
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, value]) => [key, visit(value)]));
    return value;
  }
  const payload = visit(data);
  if (prepared?.manifest) payload.organonFiles = prepared.manifest;
  // Starting the app must not create an apparent content change by itself.
  if (payload.active) payload.active = { ...payload.active, running: false, startedAt: 0 };
  return { payload, checksum: hash(canonical(payload)), assets };
}
async function unpackDocument(payload, download, files) {
  const cache = new Map();
  async function visit(value) {
    if (value && typeof value === 'object' && Object.hasOwn(value, 'organonAsset')) {
      const digest = value.organonAsset;
      if (!/^[a-f0-9]{64}$/.test(digest) || !['image/png', 'image/jpeg', 'image/webp'].includes(value.mime)) throw new Error('Imagem inválida no backup online.');
      if (!cache.has(digest)) cache.set(digest, Promise.resolve(download(digest)).then(bytes => {
        if (hash(bytes) !== digest) throw new Error('A imagem online está incompleta. Tente novamente.');
        return bytes;
      }));
      return `data:${value.mime};base64,${(await cache.get(digest)).toString('base64')}`;
    }
    if (Array.isArray(value)) { const result = []; for (const item of value) result.push(await visit(item)); return result; }
    if (value && typeof value === 'object') { const result = {}; for (const [key, item] of Object.entries(value)) result[key] = await visit(item); return result; }
    return value;
  }
  const { organonFiles, ...metadata } = payload;
  const data = await visit(metadata);
  if (organonFiles || data.books?.length || Object.keys(data.anki?.media || {}).length) {
    if (!files) throw new Error('A cópia online exige restauração dos arquivos.');
    await files.restore(data, organonFiles, download);
  }
  return data;
}
module.exports = { packDocument, unpackDocument, hash, canonical };

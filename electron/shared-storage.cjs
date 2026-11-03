const { randomUUID } = require('node:crypto');
// A fresh cache key forces the private Storage origin to evaluate current RLS.
// Previously delivered bytes/URLs may remain in external caches until expiry.
function privateDownloadPath(bucket, object) {
  if (!['organon-shared', 'organon-kanban'].includes(bucket) || typeof object !== 'string' || object.split('/').some(part => !part || part === '.' || part === '..' || !/^[A-Za-z0-9._-]+$/.test(part))) throw new Error('Referência privada inválida.');
  return `/storage/v1/object/authenticated/${bucket}/${object}?cacheNonce=${randomUUID()}`;
}
const downloadHeaders = Object.freeze({ 'Cache-Control': 'no-cache', Pragma: 'no-cache' });
const uploadHeaders = Object.freeze({ 'Cache-Control': 'max-age=0' });
module.exports = { privateDownloadPath, downloadHeaders, uploadHeaders };

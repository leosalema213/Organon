// Verify all optional packages before any GitHub mutation by the release publisher.
const fs = require('node:fs');
const path = require('node:path');
const { verifyCatalog, validatePackage, IDS } = require('../electron/plugins.cjs');
const publicKey = require('../electron/plugin-public-key.cjs');
function pluginReleaseAssets(root, hostVersion, reuseCatalog = false) {
  const directory = path.join(root, 'plugins', 'out');
  const catalogFile = path.join(directory, 'organon-plugins-catalog.json');
  const catalog = verifyCatalog(JSON.parse(fs.readFileSync(catalogFile, 'utf8')), publicKey);
  if (catalog.plugins.length !== IDS.length) throw new Error('O catálogo deve conter os dois adicionais oficiais.');
  const files = [catalogFile];
  for (const descriptor of catalog.plugins) {
    if (!reuseCatalog && descriptor.tag !== `v${hostVersion}`) throw new Error('Gere o catálogo para a versão desta Release antes de publicar.');
    const file = path.join(directory, `organon-plugin-${descriptor.id}-${descriptor.version}.organon-plugin`);
    validatePackage(fs.readFileSync(file), descriptor, hostVersion);
    if (!reuseCatalog) files.push(file);
  }
  return files;
}
module.exports = { pluginReleaseAssets };

// Reuse the public signed bytes; no signing key or new catalog is generated in CI.
const fs = require('node:fs');
const path = require('node:path');
const { downloadCatalog, download, verifyCatalog, validatePackage, MAX_PACKAGE } = require('../electron/plugins.cjs');
const key = require('../electron/plugin-public-key.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const bytes = await downloadCatalog();
  const catalog = verifyCatalog(JSON.parse(bytes), key);
  const directory = path.join(root, 'plugins', 'out');
  fs.mkdirSync(directory, { recursive: true });
  for (const descriptor of catalog.plugins) {
    const pkg = await download(descriptor.url, MAX_PACKAGE);
    validatePackage(pkg, descriptor, require('../package.json').version);
    fs.writeFileSync(path.join(directory, `organon-plugin-${descriptor.id}-${descriptor.version}.organon-plugin`), pkg);
  }
  fs.writeFileSync(path.join(directory, 'organon-plugins-catalog.json'), bytes);
  console.log('Catálogo público e pacotes assinados restaurados e validados, sem nova assinatura.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });

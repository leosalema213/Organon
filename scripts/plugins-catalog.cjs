// Run only in the release signing environment; never publish the private key.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyCatalog, validatePackage, hash } = require('../electron/plugins.cjs');
const root = path.resolve(__dirname, '..');

async function createCatalog({ tag, sequence, expiresAt, privateKeyFile }) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || !Number.isSafeInteger(sequence) || sequence < 1 || !(Date.parse(expiresAt) > Date.now())) throw new Error('Tag estável, sequência crescente e expiração futura são obrigatórias.');
  if (!privateKeyFile) throw new Error('Defina ORGANON_PLUGIN_SIGNING_KEY_FILE no ambiente de publicação.');
  const key = crypto.createPrivateKey(await fs.readFile(privateKeyFile));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('A chave de publicação deve ser Ed25519.');
  const publicKey = crypto.createPublicKey(key);
  const output = path.join(root, 'plugins', 'out');
  const index = JSON.parse(await fs.readFile(path.join(output, 'packages.json'), 'utf8'));
  if (index.format !== 1 || index.plugins?.length !== 2) throw new Error('Gere os dois pacotes antes do catálogo.');
  const plugins = [];
  for (const descriptor of index.plugins) {
    const expectedName = `organon-plugin-${descriptor.id}-${descriptor.version}.organon-plugin`;
    if (descriptor.filename !== expectedName || !['financeiro', 'mei'].includes(descriptor.id) || !/^\d+\.\d+\.\d+$/.test(descriptor.version)) throw new Error('Índice de pacotes inválido.');
    const bytes = await fs.readFile(path.join(output, expectedName));
    const pkg = JSON.parse(bytes.toString('utf8'));
    validatePackage(bytes, descriptor, pkg.manifest.minHost);
    plugins.push({ id: descriptor.id, version: descriptor.version, size: bytes.length, sha256: hash(bytes), tag, url: `https://github.com/leosalema213/app-estudos/releases/download/${tag}/${expectedName}` });
  }
  const payload = JSON.stringify({ format: 1, sequence, expiresAt, plugins });
  const envelope = { payload, signature: crypto.sign(null, Buffer.from(payload), key).toString('base64') };
  verifyCatalog(envelope, publicKey.export({ type: 'spki', format: 'pem' }));
  await fs.writeFile(path.join(output, 'organon-plugins-catalog.json'), JSON.stringify(envelope) + '\n');
  return { publicKey: publicKey.export({ type: 'spki', format: 'pem' }), assets: [...plugins.map(p => path.basename(new URL(p.url).pathname)), 'organon-plugins-catalog.json'] };
}
module.exports = { createCatalog };

if (require.main === module) {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(name); if (i < 0 || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Informe ${name}.`); return args[i + 1]; };
  (async () => {
    const result = await createCatalog({ tag: option('--tag'), sequence: Number(option('--sequence')), expiresAt: option('--expires-at'), privateKeyFile: process.env.ORGANON_PLUGIN_SIGNING_KEY_FILE });
    console.log(`Assets preparados, sem publicação:\n${result.assets.join('\n')}\nChave pública a fixar no main:\n${result.publicKey}`);
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}

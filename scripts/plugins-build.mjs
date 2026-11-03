// Separate release asset build; does not load vite.config.js or write dist/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'vite';

const require = createRequire(import.meta.url);
const { hash, validateManifest, validatePackage, MAX_PACKAGE } = require('../electron/plugins.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'globalThis[Symbol.for("organon.plugins.host.v1")]';
const hostModules = new Map([
  ['react', { member: 'React', exports: Object.keys(require('react')) }],
  ['react-dom', { member: 'ReactDOM', exports: Object.keys(require('react-dom')) }],
  ['react/jsx-runtime', { member: 'JSXRuntime', exports: Object.keys(require('react/jsx-runtime')) }],
]);
const shared = new Map(['Modal', 'PopupMenu', 'RichTextField'].map(name => [path.join(root, 'src', `${name}.jsx`), name]));

export function hostPlugin() {
  return {
    name: 'organon-plugin-host-abi',
    enforce: 'pre',
    resolveId(source, importer) {
      if (hostModules.has(source)) return `\0organon-host:${source}`;
      if (/^react(?:-dom)?\//.test(source)) throw new Error(`Importação React não suportada pelo ABI: ${source}`);
      if (importer && source.startsWith('.')) {
        const target = path.resolve(path.dirname(importer), source);
        const member = shared.get(target) || shared.get(`${target}.jsx`);
        if (member) return `\0organon-shared:${member}`;
      }
      return null;
    },
    load(id) {
      if (id.startsWith('\0organon-shared:')) return `export default ${KEY}.${id.split(':')[1]};`;
      if (!id.startsWith('\0organon-host:')) return null;
      const info = hostModules.get(id.slice('\0organon-host:'.length));
      const exports = info.exports.filter(name => name !== 'default' && /^[A-Za-z_$][\w$]*$/.test(name));
      return `const host=${KEY}.${info.member}; export default host.default || host;\n${exports.map(name => `export const ${name}=host.${name};`).join('\n')}`;
    },
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue;
        if (item.imports.length || item.dynamicImports.length) throw new Error('O pacote deve ser autocontido, sem imports externos ou chunks adicionais.');
        for (const file of Object.keys(item.modules)) {
          if (/[\\/]node_modules[\\/](?:react|react-dom)[\\/]/.test(file)) throw new Error('React deve ser compartilhado com o host.');
          // Domain packages may reuse their own helpers, never the other optional page.
          const other = item.facadeModuleId?.replaceAll('\\', '/').includes('/financeiro/') ? 'mei' : 'financeiro';
          if (file.replaceAll('\\', '/').includes(`/src/plugins/${other}/`)) throw new Error('Um pacote não deve incluir o outro adicional.');
        }
      }
    },
  };
}

export async function buildPackages({ version, minHost, maxHostExclusive }) {
  const outputDir = path.join(root, 'plugins', 'out');
  await fs.mkdir(outputDir, { recursive: true });
  const descriptors = [];
  for (const id of ['financeiro', 'mei']) {
    const source = path.join(root, 'src', 'plugins', id, 'index.jsx');
    await fs.access(source);
    const base = { format: 1, publisher: 'Organon', abi: 1, id, version, minHost, maxHostExclusive, entry: 'index.js' };
    // Validate inputs before compilation; placeholder is never written to output.
    validateManifest({ ...base, files: { 'index.js': { size: 1, sha256: '0'.repeat(64) } } });
    const result = await build({
      configFile: false, root, plugins: [hostPlugin()],
      oxc: { jsx: { runtime: 'automatic' } },
      build: {
        write: false, target: 'es2022', minify: true, sourcemap: false,
        lib: { entry: source, formats: ['es'], fileName: () => 'index.js', cssFileName: 'style' },
        cssCodeSplit: false,
        rolldownOptions: { output: { inlineDynamicImports: true, assetFileNames: 'style.css' } },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
    const files = {}, metadata = {};
    for (const output of outputs) {
      if (!['index.js', 'style.css'].includes(output.fileName) || files[output.fileName]) throw new Error(`Asset não suportado: ${output.fileName}`);
      const bytes = Buffer.from(output.type === 'chunk' ? output.code : output.source);
      files[output.fileName] = bytes.toString('base64'); metadata[output.fileName] = { size: bytes.length, sha256: hash(bytes) };
    }
    const manifest = validateManifest({ ...base, files: metadata });
    const bytes = Buffer.from(JSON.stringify({ manifest, files }));
    if (bytes.length > MAX_PACKAGE) throw new Error('Pacote acima do limite.');
    const descriptor = { id, version, size: bytes.length, sha256: hash(bytes) };
    validatePackage(bytes, descriptor, minHost);
    const filename = `organon-plugin-${id}-${version}.organon-plugin`;
    await fs.writeFile(path.join(outputDir, filename), bytes);
    await fs.writeFile(path.join(outputDir, `${filename}.sha256`), `${descriptor.sha256}  ${filename}\n`);
    descriptors.push({ ...descriptor, filename });
  }
  await fs.writeFile(path.join(outputDir, 'packages.json'), JSON.stringify({ format: 1, plugins: descriptors }, null, 2) + '\n');
  return descriptors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(name); if (i < 0 || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Informe ${name}.`); return args[i + 1]; };
  try {
    const packages = await buildPackages({ version: option('--version'), minHost: option('--min-host'), maxHostExclusive: option('--max-host-exclusive') });
    console.log(`Pacotes preparados separadamente: ${packages.map(p => p.filename).join(', ')}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

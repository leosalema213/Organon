import { build } from 'vite';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'public', 'spelling');
await fs.mkdir(output, { recursive: true });
await build({ configFile: false, publicDir: false, logLevel: 'warn', build: { ssr: true, target: 'node24', outDir: output, emptyOutDir: false, minify: true, rolldownOptions: { input: path.join(root, 'electron/spelling-worker.cjs'), output: { format: 'cjs', entryFileNames: 'worker.cjs' } } }, ssr: { noExternal: true, resolve: { mainFields: ['main'] } } });
for (const file of ['index.aff', 'index.dic', 'license']) await fs.copyFile(path.join(root, 'node_modules/dictionary-pt', file), path.join(output, file === 'license' ? 'dictionary-LICENSE.txt' : file));
await fs.copyFile(path.join(root, 'node_modules/hunspell-asm/LICENSE'), path.join(output, 'hunspell-LICENSE.txt'));
for (const file of ['hunspell-NOTICE.txt', 'hunspell-MPL.txt']) await fs.copyFile(path.join(root, 'docs/licenses', file), path.join(output, file));
const notices = [];
for (const file of ['getroot/LICENSE', 'getroot/node_modules/tslib/CopyrightNotice.txt', 'getroot/node_modules/tslib/LICENSE.txt', 'unixify/LICENSE', 'normalize-path/LICENSE', 'remove-trailing-separator/LICENSE', 'hunspell-asm/node_modules/nanoid/LICENSE']) {
  notices.push(`${file}\n${await fs.readFile(path.join(root, 'node_modules', file), 'utf8')}`);
}
notices.push('emscripten-wasm-loader 3.0.3 — MIT — OJ Kwon\nhttps://github.com/kwonoj/emscripten-wasm-loader');
await fs.writeFile(path.join(output, 'dependencies-LICENSES.txt'), notices.join('\n\n'));
console.log('Corretor e dicionário local de português preparados.');

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { localizeBoardFonts } = require('../scripts/board-fonts.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const mode of ['dev', 'prod']) test(`fontes ${mode}: o SDK instalado usa somente o fallback local`, () => {
  const directory = path.join(root, 'node_modules/@excalidraw/excalidraw/dist', mode);
  const matches = fs.readdirSync(directory).filter(name => name.endsWith('.js')).map(name => ({ id: path.join(directory, name), code: fs.readFileSync(path.join(directory, name), 'utf8') })).filter(({ code }) => code.includes('.ASSETS_FALLBACK_URL'));
  assert.equal(matches.length, 1, 'Mudança no SDK exige revisar a integração');
  const { id, code } = matches[0], result = localizeBoardFonts(code, id);
  assert(result); assert.equal(result.code.includes('.ASSETS_FALLBACK_URL'), false);
  assert.equal(result.code.split("new URL('./excalidraw/', document.baseURI)").length - 1, 1);
  assert.equal(fs.statSync(path.join(directory, 'fonts/Excalifont')).isDirectory(), true);
});

test('não transforma código de outros módulos e recusa formato de SDK desconhecido', () => {
  const code = 'new URL(asset, Fonts.ASSETS_FALLBACK_URL)';
  assert.equal(localizeBoardFonts(code, '/src/other.js'), null);
  assert.equal(localizeBoardFonts('const untouched = 1;', '/node_modules/@excalidraw/excalidraw/dist/prod/other.js'), null);
  assert.throws(() => localizeBoardFonts('Fonts.ASSETS_FALLBACK_URL;', '/node_modules/@excalidraw/excalidraw/dist/prod/fonts.js'), /fallback.*mudou/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { boardChange, boardScene, boardText, emptyBoard, mergeBoards, validBoard } from '../src/board-data.js';
import { newNotebook, newPage, seed, validateData } from '../src/model.js';
import { mergeSharedNotebook, notebookEqual } from '../src/shared-notebook-merge.js';
import { personalNotebookCopy } from '../src/shared-resources.js';
import { pendingImages, trackImageTask, waitForImages } from '../src/images.js';
const require = createRequire(import.meta.url);
const { extractResource, createLocalAdapters } = require('../electron/modules/teams.cjs');
const { packDocument, unpackDocument } = require('../electron/cloud-document.cjs');
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const shape = (id, changes = {}) => ({ id, type: 'rectangle', x: 0, y: 0, width: 80, height: 50, angle: 0, version: 1, versionNonce: 10, isDeleted: false, ...changes });
const scene = elements => boardScene(elements, {});
const notebook = board => ({ ...newNotebook(), name: 'Jogo', pages: [{ ...newPage('board'), board, text: boardText(board) }] });

test('páginas antigas preservam conteúdo e quadros novos passam pelo backup sem migração destrutiva', () => {
  const book = newNotebook(); book.name = 'Antigo'; book.pages[0].text = 'Preservado';
  const data = { ...seed(), notebooks: [book, notebook(emptyBoard())] };
  const restored = validateData(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(restored.notebooks, data.notebooks);
  assert.equal(restored.notebooks[0].pages[0].kind, undefined);
  assert.equal(validBoard(restored.notebooks[1].pages[0].board), true);
});

test('validação recusa tipos desconhecidos, geometria inválida, IDs repetidos, imagem externa e arquivo ausente', () => {
  const board = scene([shape('one')]); assert(validBoard(board));
  for (const change of [{ version: NaN }, { x: Infinity }, { id: '__proto__' }, { type: 'unknown' }]) assert.equal(validBoard(scene([shape('one', change)])), false);
  assert.equal(validBoard(scene([shape('one'), shape('one')])), false);
  assert.equal(validBoard(scene([shape('one', { type: 'image', status: 'saved', fileId: 'missing' })])), false);
  assert.equal(validBoard({ ...board, files: { external: { id: 'external', mimeType: 'image/png', created: 1, dataURL: 'https://example.org/private.png' } } }), false);
  const data = { ...seed(), notebooks: [notebook(board)] }; data.notebooks[0].pages[0].kind = 'unknown';
  assert.throws(() => validateData(data), /Quadro inválido/);
});

test('duas pessoas criam e movem objetos diferentes sem perder nenhuma alteração', () => {
  const before = notebook(scene([shape('a'), shape('b')]));
  const local = structuredClone(before), remote = structuredClone(before);
  local.pages[0].board = scene([shape('a', { x: 120, version: 2 }), shape('b'), shape('c')]);
  remote.pages[0].board = scene([shape('a'), shape('b', { y: 300, version: 2 }), shape('d')]);
  const result = mergeSharedNotebook(before, local, remote);
  assert.equal(result.pages[0].board.elements.length, 4);
  assert.equal(result.pages[0].board.elements.find(e => e.id === 'a').x, 120);
  assert.equal(result.pages[0].board.elements.find(e => e.id === 'b').y, 300);
  assert(notebookEqual(result, mergeSharedNotebook(before, remote, local)));
});

test('disputa no mesmo objeto converge por versão/nonce sem misturar geometria; repetição é idempotente', () => {
  const local = scene([shape('a', { x: 40, width: 140, version: 2, versionNonce: 8 })]);
  const remote = scene([shape('a', { x: 20, width: 200, version: 2, versionNonce: 3 })]);
  const merged = mergeBoards(local, remote);
  assert.deepEqual(merged.elements[0], remote.elements[0]);
  assert.deepEqual(mergeBoards(remote, local), merged);
  assert.deepEqual(mergeBoards(merged, remote), merged);
  const reordered = { ...remote, elements: [Object.fromEntries(Object.entries(remote.elements[0]).reverse())] };
  assert(notebookEqual(mergeBoards(local, reordered), merged));
});

test('excluir, importar/limpar e desfazer preservam tombstones e não ressuscitam versões antigas', () => {
  const original = scene([shape('a')]);
  const cleared = boardChange(original, [], {});
  assert.equal(cleared.elements[0].isDeleted, true);
  assert.equal(mergeBoards(cleared, original).elements[0].isDeleted, true);
  assert.deepEqual(boardChange(cleared, [], {}), cleared);
  const undo = scene([shape('a', { version: 3, versionNonce: 15 })]);
  assert.equal(mergeBoards(undo, cleared).elements[0].isDeleted, false);
});

test('texto pesquisável acompanha elementos e exclusão de página versus edição ainda exige escolha', () => {
  const before = notebook(emptyBoard()), local = structuredClone(before), remote = structuredClone(before);
  local.pages[0].board = scene([shape('a', { type: 'text', text: 'Missão da floresta' })]);
  remote.pages[0].board = scene([shape('b', { type: 'text', text: 'Inventário' })]);
  const result = mergeSharedNotebook(before, local, remote);
  assert.match(result.pages[0].text, /Missão da floresta/); assert.match(result.pages[0].text, /Inventário/);
  assert.throws(() => mergeSharedNotebook(before, { ...before, pages: [] }, remote), /versões diferentes/);
});

test('serialização de compartilhamento e cópia pessoal preservam cena e removem metadados do espaço', () => {
  const original = notebook(scene([shape('a')]));
  const copy = personalNotebookCopy({ ...original, orgId: 'shared', revision: 2 });
  assert.deepEqual(extractResource({ notebooks: [original] }, 'notebooks', original.id), original);
  assert.deepEqual(copy, original); copy.pages[0].board.elements[0].x = 99;
  assert.equal(original.pages[0].board.elements[0].x, 0);
});

test('imagens do quadro passam por assets privados e por sincronização pessoal com integridade', async () => {
  const file = { id: 'image-one', dataURL: image, mimeType: 'image/png', created: 1 };
  const board = boardScene([shape('picture', { type: 'image', fileId: file.id, status: 'saved' })], { [file.id]: file });
  assert(validBoard(board));
  const book = notebook(board), uploads = [];
  const adapters = createLocalAdapters({ cloud: { token: async () => 'private-main', request: async (url, options) => { uploads.push({ url, options }); } } });
  const packed = await adapters.prepareAssets({ orgId: crypto.randomUUID(), module: 'notebooks', resourceId: book.id, resource: book });
  assert.equal(packed.content.pages[0].board.files[file.id].dataURL.bucket, 'organon-shared');
  assert.equal(uploads.length, 1); assert.equal(uploads[0].options.headers['Content-Type'], 'image/png');
  const snapshot = { ...seed(), notebooks: [book] }, cloud = packDocument(snapshot);
  assert.equal(cloud.assets.size, 1);
  const restored = await unpackDocument(cloud.payload, async hash => cloud.assets.get(hash).bytes);
  assert.deepEqual(validateData(restored).notebooks, snapshot.notebooks);
});

test('câmera/seleção não entram na cena e arquivos removidos mantêm bytes para desfazer', () => {
  const file = { id: 'image-one', dataURL: image, mimeType: 'image/png', created: 1, lastRetrieved: 200 };
  const board = boardScene([shape('picture', { type: 'image', fileId: file.id, status: 'saved' })], { [file.id]: file, orphan: file });
  assert.deepEqual(Object.keys(board.files), [file.id]); assert.equal(board.files[file.id].lastRetrieved, undefined);
  assert.deepEqual(boardChange(board, [], {}).files, board.files);
  assert.deepEqual(Object.keys(board), ['version', 'elements', 'files']);
});

test('conversão de imagem do quadro participa da espera de backup/fechamento', async () => {
  const previous = globalThis.window, counts = [];
  globalThis.window = { desktop: { imagesPending: count => counts.push(count) }, dispatchEvent() {} };
  try {
    let finish;
    const task = trackImageTask(new Promise(resolve => { finish = resolve; }));
    assert.equal(pendingImages(), 1);
    let completed = false;
    const waiting = waitForImages().then(() => { completed = true; });
    await Promise.resolve(); assert.equal(completed, false);
    finish(); await task; await waiting;
    assert.equal(pendingImages(), 0); assert.deepEqual(counts, [1, 0]);
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { notebookLibrary, personalNotebookCopy, resourceShares, shareChanges, removeResourceShares } from '../src/shared-resources.js';
import { newNotebook, seed, validateData } from '../src/model.js';
import { mergeSharedNotebook, notebookEqual } from '../src/shared-notebook-merge.js';

const space = { id: 'team', owner_id: 'owner' };
const row = (module, id, author = 'owner', hash) => ({ module, resource_id: id, published_by: author, revision: 2, content: { hash } });
test('edição por pessoa afeta somente a seleção, preserva leitura e permite repetir só falhas', () => {
  for (const module of ['books', 'notebooks']) {
    const member = { user_id: 'one', selected: true, write: false };
    const entries = new Map([['team', { rows: [row(module, 'a'), row(module, 'b')], audiences: { a: { members: [member] }, b: { members: [member] } } }]]);
    const writes = { team: { one: true } };
    const changes = shareChanges([space], entries, [{ id: 'a' }], {}, module, 'owner', {}, writes);
    assert.deepEqual(changes.map(change => change.resource.id), ['a']);
    assert.deepEqual(changes[0].recipientWrites, { one: true });
    entries.get('team').audiences.a.members = [{ ...member, write: true }];
    assert.deepEqual(shareChanges([space], entries, [{ id: 'a' }, { id: 'b' }], {}, module, 'owner', {}, writes).map(change => change.resource.id), ['b']);
    assert.deepEqual(shareChanges([space], entries, [{ id: 'a' }], {}, module, 'owner', {}, { team: { one: false } })[0].recipientWrites, { one: false });
    assert.deepEqual(shareChanges([space], entries, [{ id: 'b' }], {}, module, 'owner', { team: [] }, writes)[0].recipientIds, []);
  }
});
test('edição simultânea combina páginas e campos independentes e preserva conflitos', () => {
  const base = { id: 'n', name: 'Caderno', pages: [{ id: 'p', title: 'Antes', text: 'Original' }] };
  const local = structuredClone(base), remote = structuredClone(base);
  local.pages[0].title = 'Meu título'; remote.pages[0].text = 'Outra pessoa';
  assert.deepEqual(mergeSharedNotebook(base, local, remote).pages[0], { id: 'p', title: 'Meu título', text: 'Outra pessoa' });
  remote.pages.push({ id: 'new', title: 'Nova' }); local.pages.push({ id: 'mine', title: 'Minha' });
  assert.deepEqual(mergeSharedNotebook(base, local, remote).pages.map(page => page.id), ['p', 'new', 'mine']);
  remote.pages[0].title = 'Título concorrente';
  assert.throws(() => mergeSharedNotebook(base, local, remote), /rascunho foi preservado/);
  assert.equal(local.pages[0].title, 'Meu título');
  assert.throws(() => mergeSharedNotebook(base, { ...base, pages: [] }, remote), /rascunho/);
});
test('JSONB reordenado não cria conflito de documento durante digitação', () => {
  const doc = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const base = { id: 'n', pages: [{ id: 'p', text: 'Antes', images: [], document: doc('Antes') }] };
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).reverse().map(key => [key, reorder(value[key])])) : value;
  const remote = reorder(base), local = structuredClone(base);
  local.pages[0].document = doc('Antes e depois'); local.pages[0].text = 'Antes e depois';
  assert(notebookEqual(base, remote));
  assert.deepEqual(mergeSharedNotebook(base, local, remote), local);
  assert(!notebookEqual([1, 2], [2, 1]));
});

test('mescla trechos independentes no mesmo parágrafo e recalcula texto derivado', () => {
  const doc = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const base = { id: 'n', pages: [{ id: 'p', text: 'Um meio fim', images: [], document: doc('Um meio fim') }] };
  const local = structuredClone(base), remote = structuredClone(base);
  local.pages[0].document = doc('Novo meio fim'); local.pages[0].text = 'Novo meio fim';
  remote.pages[0].document = doc('Um meio final'); remote.pages[0].text = 'Um meio final';
  const merged = mergeSharedNotebook(base, local, remote);
  assert.equal(merged.pages[0].text, 'Novo meio final');
  assert.equal(merged.pages[0].document.content[0].content[0].text, merged.pages[0].text);
  assert.deepEqual(merged.pages[0].images, []);
});

test('conflito real permite escolher por trecho sem perder mudanças independentes', () => {
  const base = { id: 'n', name: 'Caderno', pages: [{ id: 'p', title: 'Original', text: 'Antes' }] };
  const local = structuredClone(base), remote = structuredClone(base);
  local.pages[0].title = 'Minha versão'; remote.pages[0].title = 'Versão remota'; remote.name = 'Renomeado';
  let conflict;
  try { mergeSharedNotebook(base, local, remote); } catch (error) { conflict = error.conflicts[0]; }
  assert.deepEqual([conflict.local, conflict.remote], ['Minha versão', 'Versão remota']);
  const merged = mergeSharedNotebook(base, local, remote, { [conflict.key]: 'local' });
  assert.equal(merged.pages[0].title, 'Minha versão'); assert.equal(merged.name, 'Renomeado');
  assert.equal(mergeSharedNotebook(base, local, remote, { [conflict.key]: 'remote' }).pages[0].title, 'Versão remota');
  const deleted = { ...base, pages: [] };
  let deletion;
  try { mergeSharedNotebook(base, deleted, remote); } catch (error) { deletion = error.conflicts[0]; }
  assert.deepEqual(mergeSharedNotebook(base, deleted, remote, { [deletion.key]: 'local' }).pages, []);
});

test('mescla páginas legadas com documento e mantém imagens e formatação', () => {
  const image = 'data:image/png;base64,YQ==';
  const base = { id: 'n', pages: [{ id: 'p', title: '', text: 'Um meio fim', images: [image] }] };
  const local = structuredClone(base), remote = structuredClone(base);
  local.pages[0].text = 'Novo meio fim';
  remote.pages[0] = { ...remote.pages[0], text: 'Um meio final', images: [], document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Um meio final', marks: [{ type: 'bold' }] }] }, { type: 'image', attrs: { src: image } }, { type: 'paragraph' }] } };
  const merged = mergeSharedNotebook(base, local, remote).pages[0];
  assert.equal(merged.text, 'Novo meio final');
  assert.deepEqual(merged.document.content[0].content[0].marks, [{ type: 'bold' }]);
  assert.equal(merged.document.content[1].attrs.src, image);
});

test('deduplica livros por arquivo e cadernos por identidade, com autoria legada', () => {
  const rows = [row('books', 'b', 'owner', 'file'), row('books', 'c', 'guest', 'file'), row('notebooks', 'n')];
  assert.deepEqual(resourceShares(rows, 'books', { id: 'a', hash: 'file' }, 'owner'), { own: [rows[0]], other: true });
  assert.deepEqual(resourceShares(rows, 'notebooks', { id: 'n' }, 'guest'), { own: [], other: true });
  const legacy = { ...rows[2], published_by: null };
  assert.equal(resourceShares([legacy], 'notebooks', { id: 'n' }, 'owner', space.owner_id).own.length, 1);
});
test('lote calcula somente pendências e nunca retira publicações de outra pessoa', () => {
  const resources = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const entries = new Map([['team', { rows: [row('notebooks', 'a'), row('notebooks', 'c', 'guest')] }]]);
  const changes = shareChanges([space], entries, resources, { team: true }, 'notebooks', 'owner');
  assert.deepEqual(changes.map(item => item.resource.id), ['b']);
  entries.get('team').rows.push(row('notebooks', 'b'));
  assert.deepEqual(shareChanges([space], entries, resources, { team: true }, 'notebooks', 'owner'), []);
  assert.deepEqual(shareChanges([space], entries, resources, { team: false }, 'notebooks', 'owner').map(item => item.resource.id), ['a', 'b']);
  entries.get('team').error = true;
  assert.deepEqual(shareChanges([space], entries, resources, { team: false }, 'notebooks', 'owner'), []);
});
test('remoção usa a revisão atual e preserva falhas para nova tentativa', async () => {
  const calls = [];
  const api = { call: async (_module, _action, payload) => { calls.push(payload); if (payload.resourceId === 'b') throw new Error('conflito'); } };
  await assert.rejects(removeResourceShares(api, 'team', 'notebooks', [row('notebooks', 'a'), row('notebooks', 'b')]), /conflito/);
  assert.deepEqual(calls.map(item => [item.resourceId, item.revision]), [['a', 2], ['b', 2]]);
  await removeResourceShares(api, 'team', 'notebooks', [row('notebooks', 'b')], () => false);
  assert.equal(calls.length, 2);
});

test('destinatários alteram cópias existentes e preservam proprietário e outras publicações', () => {
  const members = [{ user_id: 'one', selected: true }, { user_id: 'two', selected: false }, { user_id: 'admin', fixed: true, selected: true }];
  for (const module of ['books', 'notebooks']) {
    const entry = { rows: [row(module, 'a')], audiences: { a: { members } } };
    const entries = new Map([['team', entry]]);
    assert.deepEqual(shareChanges([space], entries, [{ id: 'a' }], {}, module, 'owner', { team: ['one'] }), []);
    const changes = shareChanges([space], entries, [{ id: 'a' }], {}, module, 'owner', { team: ['two'] });
    assert.deepEqual(changes[0].recipientIds, ['two', 'admin']);
    assert.equal(changes[0].own[0].revision, 2);
    assert.deepEqual(shareChanges([space], entries, [{ id: 'a' }], {}, module, 'guest', { team: null }), []);
    assert.deepEqual(shareChanges([space], entries, [{ id: 'a' }], {}, module, 'owner', { team: null })[0].recipientIds, ['one', 'two', 'admin']);
    assert.equal(shareChanges([space], entries, [{ id: 'a' }], { team: false }, module, 'owner', { team: null })[0].publish, false);
  }
});
test('cópia pessoal mantém páginas e imagens, elimina vínculo e aparece uma vez', () => {
  const notebook = { ...newNotebook(), name: 'Recebido' };
  const first = { ...notebook, orgId: 'one', publishedBy: 'guest', revision: 1 };
  const second = { ...notebook, orgId: 'two', revision: 2 };
  assert.equal(notebookLibrary([], [first, second]).length, 1);
  const copy = personalNotebookCopy(first);
  assert.equal(copy.orgId, undefined);
  assert.equal(copy.revision, undefined);
  assert.equal(copy.id, notebook.id);
  assert.deepEqual(validateData({ ...seed(), notebooks: [copy] }).notebooks, [notebook]);
  copy.pages[0].title = 'Minha edição';
  assert.equal(notebook.pages[0].title, '');
  const merged = notebookLibrary([copy], [first, second]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].notebook, copy);
  assert.deepEqual([...merged[0].orgIds], ['one', 'two']);
  assert.equal(notebookLibrary([copy], [])[0].notebook.pages[0].title, 'Minha edição');
  assert.deepEqual(notebookLibrary([], []), []);
});

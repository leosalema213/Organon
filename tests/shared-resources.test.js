import test from 'node:test';
import assert from 'node:assert/strict';
import { notebookLibrary, personalNotebookCopy, resourceShares, shareChanges, removeResourceShares } from '../src/shared-resources.js';
import { newNotebook, seed, validateData } from '../src/model.js';

const space = { id: 'team', owner_id: 'owner' };
const row = (module, id, author = 'owner', hash) => ({ module, resource_id: id, published_by: author, revision: 2, content: { hash } });
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

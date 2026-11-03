import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { matchesCard, ordered, editorContent, ICON_NAMES } from '../src/kanban/model.js';
const require = createRequire(import.meta.url);
const { createService, validate, imageBytes, price } = require('../electron/modules/kanban.cjs');
const orgId = '00000000-0000-4000-8000-000000000001', boardId = '00000000-0000-4000-8000-000000000002', cardId = '00000000-0000-4000-8000-000000000003', listId = '00000000-0000-4000-8000-000000000004', tagId = '00000000-0000-4000-8000-000000000005';
const card = { orgId, boardId, id: cardId, expectedRevision: 7, listId, title: 'Cartão sintético 🧪', description: '<p>Descrição original</p>', price: '0', thumbnail_url: null, tagIds: [tagId] };
function transport() {
  const calls = [];
  const cloud = { ready: Promise.resolve(), enabled: true, token: async () => 'synthetic-session', request: async (path, options) => { calls.push({ path, options }); return { id: cardId, revision: 8 }; } };
  return { cloud, calls };
}
test('IPC rejeita ações arbitrárias e campos de revisão/identidade inválidos antes do transporte', async () => {
  const { cloud, calls } = transport(), service = createService({ cloud });
  await assert.rejects(service.dispatch('request', { orgId, path: '/rest/v1/secrets' }), /não permitida/);
  await assert.rejects(service.dispatch('saveCard', { ...card, expectedRevision: 0 }), /Recarregue/);
  await assert.rejects(service.dispatch('deleteCard', { orgId, boardId }), /obrigatório/);
  await assert.rejects(service.dispatch('getBoard', { orgId, boardId: 'eq.secret&select=*' }), /inválido/);
  assert.equal(calls.length, 0);
});
test('salvamento envia cartão e vínculos na mesma RPC e ignora autor/role/tabela fornecidos pelo renderer', async () => {
  const { cloud, calls } = transport(), events = [], service = createService({ cloud, emit: event => events.push(event) });
  await service.dispatch('saveCard', { ...card, created_by: 'attacker', role: 'owner', table: 'organizations' });
  assert.equal(calls.length, 1); assert.equal(calls[0].path, '/rest/v1/rpc/organon_kanban');
  const body = calls[0].options.body;
  assert.equal(body.p_payload.description, card.description); assert.equal(body.p_payload.price, '0');
  assert.deepEqual(body.p_payload.tagIds, [tagId]); assert.equal(body.p_payload.expectedRevision, 7);
  assert.equal(body.p_payload.created_by, undefined); assert.equal(body.p_payload.role, undefined); assert.equal(body.p_payload.table, undefined);
  assert.equal(events.length, 1); assert.equal(events[0].orgId, orgId);
});
test('conflito do servidor não produz evento de sucesso nem tentativa de sobrescrita', async () => {
  const { cloud, calls } = transport(); let events = 0;
  cloud.request = async () => { calls.push('attempt'); throw Object.assign(new Error('Conflict'), { code: 'PT409' }); };
  await assert.rejects(createService({ cloud, emit: () => events++ }).dispatch('saveCard', card), error => error.code === 'CONFLICT');
  assert.equal(calls.length, 1); assert.equal(events, 0);
});
test('catálogo de marcadores e criação global não exigem um primeiro quadro', async () => {
  const { cloud, calls } = transport(), service = createService({ cloud });
  await service.dispatch('getTags', { orgId });
  await service.dispatch('saveTag', { orgId, name: 'Sintético', color: '#123456', icon: 'Tag' });
  assert.equal(calls.length, 2); assert.equal(calls[0].options.body.p_action, 'getTags');
  assert.equal(calls[1].options.body.p_payload.boardId, undefined);
});
test('desabilitado/sem sessão não escreve; preço usa decimal textual e preserva zero', async () => {
  const { cloud, calls } = transport(); cloud.enabled = false;
  await assert.rejects(createService({ cloud }).dispatch('saveCard', card), /desabilitada/);
  assert.equal(calls.length, 0); cloud.enabled = true; cloud.token = async () => { throw new Error('Entre'); };
  await assert.rejects(createService({ cloud }).dispatch('saveCard', card), /Entre/); assert.equal(calls.length, 0);
  assert.equal(price('123,45'), '123.45'); assert.equal(price(0), '0'); assert.equal(price(''), null);
  assert.throws(() => price('1.005')); assert.throws(() => price('1e4'));
});
test('referências de assets não cruzam quadro; URLs legadas nunca viram fetch arbitrário', async () => {
  const { cloud, calls } = transport(); cloud.request = async (path, options) => { calls.push({ path, options }); return [{ id: boardId }]; };
  const service = createService({ cloud });
  await assert.rejects(service.dispatch('getAsset', { orgId, boardId, reference: `${orgId}/${cardId}/${cardId}.png` }), /inválida/);
  assert.equal(calls.length, 0);
  const result = await service.dispatch('getAsset', { orgId, boardId, reference: 'https://legacy.example/image.png' });
  assert.deepEqual(result, { data: null, legacy: true }); assert.equal(calls.length, 1); assert.ok(calls[0].path.startsWith('/rest/v1/kanban_boards?'));
  assert.throws(() => imageBytes('data:image/png;base64,YWJj'), /corresponde/);
  assert.throws(() => imageBytes('data:image/svg+xml;base64,PHN2Zz4='), /PNG/);
});
test('upload autoriza quadro e envia bytes apenas para bucket privado com nome imutável', async () => {
  const { cloud, calls } = transport(); cloud.request = async (path, options) => { calls.push({ path, options }); return path.startsWith('/rest/') ? [{ id: boardId }] : {}; };
  // Header-only synthetic bytes: exercises signature/transport, not an image decoder.
  const result = await createService({ cloud }).dispatch('uploadAsset', { orgId, boardId, kind: 'thumbnail', data: 'data:image/png;base64,iVBORw0KGgo=' });
  assert.match(result.reference, new RegExp(`^${orgId}/${boardId}/.+\\.png$`));
  assert.equal(calls.length, 2); assert.equal(calls[1].options.headers['x-upsert'], 'false'); assert.ok(Buffer.isBuffer(calls[1].options.body));
  cloud.request = async () => [];
  await assert.rejects(createService({ cloud }).dispatch('getAsset', { orgId, boardId, reference: result.reference }), /permissão/);
});
test('busca combina texto com OU entre marcadores e mantém texto/emoji/ordem legados', () => {
  const item = { id: cardId, title: 'Revisão 🧪', description: '<p>Descrição original</p>' }, links = [{ card_id: cardId, tag_id: tagId }];
  assert.equal(matchesCard(item, 'DESCRIÇÃO', [tagId, 'other'], links), true);
  assert.equal(matchesCard(item, 'Revisão', ['other'], links), false);
  assert.equal(matchesCard(item, 'ausente', [tagId], links), false);
  assert.equal(editorContent('A < B\n🧪'), '<p>A &lt; B<br>🧪</p>');
  assert.equal(editorContent(item.description), item.description);
  assert.deepEqual(ordered([{ id: 'b', position: 2 }, { id: 'a', position: 0 }]).map(row => row.id), ['a','b']);
  assert.equal(ICON_NAMES.length, 47);
  assert.deepEqual(validate('saveCard', { ...card, tagIds: [tagId, tagId] }).tagIds, [tagId]);
});

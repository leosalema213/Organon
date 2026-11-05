import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { decimal, sumMoney, formatMoney, totals, filterEntries, moveDate, normalizeCategoryName } from '../src/plugins/financeiro/model.js';
const require = createRequire(import.meta.url);
const { createService, commandPayload } = require('../electron/modules/financeiro.cjs');
const orgId = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const typeId = '33333333-3333-4333-8333-333333333333';
const requestId = '44444444-4444-4444-8444-444444444444';
const entry = { id, typeId, description: 'Exemplo sintético', entryType: 'entrada', value: '0.10', entryDate: '2024-01-31', countForMei: true, revision: 2 };

test('dinheiro decimal exato, inclusive grandes valores e escala legada', () => {
  assert.equal(sumMoney(['0.1', '0.2']), '0.3');
  assert.equal(sumMoney(['9007199254740993.99', '0.01']), '9007199254740994');
  assert.equal(sumMoney(['-1.005', '0.004']), '-1.001');
  assert.equal(formatMoney('9007199254740993.005'), 'R$ 9.007.199.254.740.993,005');
  assert.equal(decimal('-00,00'), '0');
  for (const invalid of [0.1, '', '1.234,56', '1e3', 'NaN', 'Infinity']) assert.throws(() => decimal(invalid));
});
test('entradas e saldo separam os valores confirmados dos projetados', () => {
  const confirmados = [entry, { ...entry, countForMei: false, value: '0.2' }, { ...entry, entryType: 'gasto', value: '0.15' }];
  assert.equal(totals(confirmados).comProjecao, null);
  assert.deepEqual(totals([
    ...confirmados,
    { ...entry, entryType: 'projetado', value: '99.999' },
    { ...entry, entryType: 'projetado', value: '0.002' },
  ]), {
    entrada: '0.3', gasto: '0.15', saldo: '0.15', projetado: '100.001',
    comProjecao: { entrada: '100.301', saldo: '100.151' },
  });
});
test('filtros combinados, datas históricas e duplicação em fevereiro', () => {
  const entries = [entry, { ...entry, id: typeId, entryType: 'gasto', entryDate: '2024-02-01' }];
  assert.equal(filterEntries(entries, { mode: 'month', month: '2024-01', nature: 'entrada', category: typeId }).length, 1);
  assert.equal(filterEntries(entries, { mode: 'day', day: '2024-02-01', nature: 'all', category: 'all' })[0].entryType, 'gasto');
  assert.equal(filterEntries(entries, { mode: 'all', nature: 'all', category: 'all' }).length, 2);
  assert.equal(moveDate('2024-01-31', '2024-02'), '2024-02-29');
  assert.equal(moveDate('2024-01-31', '2025-02'), '2025-02-28');
  assert.equal(moveDate('2024-01-31', '0004-02'), '0004-02-29');
});
test('categoria normaliza unicode, caixa e espaços; não funde sinônimos', () => {
  assert.equal(normalizeCategoryName('  Ｃafé\t DA  MANHÃ '), normalizeCategoryName('café da manhã'));
  assert.notEqual(normalizeCategoryName('Café'), normalizeCategoryName('Alimentação'));
});
test('payload remove autoria forjada, exige revisão, rejeita data inválida', () => {
  const body = commandPayload('createEntry', { ...entry, requestId, createdBy: orgId, sourceCreatedBy: orgId });
  assert.equal(body.value, '0.10');
  assert.equal(body.countForMei, true);
  assert.equal(body.createdBy, undefined);
  assert.equal(body.sourceCreatedBy, undefined);
  assert.throws(() => commandPayload('updateEntry', entry));
  assert.throws(() => commandPayload('createEntry', { ...entry, requestId, entryDate: '2025-02-29' }));
  assert.throws(() => commandPayload('createEntry', { ...entry, requestId, value: 0.1 }));
  assert.equal(commandPayload('createEntry', { ...entry, requestId, value: '1.001' }).value, '1.001');
});
test('duplicação usa IDs/revisões, sem copiar dinheiro ou autoria do renderer', () => {
  const body = commandPayload('duplicateEntries', { entries: [{ ...entry, expectedRevision: 2 }], targetMonth: '2024-02', requestId });
  assert.deepEqual(body.entries, [{ id, expectedRevision: 2 }]);
  assert.throws(() => commandPayload('duplicateEntries', { ...body, entries: [...body.entries, ...body.entries] }));
});
test('serviço permite somente RPCs fixas autenticadas e não envia SQL nem tokens ao resultado', async () => {
  const calls = [], events = [];
  const cloud = { enabled: true, ready: Promise.resolve(), token: async () => 'token-sintetico', request: async (path, options) => { calls.push({ path, options }); return path.endsWith('financeiro_snapshot') ? { entries: [entry], types: [] } : { ok: true }; } };
  const service = createService({ cloud, emit: e => events.push(e) });
  const result = await service.dispatch('snapshot', { orgId });
  assert.equal(result.entries[0].value, '0.10');
  assert.equal(calls[0].options.token, 'token-sintetico');
  assert.deepEqual(calls[0].options.body, { p_org_id: orgId });
  await service.dispatch('deleteEntry', { orgId, id, expectedRevision: 2, createdBy: typeId });
  assert.equal(calls[1].path, '/rest/v1/rpc/financeiro_mutate');
  assert.deepEqual(calls[1].options.body.p_payload, { id, expectedRevision: 2 });
  assert.equal(events[0].orgId, orgId);
  await assert.rejects(service.dispatch('/rest/v1/users', { orgId }));
  await assert.rejects(service.dispatch('snapshot', { orgId: '../users' }));
  assert.equal(calls.length, 2);
});
test('conflito não publica sucesso e snapshot numérico com perda é recusado', async () => {
  let emitted = false;
  const cloud = { enabled: true, ready: Promise.resolve(), token: async () => 'synthetic', request: async () => ({ conflict: true }) };
  const service = createService({ cloud, emit: () => { emitted = true; } });
  await assert.rejects(service.dispatch('deleteEntry', { orgId, id, expectedRevision: 2 }), /outra pessoa/);
  assert.equal(emitted, false);
  cloud.request = async () => ({ entries: [{ ...entry, value: 0.1 }], types: [] });
  await assert.rejects(service.dispatch('snapshot', { orgId }), /decimal/);
  cloud.enabled = false;
  await assert.rejects(service.dispatch('snapshot', { orgId }), /indisponível/);
});

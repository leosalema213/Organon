import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { cents, decimal, report, exportReport, entryBody, createService } = require('../electron/modules/mei.cjs');

// Synthetic IDs/amounts only. These limits are arithmetic examples, never legal advice.
const owner = '00000000-0000-4000-8000-000000000001';
const org = '00000000-0000-4000-8000-000000000002';
const category = '00000000-0000-4000-8000-000000000003';
const id = '00000000-0000-4000-8000-000000000004';
const entry = (overrides = {}) => ({ id, description: 'Sintético', value: '0.10', entryType: 'entrada', countForMei: true,
  entryDate: '2026-01-02', createdAt: '2026-01-02T12:00:00Z', typeId: category, ...overrides });
const settings = [{ id: 'limit-a', year: 2026, meiLimit: '10.00' }, { id: 'limit-b', year: 2025, meiLimit: '3.00' }];
const samples = [entry(), entry({ id: 'b', value: '0.20', description: 'Segundo' }),
  entry({ id: 'c', value: '0.30', entryType: 'projetado', countForMei: false }),
  entry({ id: 'd', value: '0.60', entryType: 'projetado', entryDate: '2026-02-10' }),
  entry({ id: 'e', value: '99.00', countForMei: false }), entry({ id: 'f', value: '99.00', entryType: 'gasto' }),
  entry({ id: 'g', value: '1.00', entryDate: '2025-01-01' })];

test('decimal arithmetic preserves cents, signs, comma input and arbitrarily large sums', () => {
  assert.equal(decimal(cents('0.10') + cents('0.20')), '0.30');
  assert.equal(decimal(cents('-1,01')), '-1.01');
  assert.equal(decimal(cents('9007199254740993.99') + cents('0.01')), '9007199254740994.00');
  for (const invalid of ['1.001', '1e3', '', 'R$ 10', NaN, Infinity]) assert.throws(() => cents(invalid));
});
test('recebido/projected/year total/remaining use source inclusion rules', () => {
  const r = report(samples, settings, 2026);
  assert.equal(r.recebido, '0.30'); assert.equal(r.projetado, '0.90'); assert.equal(r.totalAno, '1.20'); assert.equal(r.restante, '8.80');
  assert.equal(r.entries.length, 4); assert.equal(r.settings.id, 'limit-a');
});
test('null or missing countForMei includes receipts; false excludes only receipts', () => {
  const r = report([entry({ countForMei: null }), entry({ countForMei: undefined }), entry({ countForMei: false }), entry({ entryType: 'projetado', countForMei: false })], settings, 2026);
  assert.equal(r.recebido, '0.20'); assert.equal(r.projetado, '0.10');
});
test('month filter limits grouped rows but leaves annual cards and summary unchanged', () => {
  const all = report(samples, settings, 2026), january = report(samples, settings, 2026, '1');
  assert.equal(january.totalAno, all.totalAno); assert.deepEqual(january.monthly, all.monthly);
  assert.equal(january.groups.length, 2); assert.equal(january.groups[0].value, '0.30');
  assert.equal(january.groups[0].description, 'Sintético, Segundo'); assert.equal(january.groups[0].items.length, 2);
  assert.equal(january.groups[1].entryType, 'projetado');
});
test('monthly groups contain only populated months and preserve same-month creation ordering', () => {
  const r = report([entry({ description: 'Tarde', createdAt: '2026-01-03' }), entry({ description: 'Cedo', createdAt: '2026-01-01' })], settings, 2026);
  assert.equal(r.groups[0].description, 'Cedo, Tarde'); assert.equal(r.monthly.length, 1);
  assert.deepEqual(r.monthly[0], { month: 1, label: 'Janeiro', count: 2, recebido: '0.20', projetado: '0.00', total: '0.20' });
});
test('projected mean divides by positive projected MONTHS, not entry count', () => {
  const r = report([entry({ entryType: 'projetado', value: '1.00' }), entry({ entryType: 'projetado', value: '2.00' }), entry({ entryType: 'projetado', value: '6.00', entryDate: '2026-02-01' })], settings, 2026);
  assert.equal(r.projectedMonths, 2); assert.equal(r.mediaProjetada, '4.50');
  assert.equal(report([], settings, 2026).mediaProjetada, '0.00');
});
test('zero/negative projected months do not enter denominator; presentation rounds exact rational', () => {
  const r = report([entry({ entryType: 'projetado', value: '0.01' }), entry({ entryType: 'projetado', value: '0.02', entryDate: '2026-02-01' }), entry({ entryType: 'projetado', value: '-0.02', entryDate: '2026-03-01' })], settings, 2026);
  assert.equal(r.projectedMonths, 2); assert.equal(r.projetado, '0.01'); assert.equal(r.mediaProjetada, '0.01');
  assert.equal(report([entry({ entryType: 'projetado', value: '-1.00' })], settings, 2026).mediaProjetada, '0.00');
});
test('annual configurations remain distinct and missing year has no invented ceiling', () => {
  const previous = report(samples, settings, 2025); assert.equal(previous.restante, '2.00');
  const missing = report(samples, settings, 2027); assert.equal(missing.settings, null); assert.equal(missing.restante, null);
  assert.equal(report([entry({ value: '11.00' })], settings, 2026).restante, '-1.00');
  assert.throws(() => report([], [], 2000)); assert.throws(() => report([], [], 2026, 13));
});
test('legacy entryDate null falls back to createdAt, avoiding timezone year shifts', () => {
  const r = report([entry({ entryDate: null, createdAt: '2025-12-31T23:59:59-03:00' })], settings, 2025);
  assert.equal(r.recebido, '0.10'); assert.equal(r.monthly[0].month, 12);
});
test('JSON all means selected year; monthly exports raw items with settings, never grouped rows', () => {
  const data = report(samples, settings, 2026, 1);
  const file = exportReport(data, { mode: 'monthly', now: '2026-01-01T00:00:00Z' });
  const json = JSON.parse(file.content); assert.equal(json.entries.length, 3); assert.equal(json.settings.id, 'limit-a');
  assert.equal(json.entries[0].value, '0.10'); assert.equal(json.mode, 'monthly'); assert.equal(file.filename, 'relatorio-mei-2026-1.json');
  assert.equal(JSON.parse(exportReport(data).content).entries.length, 4);
  assert.throws(() => exportReport(report(samples, settings, 2026), { mode: 'monthly' }));
});
test('CSV preserves original columns, decimal values and quoted descriptions', () => {
  const data = report([entry({ description: 'Texto; "aspas"\nlinha' })], settings, 2026, 1);
  assert.equal(exportReport(data, { format: 'csv' }).content, 'ano;mes;tipo;descricao;valor\n2026;Janeiro;entrada;"Texto; ""aspas""\nlinha";0.10');
});
test('editing preserves date/category/mark and cannot set server-owned fields', () => {
  const body = entryBody({ ...entry(), countForMei: false, owner_id: 'attacker', org_id: 'attacker', created_by: 'attacker', revision: 900 });
  assert.equal(body.countForMei, false); assert.equal(body.typeId, category); assert.equal(body.entryDate, '2026-01-02');
  assert.ok(!Object.hasOwn(body, 'org_id')); assert.ok(!Object.hasOwn(body, 'revision'));
  assert.equal(report([{ ...entry(), countForMei: body.countForMei }], settings, 2026).entries.length, 0);
  assert.throws(() => entryBody({ ...entry(), entryDate: '2026-02-30' }));
  assert.throws(() => entryBody({ ...entry(), entryType: 'gasto' }));
  assert.equal(entryBody(entry({ description: '  Texto original  ' })).description, '  Texto original  ');
});

function mockCloud({ owned = true, entries = [entry({ revision: 1 })], conflict = false, disabled = false, denied = false } = {}) {
  const calls = [], events = [];
  const cloud = { ready: Promise.resolve(), enabled: !disabled, token: async () => 'synthetic-token', request: async (path, options) => {
    calls.push({ path, options }); const url = new URL(`https://synthetic.invalid${path}`);
    if (path === '/auth/v1/user') return { id: owner };
    if (url.pathname.endsWith('/organizations')) return owned ? [{ id: org }] : [];
    if (url.pathname.endsWith('/rpc/mei_snapshot')) return { entries, settings: [], types: [{ id: category, name: 'Categoria', orgId: org }] };
    if (url.pathname.endsWith('/rpc/mei_mutate')) {
      if (denied) throw new Error('Este lançamento não está no MEI.');
      if (conflict) return { conflict: true };
      return { ok: true, entry: entry({ ...options.body.p_payload, revision: 2 }), settings: { id, orgId: org, ownerId: owner, ...options.body.p_payload, revision: 2 } };
    }
    throw new Error(`Unexpected synthetic request ${path}`);
  } };
  return { service: createService({ cloud, emit: event => events.push(event) }), calls, events };
}
test('service denies team member before touching MEI/private tables', async () => {
  const { service, calls } = mockCloud({ owned: false });
  await assert.rejects(service.dispatch('load', { orgId: org, year: 2026, ownerId: owner }), /proprietário/);
  assert.equal(calls.length, 2);
});
test('service rejects disabled cloud and arbitrary actions/identifiers', async () => {
  await assert.rejects(mockCloud({ disabled: true }).service.dispatch('load', { orgId: org, year: 2026 }), /Conecte/);
  await assert.rejects(mockCloud().service.dispatch('sql', {}), /desconhecida/);
  await assert.rejects(mockCloud().service.dispatch('load', { orgId: 'x&select=*', year: 2026 }), /Identificador/);
});
test('load uses a single owner-only snapshot RPC with exact text money', async () => {
  const { service, calls } = mockCloud(); const result = await service.dispatch('load', { orgId: org, year: 2026 });
  assert.equal(result.recebido, '0.10'); assert.equal(result.types[0].name, 'Categoria');
  const snapshot = calls.find(c => c.path.endsWith('/rpc/mei_snapshot'));
  assert.deepEqual(snapshot.options.body, { p_org_id: org }); assert.equal(snapshot.options.method, 'POST');
  assert.equal(calls.length, 3);
});
test('entry update uses atomic expected revision and notifies MEI and financeiro', async () => {
  const { service, calls, events } = mockCloud();
  const saved = await service.dispatch('updateEntry', { ...entry(), orgId: org, expectedRevision: 1, value: '0.20' });
  const mutation = calls.find(c => c.path.endsWith('/rpc/mei_mutate'));
  assert.equal(mutation.options.body.p_payload.expectedRevision, 1); assert.equal(mutation.options.body.p_org_id, org);
  assert.equal(mutation.options.body.p_payload.value, '0.20'); assert.equal(saved.revision, 2);
  assert.deepEqual(events.map(e => e.module), ['mei', 'financeiro']);
});
test('conflict never silently overwrites or emits successful change', async () => {
  const { service, events } = mockCloud({ conflict: true });
  await assert.rejects(service.dispatch('updateEntry', { ...entry(), orgId: org, expectedRevision: 1 }), /registro mudou/);
  assert.equal(events.length, 0);
  await assert.rejects(service.dispatch('deleteEntry', { id, orgId: org }), /Recarregue/);
});
test('server denial of a forged/excluded entry is propagated and emits no changes', async () => {
  const { service, calls, events } = mockCloud({ denied: true });
  await assert.rejects(service.dispatch('updateEntry', { ...entry(), orgId: org, expectedRevision: 1 }), /não está no MEI/);
  assert.equal(events.length, 0); assert.equal(calls.at(-1).path, '/rest/v1/rpc/mei_mutate');
});
test('settings creation binds authenticated owner and no implicit upsert overwrites annual config', async () => {
  const { service, calls, events } = mockCloud();
  await service.dispatch('saveSettings', { orgId: org, year: 2026, meiLimit: '12.34', ownerId: 'forged' });
  const mutation = calls.find(c => c.options.method);
  assert.ok(!Object.hasOwn(mutation.options.body.p_payload, 'ownerId')); assert.equal(mutation.options.body.p_payload.meiLimit, '12.34');
  assert.deepEqual(events.map(e => e.module), ['mei']);
});

test('legacy decimals beyond cents remain exact in totals, settings and CSV', () => {
  const r = report([entry({ value: '0.001' }), entry({ value: '0.009' })], [{ year: 2026, meiLimit: '1.0001' }], 2026);
  assert.equal(r.recebido, '0.01'); assert.equal(r.restante, '0.9901');
  assert.match(exportReport(r, { format: 'csv' }).content, /;0\.001/);
  assert.equal(entryBody(entry({ value: '1.0001' })).value, '1.0001');
});
test('create preserves requestId for server idempotency and strips forged identity', async () => {
  const { service, calls } = mockCloud();
  await service.dispatch('createEntry', { ...entry(), orgId: org, requestId: id, ownerId: 'forged' });
  const sent = calls.at(-1).options.body.p_payload;
  assert.equal(sent.requestId, id); assert.ok(!Object.hasOwn(sent, 'ownerId'));
  assert.ok(!Object.hasOwn(sent, 'created_by')); assert.equal(sent.value, '0.10');
});
test('numeric JSON money is rejected rather than silently using rounded float', async () => {
  const { service } = mockCloud({ entries: [entry({ value: 0.1, revision: 1 })] });
  await assert.rejects(service.dispatch('load', { orgId: org, year: 2026 }), /decimal/);
});

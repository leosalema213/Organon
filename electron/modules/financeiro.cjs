const { randomUUID } = require('node:crypto');
const ACTIONS = new Set(['snapshot', 'createEntry', 'updateEntry', 'deleteEntry', 'createType', 'duplicateEntries']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Identificador inválido.'); return value; }
function revision(value) { if (!Number.isSafeInteger(value) || value < 1) throw new Error('Recarregue o lançamento antes de alterar.'); return value; }
function decimal(value) {
  if (typeof value !== 'string' || value.length > 200 || !/^-?\d+(?:[.,]\d+)?$/.test(value.trim())) throw new Error('Valor decimal inválido.');
  return value.trim().replace(',', '.');
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) throw new Error('Data inválida.');
  const date = new Date(value + 'T12:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Data inválida.');
  return value;
}
function normalizeCategoryName(name) { return name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('pt-BR'); }
function entryPayload(value) {
  if (typeof value.description !== 'string' || !value.description.trim() || value.description.length > 10000) throw new Error('Informe a descrição.');
  if (!['entrada', 'gasto', 'projetado'].includes(value.entryType)) throw new Error('Natureza inválida.');
  if (typeof value.countForMei !== 'boolean') throw new Error('Indicador de MEI inválido.');
  const amount = decimal(value.value);
  return { description: value.description, value: amount, typeId: value.typeId ? uuid(value.typeId) : null,
    entryType: value.entryType, entryDate: validDate(value.entryDate), countForMei: value.countForMei };
}
function commandPayload(action, value) {
  switch (action) {
    case 'createEntry': return { ...entryPayload(value), requestId: uuid(value.requestId) };
    case 'updateEntry': return { ...entryPayload(value), id: uuid(value.id), expectedRevision: revision(value.expectedRevision) };
    case 'deleteEntry': return { id: uuid(value.id), expectedRevision: revision(value.expectedRevision) };
    case 'createType': {
      if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200) throw new Error('Informe o nome da categoria (até 200 caracteres).');
      return { name: value.name.normalize('NFKC').trim().replace(/\s+/gu, ' '), normalizedName: normalizeCategoryName(value.name) };
    }
    case 'duplicateEntries': {
      if (!Array.isArray(value.entries) || !value.entries.length || value.entries.length > 1000) throw new Error('Selecione de 1 a 1000 lançamentos.');
      if (typeof value.targetMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.targetMonth) || value.targetMonth.startsWith('0000')) throw new Error('Mês destino inválido.');
      const entries = value.entries.map(e => ({ id: uuid(e.id), expectedRevision: revision(e.expectedRevision) }));
      if (new Set(entries.map(e => e.id)).size !== entries.length) throw new Error('Seleção repetida.');
      return { entries, targetMonth: value.targetMonth, requestId: uuid(value.requestId) };
    }
    default: return {};
  }
}
function validateSnapshot(data) {
  if (!data || !Array.isArray(data.entries) || !Array.isArray(data.types)) throw new Error('Resposta financeira inválida.');
  for (const entry of data.entries) { decimal(entry.value); revision(entry.revision); }
  return data;
}
function createService({ cloud, emit = () => {} }) {
  return { async dispatch(action, payload = {}) {
    if (!ACTIONS.has(action)) throw new Error('Ação financeira não permitida.');
    const orgId = uuid(payload.orgId), body = commandPayload(action, payload);
    await cloud.ready;
    if (!cloud.enabled) throw new Error('A conexão com a nuvem está indisponível.');
    const token = await cloud.token();
    const result = await cloud.request('/rest/v1/rpc/' + (action === 'snapshot' ? 'financeiro_snapshot' : 'financeiro_mutate'), {
      method: 'POST', token, body: action === 'snapshot' ? { p_org_id: orgId } : { p_org_id: orgId, p_action: action, p_payload: body },
    });
    if (action === 'snapshot') return validateSnapshot(result);
    if (result?.conflict) throw new Error('Este lançamento foi alterado por outra pessoa. Atualize a lista e revise suas alterações.');
    if (!result || result.ok !== true) throw new Error('A operação financeira não foi confirmada. Atualize a lista antes de tentar novamente.');
    // Host forwards this signal; server private Realtime remains authoritative across devices.
    emit({ module: 'financeiro', orgId, type: 'changed' });
    return result;
  } };
}
module.exports = { createService, decimal, normalizeCategoryName, validDate, entryPayload, commandPayload, validateSnapshot, newRequestId: randomUUID };

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// Decimal strings at every boundary; no binary floating point monetary arithmetic.
function cents(value) {
  const raw = String(value ?? '').trim().replace(',', '.');
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) throw new Error('Informe um valor decimal com até duas casas.');
  return (match[1] ? -1n : 1n) * (BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0')));
}
function decimal(value) {
  const negative = value < 0n; const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
function moneyInput(value) {
  if (typeof value !== 'string' || value.length > 200 || !/^-?\d+(?:[.,]\d+)?$/.test(value.trim())) throw new Error('Informe um valor decimal válido.');
  return value.trim().replace(',', '.');
}
function scaleOf(value) { return (moneyInput(value).split('.')[1] || '').length; }
function units(value, scale) {
  const raw = moneyInput(value), [whole, fraction = ''] = raw.replace('-', '').split('.');
  return BigInt(whole + fraction.padEnd(scale, '0')) * (raw.startsWith('-') ? -1n : 1n);
}
function unscale(value, scale) {
  const digits = String(value < 0n ? -value : value).padStart(scale + 1, '0');
  const fraction = digits.slice(-scale).replace(/0+$/, '').padEnd(2, '0');
  return `${value < 0n ? '-' : ''}${digits.slice(0, -scale)}.${fraction}`;
}
function dateOf(entry) { return entry.entryDate ?? String(entry.createdAt ?? '').slice(0, 10); }
function yearOf(entry) { return Number(dateOf(entry).split('-')[0]); }
function monthOf(entry) { return Number(dateOf(entry).split('-')[1]); }
function included(entry) { return entry.entryType === 'projetado' || (entry.entryType === 'entrada' && entry.countForMei !== false); }
function yearInput(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year <= 2000 || year > 9999) throw new Error('Informe um ano entre 2001 e 9999.');
  return year;
}
function monthInput(value = 'all') {
  if (value === 'all') return value;
  const month = Number(value);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('Mês inválido.');
  return month;
}
function report(entries, settings, year, month = 'all') {
  year = yearInput(year); month = monthInput(month);
  const selected = entries.filter(e => included(e) && yearOf(e) === year)
    .sort((a, b) => monthOf(a) - monthOf(b) || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
  const currentSettings = settings.find(s => Number(s.year) === year) ?? null;
  let scale = Math.max(2, currentSettings ? scaleOf(currentSettings.meiLimit) : 0);
  for (const entry of selected) scale = Math.max(scale, scaleOf(entry.value));
  const read = value => units(value, scale), write = value => unscale(value, scale);
  const groups = [], monthly = []; let received = 0n, projected = 0n, positiveMonths = 0;
  MONTHS.forEach((label, index) => {
    const items = selected.filter(e => monthOf(e) === index + 1);
    if (!items.length) return;
    const totals = {};
    for (const entryType of ['entrada', 'projetado']) {
      const children = items.filter(e => e.entryType === entryType);
      const sum = children.reduce((total, e) => total + read(e.value), 0n);
      totals[entryType] = sum;
      if (children.length) groups.push({ id: `grouped-${index + 1}-${entryType}`, month: index + 1, entryType,
        description: children.map(e => e.description).join(', '), value: write(sum), items: children });
    }
    received += totals.entrada; projected += totals.projetado;
    if (totals.projetado > 0n) positiveMonths++;
    monthly.push({ month: index + 1, label, count: items.length, recebido: write(totals.entrada), projetado: write(totals.projetado), total: write(totals.entrada + totals.projetado) });
  });
  // Round only the presentation of the rational mean, half away from zero.
  const divisor = BigInt(positiveMonths || 1) * 10n ** BigInt(scale - 2);
  const absolute = projected < 0n ? -projected : projected;
  const mean = positiveMonths ? ((absolute + divisor / 2n) / divisor) * (projected < 0n ? -1n : 1n) : 0n;
  return { year, month, settings: currentSettings, entries: selected,
    groups: month === 'all' ? groups : groups.filter(g => g.month === month), monthly,
    recebido: write(received), projetado: write(projected), totalAno: write(received + projected),
    restante: currentSettings ? write(read(currentSettings.meiLimit) - received - projected) : null,
    mediaProjetada: decimal(mean), projectedMonths: positiveMonths };
}
function exportReport(data, { mode = 'all', format = 'json', now = new Date().toISOString() } = {}) {
  if (!['monthly', 'all'].includes(mode) || !['json', 'csv'].includes(format)) throw new Error('Exportação inválida.');
  if (mode === 'monthly' && data.month === 'all') throw new Error('Selecione um mês para exportar.');
  const entries = mode === 'monthly' ? data.entries.filter(e => monthOf(e) === data.month) : data.entries;
  const content = format === 'json' ? JSON.stringify({ exportedAt: now, mode, settings: data.settings, entries }, null, 2)
    : ['ano;mes;tipo;descricao;valor', ...entries.map(e => [yearOf(e), MONTHS[monthOf(e) - 1], e.entryType,
      `"${String(e.description ?? '').replaceAll('"', '""')}"`, unscale(units(e.value, Math.max(2, scaleOf(e.value))), Math.max(2, scaleOf(e.value)))].join(';'))].join('\n');
  return { filename: `relatorio-mei-${data.year}-${mode === 'monthly' ? data.month : 'completo'}.${format}`,
    type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8', content };
}

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Identificador inválido.'); return value; }
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Recarregue o registro antes de editar.');
  return value;
}
function entryBody(payload) {
  const description = payload.description;
  if (typeof description !== 'string' || !description.trim() || description.length > 10000) throw new Error('Informe a descrição (até 10.000 caracteres).');
  if (!['entrada', 'projetado'].includes(payload.entryType)) throw new Error('Natureza inválida para MEI.');
  const date = String(payload.entryDate ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Data inválida.');
  if (typeof payload.countForMei !== 'boolean') throw new Error('Informe a marca MEI.');
  return { description, value: moneyInput(payload.value), typeId: payload.typeId ? uuid(payload.typeId) : null,
    entryType: payload.entryType, entryDate: date, countForMei: payload.countForMei };
}

function validateSnapshot(data) {
  if (!data || !Array.isArray(data.entries) || !Array.isArray(data.settings) || !Array.isArray(data.types)) throw new Error('Resposta MEI inválida.');
  for (const entry of data.entries) { moneyInput(entry.value); revision(entry.revision); }
  for (const setting of data.settings) { moneyInput(setting.meiLimit); revision(setting.revision); }
  return data;
}

function createService({ cloud, emit = () => {} }) {
  async function dispatch(action, payload = {}) {
    if (!['load', 'export', 'saveSettings', 'createEntry', 'updateEntry', 'deleteEntry', 'createType'].includes(action)) throw new Error('Ação MEI desconhecida.');
    await cloud.ready;
    if (!cloud.enabled) throw new Error('Conecte sua conta para usar o MEI.');
    const token = await cloud.token();
    const request = (path, options = {}) => cloud.request(path, { ...options, token });
    const orgId = uuid(payload.orgId);
    // Auth identity comes from the server, never from payload/user/workspace renderer props.
    const identity = await request('/auth/v1/user'); const ownerId = uuid(identity?.id);
    const organizations = await request(`/rest/v1/organizations?id=eq.${orgId}&owner_id=eq.${ownerId}&select=id&limit=1`);
    if (!organizations?.length) throw new Error('MEI é pessoal e exige o proprietário do espaço.');
    const rpc = (name, body) => request(`/rest/v1/rpc/${name}`, { method: 'POST', body });
    if (action === 'load' || action === 'export') {
      const year = yearInput(payload.year), month = monthInput(payload.month);
      const snapshot = validateSnapshot(await rpc('mei_snapshot', { p_org_id: orgId }));
      const data = report(snapshot.entries, snapshot.settings, year, month);
      if (action === 'export') return exportReport(data, payload);
      return { ...data, allSettings: snapshot.settings, types: [...snapshot.types].sort((a, b) => a.name.localeCompare(b.name)) };
    }
    let body;
    if (action === 'saveSettings') {
      body = { year: yearInput(payload.year), meiLimit: moneyInput(payload.meiLimit) };
      if (payload.id) Object.assign(body, { id: uuid(payload.id), expectedRevision: revision(payload.expectedRevision) });
    } else if (action === 'createType') {
      const name = String(payload.name ?? '').trim();
      if (!name || name.length > 200) throw new Error('Informe o nome da categoria (até 200 caracteres).');
      body = { name: name.normalize('NFKC').replace(/\s+/gu, ' ') };
    } else {
      body = action === 'deleteEntry' ? {} : entryBody(payload);
      if (action !== 'createEntry') {
        Object.assign(body, { id: uuid(payload.id), expectedRevision: revision(payload.expectedRevision) });
      }
      if (action === 'createEntry') body.requestId = uuid(payload.requestId);
    }
    const result = await rpc('mei_mutate', { p_org_id: orgId, p_action: action, p_payload: body });
    if (result?.conflict) throw new Error('O registro mudou ou foi removido. Recarregue antes de salvar novamente.');
    if (result?.ok !== true) throw new Error('A operação MEI não foi confirmada. Atualize antes de tentar novamente.');
    if (action === 'saveSettings' && (!result.settings?.id || !Number.isSafeInteger(result.settings.revision))) throw new Error('Resposta de configuração inválida.');
    if (action === 'createType' && !result.type?.id) throw new Error('Resposta de categoria inválida.');
    emit({ module: 'mei', orgId, type: 'changed' });
    if (['createEntry', 'updateEntry', 'deleteEntry', 'createType'].includes(action)) emit({ module: 'financeiro', orgId, type: 'changed' });
    if (action === 'saveSettings') return result.settings;
    if (action === 'createType') return result.type;
    return action === 'deleteEntry' ? { id: payload.id } : result.entry || { ok: true };
  }
  return { dispatch };
}
module.exports = { createService, cents, decimal, dateOf, included, report, exportReport, entryBody, moneyInput, validateSnapshot };

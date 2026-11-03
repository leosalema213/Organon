export const NATURES = { entrada: 'Entrada', gasto: 'Gasto', projetado: 'Projetado' };
export const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// Decimal strings cross every boundary; BigInt is used only inside calculations.
export function decimal(value) {
  if (typeof value !== 'string' || !/^-?\d+(?:[.,]\d+)?$/.test(value.trim())) throw new Error('Informe um valor decimal válido, sem separador de milhar.');
  const [whole, fraction = ''] = value.trim().replace(',', '.').split('.');
  const negative = whole.startsWith('-');
  const digits = whole.replace('-', '').replace(/^0+(?=\d)/, '');
  const tail = fraction.replace(/0+$/, '');
  return `${negative && (digits !== '0' || tail) ? '-' : ''}${digits}${tail ? '.' + tail : ''}`;
}
export function sumMoney(values) {
  const parts = values.map(value => decimal(value).split('.'));
  const scale = Math.max(0, ...parts.map(([, tail = '']) => tail.length));
  const sum = parts.reduce((total, [whole, tail = '']) => total + BigInt((whole.startsWith('-') ? '-' : '') + whole.replace('-', '') + tail.padEnd(scale, '0')), 0n);
  const digits = (sum < 0n ? -sum : sum).toString().padStart(scale + 1, '0');
  return decimal(`${sum < 0n ? '-' : ''}${scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits}`);
}
export function formatMoney(value) {
  const canonical = decimal(value), negative = canonical.startsWith('-');
  const [whole, tail = ''] = canonical.replace('-', '').split('.');
  return `${negative ? '-' : ''}R$ ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${tail.padEnd(2, '0')}`;
}
export function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export const entryDate = entry => entry.entryDate ?? String(entry.createdAt ?? '').slice(0, 10);
export function moveDate(date, month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000')) throw new Error('Mês destino inválido.');
  const [year, number] = month.split('-').map(Number);
  const last = new Date(0); last.setFullYear(year, number, 0);
  return `${month}-${String(Math.min(Number(date.slice(8, 10)) || 1, last.getDate())).padStart(2, '0')}`;
}
export function filterEntries(entries, filter) {
  return entries.filter(entry => (filter.category === 'all' || entry.typeId === filter.category)
    && (filter.nature === 'all' || entry.entryType === filter.nature)
    && (filter.mode === 'all' || (filter.mode === 'day' ? !filter.day || entryDate(entry) === filter.day : entryDate(entry).startsWith(filter.month))))
    .sort((a, b) => entryDate(b).localeCompare(entryDate(a)) || a.id.localeCompare(b.id));
}
export function totals(entries) {
  const entrada = sumMoney(entries.filter(e => e.entryType === 'entrada').map(e => e.value));
  const gasto = sumMoney(entries.filter(e => e.entryType === 'gasto').map(e => e.value));
  const negativeGasto = gasto.startsWith('-') ? gasto.slice(1) : '-' + gasto;
  return { entrada, gasto, saldo: sumMoney([entrada, negativeGasto]), projetado: sumMoney(entries.filter(e => e.entryType === 'projetado').map(e => e.value)) };
}
export const normalizeCategoryName = name => name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('pt-BR');

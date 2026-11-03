import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Download, Filter, MoreHorizontal, Plus, RefreshCw } from 'lucide-react';
import Modal from '../../Modal.jsx';
import PopupMenu from '../../PopupMenu.jsx';
import { NATURES, decimal, entryDate, filterEntries, formatMoney, moveDate, today, totals } from './model.js';
import './financeiro.css';

const requestId = () => crypto.randomUUID();
const emptyFilter = () => ({ mode: 'month', month: today().slice(0, 7), day: today(), category: 'all', nature: 'all' });
function Field({ label, children }) { return <label className="financeiro-field"><span>{label}</span>{children}</label>; }
function Notice({ error }) { return error ? <p className="financeiro-error" role="alert">{error}</p> : null; }

export default function Financeiro({ api, user, workspace }) {
  // A keyed scope discards drafts and authorized data when account/workspace changes.
  return <FinanceiroScope key={`${user?.id || ''}:${workspace?.id || ''}`} {...{ api, user, workspace }} />;
}
function FinanceiroScope({ api, user, workspace }) {
  const orgId = workspace?.id;
  const [data, setData] = useState({ entries: [], types: [] });
  const [filter, setFilter] = useState(emptyFilter);
  const [group, setGroup] = useState('none');
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(null), [category, setCategory] = useState(null);
  const [duplicate, setDuplicate] = useState(null), [deleting, setDeleting] = useState(null);
  const canWrite = data.canWrite === true;
  const alive = useRef(true), loadId = useRef(0), busy = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; loadId.current++; }; }, []);
  const load = useCallback(async () => {
    if (!orgId || !user?.id) return;
    const id = ++loadId.current;
    setLoading(true);
    try {
      const snapshot = await api.call('financeiro', 'snapshot', { orgId });
      if (alive.current && id === loadId.current) { setData(snapshot); setError(''); }
    } catch (e) {
      if (alive.current && id === loadId.current) { setData({ entries: [], types: [] }); setError(e.message); }
    } finally { if (alive.current && id === loadId.current) setLoading(false); }
  }, [api, orgId, user?.id]);
  useEffect(() => {
    load();
    // Every event, including reconnect, requires a fresh authorized snapshot.
    const unsubscribe = api.subscribe('financeiro', event => { if (!event?.orgId || event.orgId === orgId) load(); });
    const online = () => load();
    window.addEventListener('online', online);
    window.addEventListener('focus', online);
    return () => { unsubscribe?.(); window.removeEventListener('online', online); window.removeEventListener('focus', online); };
  }, [api, orgId, load]);
  async function mutate(action, payload, complete) {
    if (!canWrite) { setError('Seu acesso a este financeiro é somente de leitura.'); return; }
    if (busy.current) return;
    busy.current = true; setSaving(true); setError('');
    try {
      const result = await api.call('financeiro', action, { ...payload, orgId });
      if (alive.current) { complete?.(result); await load(); }
    } catch (e) { if (alive.current) setError(e.message); }
    finally { busy.current = false; if (alive.current) setSaving(false); }
  }
  if (!orgId || !user?.id) return <section className="financeiro-page"><h1>Financeiro</h1><p>Entre e selecione um espaço para acessar os lançamentos.</p></section>;
  const filtered = filterEntries(data.entries, filter), summary = totals(filtered);
  const grouped = new Map();
  for (const entry of filtered) {
    const label = group === 'category' ? data.types.find(t => t.id === entry.typeId)?.name || 'Sem categoria' : group === 'nature' ? NATURES[entry.entryType] || entry.entryType : '';
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push(entry);
  }
  function newEntry() {
    setError('');
    setDraft({ description: '', value: '0', typeId: data.types[0]?.id || '', entryType: 'gasto', countForMei: true,
      entryDate: filter.mode === 'month' && filter.month ? moveDate(today(), filter.month) : today(), requestId: requestId() });
  }
  const setDateMode = mode => setFilter(current => ({ ...current, mode }));
  function exportData() {
    const content = JSON.stringify({ format: 'organon-financeiro', version: 1, exportedAt: new Date().toISOString(), workspace: { id: workspace.id, name: workspace.name }, entries: data.entries, types: data.types }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `financeiro-${today()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="financeiro-page" aria-busy={loading || saving}>
    <header className="financeiro-header"><div><h1>Financeiro</h1><p className="muted">{workspace.name} · Entradas, gastos e projetados</p></div><div className="button-row">
      <button className="secondary" disabled={loading || saving} onClick={load}><RefreshCw size={14} />Atualizar</button>
      <button className="secondary" disabled={loading || saving || !!error} onClick={exportData}><Download size={14} />Exportar dados</button>
      <button className="secondary" disabled={saving || !canWrite || !filtered.length} onClick={() => { setError(''); setDuplicate({ targetMonth: filter.month || today().slice(0, 7), nature: 'ambos', requestId: requestId(), entries: filtered.map(e => ({ ...e })) }); }}><Copy size={14} />Duplicar</button>
      <button className="primary" disabled={saving || loading || !canWrite} onClick={newEntry}><Plus size={14} />Novo lançamento</button>
    </div></header>
    <Notice error={error} />
    {!loading && !error && !canWrite && <p className="muted">Você tem acesso de leitura a este financeiro.</p>}
    <div className="financeiro-summary">{[['entrada', 'Entradas'], ['gasto', 'Gastos'], ['saldo', 'Saldo']].map(([key, label]) => <article key={key} className={`financeiro-total financeiro-${key}`}><span>{label}</span><strong>{formatMoney(summary[key])}</strong></article>)}</div>
    <div className="financeiro-filters">
      <div className="financeiro-date"><span>Filtro de data</span><div className="button-row">
        {filter.mode === 'month' && <input aria-label="Mês e ano" type="month" required value={filter.month} onChange={e => setFilter({ ...filter, month: e.target.value })} />}
        {filter.mode === 'day' && <input aria-label="Dia" type="date" value={filter.day} onChange={e => setFilter({ ...filter, day: e.target.value })} />}
        {filter.mode === 'all' && <span>Exibir tudo</span>}
        <PopupMenu label="Opções de data" icon={Filter} className="secondary" items={[['month', 'Mês e ano'], ['day', 'Dia'], ['all', 'Exibir tudo']].map(([id, label]) => ({ id, label, onSelect: () => setDateMode(id) }))} />
      </div></div>
      <Field label="Tipo"><select value={filter.nature} onChange={e => setFilter({ ...filter, nature: e.target.value })}><option value="all">Todos</option>{Object.entries(NATURES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
      <Field label="Categoria"><select value={filter.category} onChange={e => setFilter({ ...filter, category: e.target.value })}><option value="all">Todas as categorias</option>{data.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
      <Field label="Agrupar"><select value={group} onChange={e => setGroup(e.target.value)}><option value="none">Sem agrupamento</option><option value="category">Categoria</option><option value="nature">Tipo</option></select></Field>
      <button className="secondary" onClick={() => setFilter(current => ({ ...current, mode: 'month', nature: 'all', category: 'all' }))}>Limpar filtros</button>
    </div>
    {loading && <p role="status" className="muted">Atualizando lançamentos…</p>}
    <div className="financeiro-table"><table><thead><tr>{['Descrição', 'Valor', 'Categoria', 'Tipo', 'Data', 'Ações'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>
      {[...grouped].map(([label, entries]) => <React.Fragment key={label}>{label && <tr className="financeiro-group"><th colSpan={6} scope="rowgroup">{label} · {entries.length} lançamento(s)</th></tr>}{entries.map(entry => <tr key={entry.id}>
        <td><button className="financeiro-description" disabled={saving || !canWrite} onClick={() => { setError(''); setDraft({ ...entry, entryDate: entryDate(entry), countForMei: entry.countForMei ?? true }); }}>{entry.description}</button></td>
        <td className="financeiro-value">{formatMoney(entry.value)}</td><td>{data.types.find(t => t.id === entry.typeId)?.name || '—'}</td>
        <td><span className={`financeiro-badge financeiro-${entry.entryType}`}>{NATURES[entry.entryType] || entry.entryType}</span></td><td>{entryDate(entry).split('-').reverse().join('/') || '—'}</td>
        <td><PopupMenu label={`Ações de ${entry.description}`} icon={MoreHorizontal} iconOnly className="icon-button" items={[
          { id: 'edit', label: 'Editar', disabled: saving || !canWrite, onSelect: () => { setError(''); setDraft({ ...entry, entryDate: entryDate(entry), countForMei: entry.countForMei ?? true }); } },
          { id: 'delete', label: 'Excluir', disabled: saving || !canWrite, onSelect: () => { setError(''); setDeleting(entry); } },
        ]} /></td>
      </tr>)}</React.Fragment>)}
      {!filtered.length && <tr><td colSpan={6} className="financeiro-empty">{loading ? 'Carregando…' : 'Nenhum lançamento encontrado.'}</td></tr>}
    </tbody></table></div>
    <p className="muted">{filtered.length} lançamento(s). Projetados: {formatMoney(summary.projetado)}. Projetados não compõem o saldo.</p>

    {draft && <Modal title={draft.id ? 'Editar lançamento' : 'Novo lançamento'} small onClose={() => { if (!saving) setDraft(null); }}><form className="financeiro-form" onSubmit={e => { e.preventDefault(); try { mutate(draft.id ? 'updateEntry' : 'createEntry', { ...draft, value: decimal(draft.value), expectedRevision: draft.revision }, () => setDraft(null)); } catch (err) { setError(err.message); } }}>
      <Notice error={error} /><fieldset disabled={saving}>
        <Field label="Descrição"><input autoFocus required maxLength={10000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></Field>
        <div className="financeiro-category"><Field label="Categoria"><select required value={draft.typeId || ''} onChange={e => setDraft({ ...draft, typeId: e.target.value })}><option value="" disabled>Selecione uma categoria</option>{draft.typeId && !data.types.some(t => t.id === draft.typeId) && <option value={draft.typeId}>Categoria indisponível</option>}{data.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field><button type="button" className="secondary" onClick={() => setCategory('')}><Plus size={14} />Nova categoria</button></div>
        <div className="financeiro-pair"><Field label="Valor"><input required inputMode="decimal" maxLength={200} value={draft.value} onChange={e => setDraft({ ...draft, value: e.target.value })} /></Field><Field label="Natureza"><select value={draft.entryType} onChange={e => setDraft({ ...draft, entryType: e.target.value })}>{Object.entries(NATURES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field></div>
        {draft.entryType === 'entrada' && <label className="financeiro-check"><input type="checkbox" checked={draft.countForMei} onChange={e => setDraft({ ...draft, countForMei: e.target.checked })} />Contabilizar para o MEI</label>}
        <Field label="Data"><input required type="date" value={draft.entryDate} onChange={e => setDraft({ ...draft, entryDate: e.target.value })} /></Field>
        <div className="modal-actions"><button type="button" className="secondary" onClick={() => setDraft(null)}>Cancelar</button><button type="submit" className="primary">{saving ? 'Salvando…' : draft.id ? 'Salvar alterações' : 'Adicionar valor'}</button></div>
      </fieldset></form></Modal>}
    {category !== null && <Modal title="Nova categoria" small onClose={() => { if (!saving) setCategory(null); }}><form className="financeiro-form" onSubmit={e => { e.preventDefault(); mutate('createType', { name: category }, result => { if (result.type) setDraft(current => current ? { ...current, typeId: result.type.id } : current); setCategory(null); }); }}>
      <Notice error={error} /><Field label="Nome da categoria"><input autoFocus required maxLength={200} disabled={saving} value={category} onChange={e => setCategory(e.target.value)} /></Field><div className="modal-actions"><button type="button" className="secondary" disabled={saving} onClick={() => setCategory(null)}>Cancelar</button><button className="primary" disabled={saving}>Criar</button></div>
    </form></Modal>}
    {duplicate && <Modal title="Duplicar lançamentos" small onClose={() => { if (!saving) setDuplicate(null); }}><form className="financeiro-form" onSubmit={e => { e.preventDefault(); const entries = duplicate.entries.filter(entry => duplicate.nature === 'ambos' || entry.entryType === duplicate.nature).map(entry => ({ id: entry.id, expectedRevision: entry.revision })); if (!entries.length) { setError('Nenhum lançamento encontrado para duplicar.'); return; } mutate('duplicateEntries', { entries, targetMonth: duplicate.targetMonth, requestId: duplicate.requestId }, () => setDuplicate(null)); }}>
      <Notice error={error} /><p>Duplicar a seleção de {duplicate.entries.length} lançamento(s) capturada ao abrir esta janela. Os dias serão ajustados ao mês destino.</p>
      <Field label="Mês e ano destino"><input required type="month" disabled={saving} value={duplicate.targetMonth} onChange={e => setDuplicate({ ...duplicate, targetMonth: e.target.value })} /></Field>
      <Field label="O que duplicar?"><select disabled={saving} value={duplicate.nature} onChange={e => setDuplicate({ ...duplicate, nature: e.target.value })}><option value="ambos">Tudo (entradas, gastos e projetados)</option>{Object.entries(NATURES).map(([id, label]) => <option key={id} value={id}>Apenas {label.toLocaleLowerCase('pt-BR')}s</option>)}</select></Field>
      <div className="modal-actions"><button type="button" className="secondary" disabled={saving} onClick={() => setDuplicate(null)}>Cancelar</button><button className="primary" disabled={saving}>Duplicar</button></div>
    </form></Modal>}
    {deleting && <Modal title="Excluir lançamento?" small onClose={() => { if (!saving) setDeleting(null); }}><div className="financeiro-form"><Notice error={error} /><p>{deleting.description} · {formatMoney(deleting.value)}</p><p>Somente este lançamento será excluído.</p><div className="modal-actions"><button className="secondary" disabled={saving} onClick={() => setDeleting(null)}>Cancelar</button><button className="danger-button" disabled={saving} onClick={() => mutate('deleteEntry', { id: deleting.id, expectedRevision: deleting.revision }, () => setDeleting(null))}>Excluir</button></div></div></Modal>}
  </section>;
}

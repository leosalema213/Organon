import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import Modal from '../../Modal.jsx';
import PopupMenu from '../../PopupMenu.jsx';
import './mei.css';

const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
function money(value) {
  if (value == null) return '—';
  const [whole, fraction = '00'] = String(value).split('.');
  return `${whole.startsWith('-') ? '- ' : ''}R$ ${whole.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction}`;
}
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function emptyForm(typeId) { return { requestId: crypto.randomUUID(), description: '', value: '0.00', typeId: typeId || '', entryType: 'entrada', entryDate: today(), countForMei: true }; }
function Field({ label, children }) { return <label className="mei-field"><span>{label}</span>{children}</label>; }

function MeiPage({ api, workspace }) {
  const [year, setYear] = useState(new Date().getFullYear()), [month, setMonth] = useState('all');
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('entries'), [form, setForm] = useState(null), [picker, setPicker] = useState(null), [deleting, setDeleting] = useState(null);
  const [limitDraft, setLimitDraft] = useState(null), [category, setCategory] = useState(null);
  const sequence = useRef(0), alive = useRef(true), initialLimitAsked = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
  const call = useCallback((action, payload = {}) => api.call('mei', action, { ...payload, orgId: workspace.id }), [api, workspace.id]);
  const reload = useCallback(async () => {
    const request = ++sequence.current; setLoading(true);
    try {
      const next = await call('load', { year, month });
      if (!alive.current || sequence.current !== request) return;
      setData(next); setError('');
      if (!next.settings && !initialLimitAsked.current) { initialLimitAsked.current = true; setLimitDraft({ year, value: '' }); }
    } catch (e) { if (alive.current && sequence.current === request) { setData(null); setError(e.message); } }
    finally { if (alive.current && sequence.current === request) setLoading(false); }
  }, [call, year, month]);
  useEffect(() => { setData(null); reload(); }, [reload]);
  useEffect(() => {
    const offMei = api.subscribe('mei', reload), offFinance = api.subscribe('financeiro', reload);
    window.addEventListener('focus', reload); window.addEventListener('online', reload);
    return () => { offMei(); offFinance(); window.removeEventListener('focus', reload); window.removeEventListener('online', reload); };
  }, [api, reload]);
  async function mutate(action, payload, done) {
    setSaving(true); setError('');
    try { const saved = await call(action, payload); if (!alive.current) return; done?.(saved); await reload(); }
    catch (e) { if (alive.current) setError(e.message); }
    finally { if (alive.current) setSaving(false); }
  }
  function chooseYear(value) {
    const next = Number(value); if (!Number.isInteger(next) || next <= 2000 || next > 9999) return;
    const settings = data?.allSettings.find(s => Number(s.year) === next);
    if (settings) setYear(next); else setLimitDraft({ year: next, value: '' });
  }
  function edit(item) {
    setPicker(null); setForm({ ...item, entryDate: item.entryDate ?? String(item.createdAt ?? '').slice(0, 10), countForMei: item.countForMei !== false });
  }
  async function download(mode, format) {
    setError('');
    try {
      const file = await call('export', { year, month, mode, format });
      if (!alive.current) return;
      const url = URL.createObjectURL(new Blob([file.content], { type: file.type }));
      const link = document.createElement('a'); link.href = url; link.download = file.filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { if (alive.current) setError(e.message); }
  }
  const closeLimit = () => { if (data?.settings && !saving) setLimitDraft(null); };
  const ready = data && data.year === year && String(data.month) === String(month);
  return <div className="mei-page">
    <header className="page-heading"><h1>MEI</h1><div className="mei-controls mei-heading-controls">{ready && <><label>Ano <input aria-label="Ano" type="number" min="2001" max="9999" defaultValue={year} key={year} onBlur={e => { chooseYear(e.target.value); e.target.value = String(year); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></label><button className="secondary" disabled={saving} onClick={() => setLimitDraft({ year, value: data.settings?.meiLimit ?? '', settings: data.settings })}>Limite MEI {year}: {money(data.settings?.meiLimit)} <Pencil size={13} /></button></>}<button className="secondary" disabled={loading || saving} onClick={reload}><RefreshCw size={15} />Atualizar</button></div></header>
    {error && <p role="alert" className="mei-error">{error}</p>}
    <p className="mei-status" role="status">{saving ? 'Salvando alterações…' : loading ? 'Carregando…' : ''}</p>
    {ready && <>
      <section className="mei-stats" aria-label="Totais anuais">
        {[['Total recebido', data.recebido], ['Total projetado', data.projetado], ['Total do ano', data.totalAno], [data.restante?.startsWith('-') ? 'Acima do limite' : 'Pode ganhar a mais', data.restante?.replace('-', '')]].map(([label, value], i) => <article className="stat-card" key={label}><span className="stat-label">{label}</span><strong className={i === 3 ? data.restante?.startsWith('-') ? 'mei-negative' : 'mei-positive' : ''}>{money(value)}</strong></article>)}
      </section>
      {!data.settings && <p className="mei-notice">Configure o limite anual para calcular o valor restante. Nenhum teto é presumido.</p>}
      <div className="mei-controls"><div className="tabs" aria-label="Visão MEI"><button className={tab === 'entries' ? 'selected' : ''} onClick={() => setTab('entries')}>Lançamentos</button><button className={tab === 'summary' ? 'selected' : ''} onClick={() => setTab('summary')}>Resumo mensal</button></div>{tab === 'entries' && <><PopupMenu label="Exportar" icon={Download} className="secondary" items={['monthly', 'all'].flatMap(mode => ['json', 'csv'].map(format => ({ id: `${mode}-${format}`, label: `Exportar ${mode === 'monthly' ? 'mês' : 'tudo'} em ${format.toUpperCase()}`, disabled: mode === 'monthly' && month === 'all', onSelect: () => download(mode, format) })))} /><button className="primary" disabled={saving} onClick={() => setForm(emptyForm(data.types[0]?.id))}><Plus size={16} />Novo lançamento</button></>}</div>
      {tab === 'entries' ? <section className="mei-list"><div className="section-heading"><h2>Lançamentos</h2><label>Filtro de mês <select aria-label="Filtro de mês" value={month} onChange={e => setMonth(e.target.value)}><option value="all">Todos os meses</option>{months.map((label, i) => <option key={label} value={i + 1}>{label}</option>)}</select></label></div><div className="mei-table"><table><thead><tr>{['Mês', 'Tipo', 'Descrição', 'Total', 'Ações'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{data.groups.map(group => <tr key={group.id}><td>{months[group.month - 1]}</td><td><span className={`mei-badge ${group.entryType}`}>{group.entryType === 'entrada' ? 'recebido' : 'projetado'}</span></td><td>{group.description}</td><td>{money(group.value)}</td><td><button className="icon-button" aria-label={`Editar ${group.description}`} disabled={saving} onClick={() => group.items.length === 1 ? edit(group.items[0]) : setPicker(group)}><Pencil size={16} /></button><button className="icon-button" aria-label={`Excluir ${group.items[0].description}`} disabled={saving} onClick={() => setDeleting(group.items[0])}><Trash2 size={16} /></button></td></tr>)}</tbody></table></div>{!data.groups.length && <p className="mei-empty">Nenhum lançamento nesse filtro.</p>}</section>
        : <section><div className="section-heading"><div><h2>Resumo mensal</h2><p>Valores reais e projetados no ano {year}.</p></div><div>Média por lançamento projetado <strong className="mei-mean">{money(data.mediaProjetada)}</strong></div></div><div className="mei-months">{data.monthly.map(group => <article className="stat-card" key={group.month}><h3>{group.label}</h3><strong>{money(group.total)}</strong><p>Recebido {money(group.recebido)} | Projetado {money(group.projetado)}</p></article>)}</div></section>}
    </>}
    {limitDraft && <Modal small title={`Limite MEI para ${limitDraft.year}`} subtitle="Informe o limite anual configurado para este ano." onClose={closeLimit}><form className="mei-form" onSubmit={e => { e.preventDefault(); const draft = limitDraft; mutate('saveSettings', { year: draft.year, meiLimit: draft.value, id: draft.settings?.id, expectedRevision: draft.settings?.revision }, () => { setLimitDraft(null); setYear(draft.year); }); }}><Field label="Limite anual (R$)"><input required inputMode="decimal" autoFocus value={limitDraft.value} onChange={e => setLimitDraft({ ...limitDraft, value: e.target.value })} /></Field>{error && <p role="alert" className="mei-error">{error}</p>}<div className="modal-actions">{data?.settings && <button type="button" className="secondary" disabled={saving} onClick={closeLimit}>Cancelar</button>}<button className="primary" disabled={saving}>Confirmar</button></div></form></Modal>}
    {form && <Modal title={form.id ? 'Editar lançamento' : 'Novo lançamento'} onClose={() => !saving && setForm(null)}><form className="mei-form" onSubmit={e => { e.preventDefault(); mutate(form.id ? 'updateEntry' : 'createEntry', { ...form, expectedRevision: form.revision }, () => setForm(null)); }}><Field label="Descrição"><input required autoFocus value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></Field><Field label="Categoria"><div className="mei-inline"><select required value={form.typeId ?? ''} onChange={e => setForm({ ...form, typeId: e.target.value })}><option value="" disabled>Selecione uma categoria</option>{data?.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><button type="button" className="secondary" onClick={() => setCategory('')}><Plus size={15} />Nova categoria</button></div></Field><div className="mei-form-row"><Field label="Valor (R$)"><input required inputMode="decimal" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} /></Field><Field label="Natureza"><select value={form.entryType} onChange={e => setForm({ ...form, entryType: e.target.value })}><option value="entrada">Entrada</option><option value="projetado">Projetado</option></select></Field></div>{form.entryType === 'entrada' && <label className="mei-inline"><input type="checkbox" checked={form.countForMei} onChange={e => setForm({ ...form, countForMei: e.target.checked })} />Contabilizar para o MEI</label>}<Field label="Data"><input type="date" required value={form.entryDate} onChange={e => setForm({ ...form, entryDate: e.target.value })} /></Field>{error && <p role="alert" className="mei-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary" disabled={saving} onClick={() => setForm(null)}>Cancelar</button><button className="primary" disabled={saving}>{form.id ? 'Salvar alterações' : 'Adicionar valor'}</button></div></form></Modal>}
    {category !== null && <Modal small title="Nova categoria" onClose={() => !saving && setCategory(null)}><form className="mei-form" onSubmit={e => { e.preventDefault(); mutate('createType', { name: category }, saved => { setCategory(null); setForm(current => ({ ...current, typeId: saved.id })); }); }}><Field label="Nome da categoria"><input required autoFocus value={category} onChange={e => setCategory(e.target.value)} /></Field>{error && <p role="alert" className="mei-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary" disabled={saving} onClick={() => setCategory(null)}>Cancelar</button><button className="primary" disabled={saving}>Criar</button></div></form></Modal>}
    {picker && <Modal small title="Selecionar lançamento" subtitle="Escolha qual item editar" onClose={() => setPicker(null)}><div className="mei-picker">{picker.items.map(item => <button className="secondary" key={item.id} onClick={() => edit(item)}><span>{item.description}</span><span>{money(item.value)}</span></button>)}</div></Modal>}
    {deleting && <Modal small title="Confirmar exclusão" onClose={() => !saving && setDeleting(null)}><p>Excluir o lançamento “{deleting.description}”?</p>{error && <p role="alert" className="mei-error">{error}</p>}<div className="modal-actions"><button className="secondary" disabled={saving} onClick={() => setDeleting(null)}>Cancelar</button><button className="primary" disabled={saving} onClick={() => mutate('deleteEntry', { id: deleting.id, expectedRevision: deleting.revision }, () => setDeleting(null))}>Excluir</button></div></Modal>}
  </div>;
}

export default function Mei({ api, user, workspace }) {
  if (!user || !workspace || user.id !== workspace.owner_id) return <section className="mei-page"><h1>MEI</h1><p>MEI é pessoal e está disponível somente para o proprietário do espaço.</p></section>;
  return <MeiPage key={`${user.id}:${workspace.id}`} api={api} workspace={workspace} />;
}

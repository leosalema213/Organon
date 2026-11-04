import React, { useEffect, useRef, useState } from 'react';
import { Plus, Layers, Copy, Upload, Pencil, Settings, Play, ChevronRight, RotateCcw, Pause, Trash2 } from 'lucide-react';
import { answer, afterDays, basicModel, clozeModel, counts, dayStart, defaultOptions, emptyAnki, mergeAnki, newCard, optionsFor, queue, removeDeck, reversedModel, schedule, validAnki } from './anki.js';
import CardFace from './AnkiCard.jsx';
import AnkiField from './AnkiField.jsx';
import DeckOptions from './DeckOptions.jsx';
import PopupMenu from './PopupMenu.jsx';
import AnkiPlanLinks from './AnkiPlanLinks.jsx';
import { fieldLabel, modelLabel } from './anki-labels.js';
import './anki.css';

export default function Anki({ collection, onChange, notify, Modal, saveError, plans = [], initialPlan = '', onEditNote, noteEditorOpen = false }) {
  const a = collection || emptyAnki();
  const [deckId, setDeckId] = useState(() => {
    if (!initialPlan) return '';
    const linked = a.decks.filter(deck => deck.planIds?.includes(initialPlan));
    return linked.length === 1 ? linked[0].id : '';
  });
  const [tab, setTab] = useState('decks'), [options, setOptions] = useState(null), [deckEditor, setDeckEditor] = useState(null), [pending, setPending] = useState(null), [deleting, setDeleting] = useState(null), [busy, setBusy] = useState(false), [search, setSearch] = useState(''), [planFilter, setPlanFilter] = useState(initialPlan), [linkingPlan, setLinkingPlan] = useState(null);
  const editor = noteEditorOpen, setEditor = onEditNote;
  const [now, setNow] = useState(Date.now()), [session, setSession] = useState(null), [back, setBack] = useState(false), [typed, setTyped] = useState(''), [replay, setReplay] = useState(0), [undo, setUndo] = useState(null), [audioDone, setAudioDone] = useState(false), [leaving, setLeaving] = useState(false);
  const started = useRef(Date.now()), revealed = useRef(null), lock = useRef(false), transition = useRef(null);
  useEffect(() => { started.current = Date.now(); revealed.current = back ? Date.now() : null; if (noteEditorOpen) setUndo(null); }, [noteEditorOpen]);
  useEffect(() => () => clearTimeout(transition.current), []);
  useEffect(() => setUndo(null), [deckId, tab]);
  const patch = change => { setUndo(null); onChange(current => typeof change === 'function' ? change(current || emptyAnki()) : change); };
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const deck = a.decks.find(d => d.id === deckId), card = a.cards.find(c => c.id === session), o = deck ? optionsFor(a, card ? a.decks.find(d => d.id === card.deckId) : deck) : defaultOptions;
  const visibleDecks = a.decks.filter(d => !planFilter || d.planIds?.includes(planFilter));
  const remaining = deck ? queue(a, deckId, now) : [], note = a.notes.find(n => n.id === card?.noteId), model = a.models.find(m => m.id === note?.modelId);
  function showCard(c) { clearTimeout(transition.current); setLeaving(false); setSession(c?.id || null); setBack(false); setTyped(''); setAudioDone(false); started.current = Date.now(); revealed.current = null; lock.current = false; }
  function reveal() { setBack(true); setAudioDone(false); revealed.current = Date.now(); }
  function grade(rating) {
    if (!card || !back || lock.current) return; lock.current = true;
    try { const next = answer(a, card.id, rating, (o.stopTimer ? revealed.current : Date.now()) - started.current); patch(next); setUndo({ collection: a, card }); setLeaving(true); transition.current = setTimeout(() => showCard(queue(next, deckId)[0]), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240); }
    catch (e) { lock.current = false; notify(e.message); }
  }
  function bury() { if (!card) return; const next = { ...a, cards: a.cards.map(c => c.id === card.id ? { ...c, buriedUntil: afterDays(Date.now(), 1, a.settings.rollover) } : c) }; patch(next); setUndo({ collection: a, card }); showCard(queue(next, deckId)[0]); }
  function keydown(e) {
    if (!card || editor || options || deleting || deckEditor || pending || e.repeat || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key.toLowerCase() === 'r') { e.preventDefault(); setReplay(r => r + 1); }
    if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); back ? grade(3) : reveal(); }
    if (back && ['1', '3'].includes(e.key)) { e.preventDefault(); grade(Number(e.key)); }
  }
  const keyRef = useRef(keydown); keyRef.current = keydown;
  useEffect(() => { const listener = e => keyRef.current(e); window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, []);
  useEffect(() => {
    if (!card || editor || options || deleting || deckEditor || pending || (o.waitAudio && !audioDone)) return;
    const seconds = back ? o.answerSeconds : o.questionSeconds;
    if (!seconds || Date.now() - (back ? revealed.current : started.current) < seconds * 1000) return;
    if (!back) { if (o.questionAction === 0) reveal(); else { setAudioDone(false); notify('Tempo da pergunta encerrado.'); } }
    else if (o.answerAction === 0) bury(); else if ([1, 2, 3].includes(o.answerAction)) grade(o.answerAction === 1 ? 1 : o.answerAction === 2 ? 3 : 2); else { setAudioDone(false); notify('Tempo da resposta encerrado.'); }
  }, [now, card?.id, back, audioDone]);
  async function importFile() {
    if (!window.desktop?.anki) { notify('Importação de pacotes e mídia disponível no aplicativo desktop.'); return; }
    setBusy(true);
    try { const result = await window.desktop.anki.import(); if (result) { if (!validAnki(result.collection)) throw new Error('A coleção contém dados ou opções não suportados. O pacote original foi preservado.'); setPending(result); } }
    catch (e) { notify(`Não foi possível importar: ${e.message.replace(/^Error invoking remote method 'anki:import':\s*(?:Error:\s*)?/, '')}`); } finally { setBusy(false); }
  }
  function addNote() {
    if (!a.decks.length) { setDeckEditor({ name: '', planIds: planFilter ? [planFilter] : [] }); return; }
    const m = a.models.find(m => m.id === basicModel.id) || basicModel;
    setEditor({ id: crypto.randomUUID(), modelId: m.id, fields: ['', ''], tags: [], deckId: deckId || visibleDecks[0]?.id || a.decks[0].id, isNew: true });
  }
  const stats = a.reviews.filter(r => r.at >= dayStart(now, a.settings.rollover));
  return <section className="anki-section">
    <div className="page-heading"><h1>Anki</h1><div className="anki-actions"><button disabled={busy} onClick={importFile}><Upload size={16} />{busy ? 'Importando…' : 'Importar arquivo'}</button>{tab === 'decks' && deck ? <button className="primary" onClick={addNote}><Plus size={16} />Adicionar carta</button> : <PopupMenu label="Adicionar" icon={Plus} items={[{ id: 'deck', label: 'Criar baralho', icon: Layers, onSelect: () => setDeckEditor({ name: '', planIds: planFilter ? [planFilter] : [] }) }, { id: 'card', label: 'Criar carta', icon: Copy, disabled: !a.decks.length, description: !a.decks.length ? 'Crie um baralho primeiro' : undefined, onSelect: addNote }]} />}</div></div>
    {saveError && <p role="alert">Não foi possível salvar. Exporte um backup antes de fechar.</p>}
    <div className="tabs anki-tabs">{[['decks', 'Baralhos'], ['browse', 'Explorar'], ['stats', 'Estatísticas']].map(([id, label]) => <button key={id} className={tab === id ? 'selected' : ''} onClick={() => { setTab(id); showCard(null); }}>{label}</button>)}</div>
    {tab === 'decks' && !deck && <>{plans.length > 0 && <div className="books-filters anki-plan-filter"><select aria-label="Baralhos por plano" value={planFilter} onChange={e => setPlanFilter(e.target.value)}><option value="">Todos os planos e independentes</option>{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>{planFilter && <button className="secondary" onClick={() => setLinkingPlan(planFilter)}>Vincular baralhos</button>}</div>}<div className="anki-decks"><table><thead><tr><th>Baralho</th><th>Novas</th><th>Aprendendo</th><th>A revisar</th><th aria-label="Ações" /></tr></thead><tbody>{visibleDecks.map(d => { const c = counts(a, d.id, now); return <tr key={d.id}><td><button className="anki-deck-name" onClick={() => setDeckId(d.id)}>{d.name}</button></td><td className="anki-new">{c.new}</td><td className="anki-learn">{c.learn}</td><td className="anki-due">{c.due}</td><td className="anki-deck-actions"><button aria-label={`Opções de ${d.name}`} onClick={() => setOptions(d.id)}><Settings size={16} /></button><button aria-label={`Editar baralho ${d.name}`} onClick={() => setDeckEditor(d)}><Pencil size={15} /></button><button aria-label={`Excluir baralho ${d.name}`} title="Excluir baralho" onClick={() => setDeleting(d.id)}><Trash2 size={15} /></button></td></tr>; })}</tbody></table>{!visibleDecks.length && <p className="anki-empty">{planFilter ? 'Nenhum baralho vinculado a este plano. Use Vincular baralhos para escolher.' : 'Crie um baralho ou importe sua coleção do Anki para começar.'}</p>}</div><div className="anki-footer"><span>{stats.length} respostas hoje · {(stats.reduce((s, r) => s + r.elapsedMs, 0) / 60000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} min</span></div></>}
    {tab === 'decks' && deck && <><div className="anki-deck-toolbar"><nav className="anki-breadcrumb" aria-label="Caminho do baralho"><button onClick={() => { setDeckId(''); showCard(null); }}>Baralhos</button><ChevronRight size={13} aria-hidden="true" /><span aria-current="page">{deck.name}</span></nav><button className="secondary" onClick={() => setOptions(deck.id)}><Settings size={15} />Opções</button></div>
      {card ? <><div className="anki-review-meta"><span>{remaining.length} disponíveis agora</span>{o.showTimer && <time>{Math.min(o.maxAnswerSeconds, Math.floor(((back && o.stopTimer ? revealed.current : now) - started.current) / 1000))}s</time>}</div><CardFace key={card.id} onEdit={() => setEditor({ ...structuredClone(note), deckId: card.deckId })} counters={counts(a, deckId, now)} a={a} card={card} back={back} typed={typed} autoplay={o.autoplay} skipQuestion={o.skipQuestion} replay={replay} onKey={keydown} onAudioStart={() => setAudioDone(false)} onAudioEnd={() => setAudioDone(true)} onReveal={reveal} onTyped={setTyped} typing={/\{\{type:/.test(model?.templates[card.ord]?.q || '')} leaving={leaving} answerActions={[{ rating: 1, label: 'Errei' }, { rating: 3, label: 'Acertei' }].map(({ rating, label }) => { let next; try { next = schedule(a, card, rating, now); } catch { /* shown on answer */ } return <button key={rating} disabled={leaving} onClick={() => grade(rating)}><span>{label}</span><small>{next ? next.state === 2 ? `${next.interval} d` : `${Math.max(1, Math.round((next.due - now) / 60000))} min` : '—'}</small></button>; })} /></> : <div className="anki-overview"><h2>{remaining.length ? 'Pronto para estudar?' : 'Revisões em dia por enquanto.'}</h2><p>{counts(a, deckId, now).new} novas · {counts(a, deckId, now).learn} aprendendo · {counts(a, deckId, now).due} para revisar</p>{remaining.length ? <button className="primary" onClick={() => showCard(remaining[0])}><Play size={17} />Estudar agora</button> : <p className="muted">Cards em aprendizagem reaparecem quando o intervalo terminar.</p>}{a.cards.some(c => c.unsupported && c.deckId === deckId) && <p role="alert">Há cartas com modelos não compatíveis. Elas aparecem em Explorar e ficam fora da sessão.</p>}</div>}
      {undo && <button className="anki-undo secondary" onClick={() => { patch(undo.collection); showCard(undo.card); }}><RotateCcw size={15} /><span>Desfazer última resposta</span></button>}</>}
    {tab === 'browse' && <><div className="books-filters anki-search"><input aria-label="Buscar cartas" placeholder="Buscar texto, marcador ou baralho…" value={search} onChange={e => setSearch(e.target.value)} /><select aria-label="Filtrar baralho" value={deckId} onChange={e => setDeckId(e.target.value)}><option value="">Todos os baralhos</option>{a.decks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div><div className="anki-browser">{a.cards.filter(c => (!deckId || c.deckId === deckId) && (() => { const n = a.notes.find(n => n.id === c.noteId); return (n?.fields.join(' ') + ' ' + n?.tags.join(' ') + ' ' + a.decks.find(d => d.id === c.deckId)?.name).toLowerCase().includes(search.toLowerCase()); })()).map(c => { const n = a.notes.find(n => n.id === c.noteId); return <article key={c.id}><button className="anki-browse-text" onClick={() => setEditor({ ...structuredClone(n), deckId: c.deckId })}><strong>{n.fields[0].replace(/<[^>]*>/g, '').slice(0, 150) || 'Carta com mídia'}</strong><small>{a.decks.find(d => d.id === c.deckId)?.name} · {c.suspended ? 'Suspensa' : c.state === 0 ? 'Nova' : new Date(c.due).toLocaleString('pt-BR')} · {c.reps} respostas{c.unsupported && ' · Modelo não compatível'}</small></button><button onClick={() => patch(s => ({ ...s, cards: s.cards.map(x => x.id === c.id ? { ...x, suspended: !x.suspended } : x) }))} title={c.suspended ? 'Reativar carta' : 'Suspender carta'}><Pause size={16} /></button></article>; })}</div></>}
    {tab === 'stats' && <div className="anki-overview"><h2>Seu estudo em cartas</h2><p>{a.notes.length} notas · {a.cards.length} cartas · {a.reviews.length} respostas no histórico</p><p>Hoje: {stats.length} respostas · {(stats.reduce((s, r) => s + r.elapsedMs, 0) / 60000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} minutos</p><table><thead><tr><th>Período</th><th>Respostas</th><th>Tempo</th><th>Acertos (2–4)</th></tr></thead><tbody>{[7, 30, 365].map(days => { const r = a.reviews.filter(r => r.at >= now - days * 86400000); return <tr key={days}><td>{days} dias</td><td>{r.length}</td><td>{(r.reduce((s, x) => s + x.elapsedMs, 0) / 60000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} min</td><td>{r.length ? Math.round(r.filter(x => x.rating > 1).length / r.length * 100) : 0}%</td></tr>; })}</tbody></table></div>}
    {deckEditor && <AnkiDeckEditor key={deckEditor.id || 'new'} {...{ a, plans, Modal, notify }} initial={deckEditor} onClose={() => setDeckEditor(null)} onSave={deck => { patch(current => ({ ...current, decks: deckEditor.id ? current.decks.map(d => d.id === deck.id ? { ...d, name: deck.name, planIds: deck.planIds } : d) : [...current.decks, deck] })); setDeckEditor(null); }} />}
    {deleting && <Modal title="Excluir baralho?" small onClose={() => setDeleting(null)}><p>O baralho “{a.decks.find(d => d.id === deleting)?.name}”, seus sub-baralhos e {a.cards.length - removeDeck(a, deleting).cards.length} cartas serão removidos. Notas usadas por cartas de outros baralhos e o histórico de respostas serão preservados.</p><div className="modal-actions"><button className="secondary" onClick={() => setDeleting(null)}>Cancelar</button><button className="danger-button" onClick={() => { const next = removeDeck(a, deleting); patch(next); if (!next.decks.some(d => d.id === deckId)) { setDeckId(''); showCard(null); } setDeleting(null); }}>Excluir baralho</button></div></Modal>}
    {options && <DeckOptions {...{ a, Modal, notify, plans }} deckId={options} onClose={() => { setOptions(null); started.current = Date.now(); revealed.current = back ? Date.now() : null; }} onSave={next => { patch(next); setOptions(null); started.current = Date.now(); revealed.current = back ? Date.now() : null; }} />}
    {linkingPlan && plans.some(p => p.id === linkingPlan) && <AnkiPlanLinks a={a} plan={plans.find(p => p.id === linkingPlan)} Modal={Modal} onClose={() => setLinkingPlan(null)} onSave={next => { patch(next); setLinkingPlan(null); }} />}
    {pending && <Modal title="Importar coleção Anki" onClose={() => setPending(null)}><p className="anki-import-summary">{pending.collection.decks.length} baralhos · {pending.collection.notes.length} notas · {pending.collection.cards.length} cartas · {Object.keys(pending.collection.media).length} mídias.</p><p>Novos itens serão acrescentados. Reimportações preservam edições e revisões já feitas no Organon.</p>{pending.warnings.map(w => <p role="alert" key={w}>{w}</p>)}<p className="muted">O agendamento original é preservado na entrada. As próximas respostas usam o agendador do Organon; há diferenças de ordenação e intervalos em relação ao Anki.</p><div className="modal-actions"><button className="secondary" onClick={() => setPending(null)}>Cancelar</button><button className="primary" onClick={() => { patch(s => mergeAnki(s, pending.collection)); setPending(null); notify('Coleção importada. Revise as cartas e as opções antes de estudar.'); }}>Confirmar importação</button></div></Modal>}
  </section>;
}

export function AnkiNoteEditor({ a, editor, Modal, notify, onClose, onSave, initialState, onCreateDeck }) {
  const available = initialState?.model && !a.models.some(m => m.id === initialState.model.id) ? [...a.models, initialState.model] : a.models;
  const models = [...available, ...[basicModel, reversedModel, clozeModel].filter(m => !available.some(x => x.id === m.id))];
  const [draft, setDraft] = useState(editor), [tags, setTags] = useState(initialState?.tags ?? editor.tags.join(' ')), [working, setWorking] = useState(false), [deleting, setDeleting] = useState(false), [model, setModel] = useState(structuredClone(initialState?.model || models.find(m => m.id === editor.modelId)));
  const media = useRef({ ...a.media, ...initialState?.media }), refs = useRef([]), [preview, setPreview] = useState(initialState?.preview || false);
  const snapshot = () => ({ editor: structuredClone(draft), tags, model: structuredClone(model), media: { ...media.current }, preview });
  function clear() {
    setDraft(previous => ({ ...previous, id: crypto.randomUUID(), fields: model.fields.map(() => ''), tags: [] }));
    setTags(''); setPreview(false); media.current = { ...a.media };
  }
  async function insert(files, index) {
    if (working || !files.length) return;
    if (!refs.current[index]?.ready()) { notify('Aguarde o editor abrir para adicionar mídia.'); return; }
    const field = refs.current[index], bookmark = field?.capture();
    setWorking(true);
    try {
      let text = '';
      for (const file of files) {
        if (file.size > 32 * 1024 * 1024) throw new Error('Cada mídia deve ter até 32 MiB.');
        const item = await window.desktop.anki.addMedia(new Uint8Array(await file.arrayBuffer()), file.name); media.current[item.name] = item.meta;
        text += item.meta.mime.startsWith('audio/') ? `[sound:${item.name}]` : `<img src="${item.name}">`;
      }
      field?.insert(text, bookmark);
    } catch (e) { field?.cancel(bookmark); notify(e.message); } finally { setWorking(false); }
  }
  function save(e) {
    e.preventDefault(); if (working) return;
    if (!a.decks.some(d => d.id === draft.deckId)) { notify('Selecione um baralho disponível antes de salvar.'); return; }
    if (!draft.fields.some(f => /<img\b|\[sound:/i.test(f) || new DOMParser().parseFromString(f, 'text/html').body.textContent.trim())) { notify('Preencha ao menos um campo.'); return; }
    let ords = model.templates.map((_, i) => i);
    if (model.kind === 1) { ords = [...new Set(draft.fields.flatMap(f => [...f.matchAll(/\{\{c(\d+)::/g)].map(x => Number(x[1]) - 1)))].filter(n => n >= 0 && n < 1000); if (!ords.length) { notify('Use {{c1::texto}} para criar uma omissão.'); return; } }
    const { deckId, isNew, ...note } = draft; note.tags = tags.trim().split(/\s+/).filter(Boolean);
    let cards = a.cards.map(c => c.noteId === note.id ? { ...c, deckId } : c);
    if (isNew) cards = [...cards, ...ords.map(ord => newCard(note.id, deckId, ord, optionsFor(a, a.decks.find(d => d.id === deckId)).insertion === 1 ? Math.random() * 1e12 : Date.now()))];
    // Editing fields preserves existing schedules; cloze changes add newly introduced ordinals.
    else if (model.kind === 1) cards = [...cards, ...ords.filter(ord => !cards.some(c => c.noteId === note.id && c.ord === ord)).map(ord => newCard(note.id, deckId, ord))];
    const next = { ...a, media: { ...a.media, ...media.current }, models: a.models.some(m => m.id === model.id) ? a.models.map(m => m.id === model.id ? model : m) : [...a.models, model], notes: isNew ? [...a.notes, note] : a.notes.map(n => n.id === note.id ? note : n), cards };
    if (!validAnki(next)) { notify('Não foi possível salvar: dados inválidos.'); return; }
    onSave(next, isNew ? { id: crypto.randomUUID(), modelId: model.id, fields: model.fields.map(() => ''), tags: [], deckId, isNew: true } : null);
    if (isNew) notify(ords.length === 1 ? 'Carta criada.' : 'Cartas criadas.');
  }
  return <Modal title={draft.isNew ? 'Criar carta' : 'Editar nota'} wide onClose={reason => { if (!working) onClose(reason, snapshot()); }}><form className="anki-editor" onSubmit={save}><div className="anki-form-grid"><label>Baralho<select aria-label="Baralho" required disabled={working} value={a.decks.some(d => d.id === draft.deckId) ? draft.deckId : ''} onChange={e => setDraft({ ...draft, deckId: e.target.value })}><option value="" disabled>Selecione um baralho</option>{a.decks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>Tipo de nota<select aria-label="Tipo de nota" disabled={working || !draft.isNew} value={draft.modelId} onChange={e => { const m = models.find(m => m.id === e.target.value); setModel(structuredClone(m)); setDraft({ ...draft, modelId: m.id, fields: m.fields.map((_, i) => draft.fields[i] || '') }); }}>{models.map(m => <option key={m.id} value={m.id}>{modelLabel(m.name)}</option>)}</select></label></div>
      {onCreateDeck && <button type="button" className="secondary" disabled={working} onClick={() => onCreateDeck(snapshot())}><Plus size={15} />Criar baralho</button>}
      {model.fields.map((name, index) => <div className="anki-field" key={`${draft.modelId}-${index}`}><span className="anki-field-label">{fieldLabel(name)}</span><AnkiField ref={el => { refs.current[index] = el; }} identity={`${draft.id}-${draft.modelId}-${index}`} autoFocus={!!draft.isNew && index === 0} label={fieldLabel(name)} value={draft.fields[index] || ''} disabled={working} onChange={html => setDraft(s => ({ ...s, fields: s.fields.map((v, i) => i === index ? html : v) }))} onFiles={files => insert(files, index)} loadImage={async name => { let key = name; try { key = decodeURIComponent(name); } catch {} const meta = media.current[key]; return meta?.mime.startsWith('image/') ? { bytes: await window.desktop.anki.readMedia(meta), mime: meta.mime } : null; }} /><span className="anki-field-help">Arraste áudio ou imagem aqui <input aria-label={`Adicionar mídia a ${fieldLabel(name)}`} type="file" multiple accept="audio/*,image/png,image/jpeg,image/webp,image/gif" disabled={working || !window.desktop?.anki} onChange={e => { insert([...e.target.files], index); e.target.value = ''; }} /></span></div>)}
      <label>Marcadores<input value={tags} onChange={e => setTags(e.target.value)} placeholder="Separadas por espaço" /></label><div className="anki-actions"><button type="button" onClick={() => setPreview(!preview)}>Prévia</button></div>
      {preview && <CardFace a={{ ...a, notes: [draft], models: [model], media: media.current }} card={{ noteId: draft.id, id: draft.id, ord: 0 }} back preview typed="" autoplay={false} />}
      <div className="modal-actions">{draft.isNew && <button className="secondary" disabled={working} type="button" onClick={clear}>Limpar</button>}<button className="primary" disabled={working} type="submit">{working ? 'Copiando mídia…' : draft.isNew ? 'Criar carta' : 'Salvar nota'}</button>{!draft.isNew && <button type="button" onClick={() => setDeleting(true)}><Trash2 size={16} />Excluir nota e suas cartas</button>}</div>
      {deleting && <div role="alert"><p>Excluir esta nota e todas as cartas dela? O histórico de respostas será preservado.</p><button type="button" onClick={() => onSave({ ...a, notes: a.notes.filter(n => n.id !== draft.id), cards: a.cards.filter(c => c.noteId !== draft.id) })}>Confirmar exclusão</button><button type="button" onClick={() => setDeleting(false)}>Cancelar</button></div>}
    </form></Modal>;
}

export function AnkiDeckEditor({ a, initial, plans = [], Modal, notify, onClose, onSave }) {
  const [draft, setDraft] = useState(initial);
  function save(event) {
    event.preventDefault(); const name = draft.name.trim();
    if (!name || a.decks.some(d => d.name === name && d.id !== draft.id)) { notify('Use um nome único para o baralho.'); return; }
    onSave({ ...draft, id: draft.id || crypto.randomUUID(), name, presetId: draft.presetId || a.presets[0].id, planIds: draft.planIds || [] });
  }
  return <Modal title={draft.id ? 'Editar baralho' : 'Criar baralho'} small onClose={onClose}><form className="editor-form anki-deck-form" onSubmit={save}><label>Nome<input autoFocus required maxLength={200} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label><fieldset><legend>Planos vinculados (opcional)</legend>{plans.map(plan => <label className="anki-check" key={plan.id}><input type="checkbox" checked={!!draft.planIds?.includes(plan.id)} onChange={e => setDraft({ ...draft, planIds: e.target.checked ? [...(draft.planIds || []), plan.id] : draft.planIds.filter(id => id !== plan.id) })} />{plan.name}</label>)}{!plans.length && <p className="muted">Nenhum plano criado ainda.</p>}</fieldset><div className="modal-actions"><button className="secondary" type="button" onClick={() => onClose('close')}>Cancelar</button><button className="primary" type="submit">{draft.id ? 'Salvar' : 'Criar baralho'}</button></div></form></Modal>;
}


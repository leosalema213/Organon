import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, MoreHorizontal, RefreshCw, Search, Settings, GripVertical } from 'lucide-react';
import Modal from '../Modal.jsx';
import PopupMenu from '../PopupMenu.jsx';
import RichTextField from '../RichTextField.jsx';
import MarkerIcon from './icons.jsx';
import useListDrag from './useListDrag.js';
import useCardDrag from './useCardDrag.js';
import { reorderedLists } from './list-drag.js';
import { BOARD_COLORS, LIST_COLORS, ICON_NAMES, plainText, matchesCard, ordered, editorContent, prepareImage } from './model.js';
import './kanban.css';

const empty = { lists: [], cards: [], tags: [], cardTags: [], canWrite: false, canManageTags: false };
const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
function useAsset(api, orgId, boardId, reference) {
  const [state, setState] = useState({ reference: null, data: null });
  useEffect(() => {
    let live = true; setState({ reference, data: null });
    const load = () => { if (reference && orgId && boardId) api.call('kanban', 'getAsset', { orgId, boardId, reference }).then(result => { if (live) setState({ reference, data: result.data }); }).catch(() => {}); };
    load(); window.addEventListener('online', load);
    return () => { live = false; window.removeEventListener('online', load); };
  }, [api, orgId, boardId, reference]);
  return state.reference === reference ? state.data : null;
}
function Asset({ api, orgId, boardId, reference, alt }) {
  const data = useAsset(api, orgId, boardId, reference);
  return data ? <img src={data} alt={alt} loading="lazy" /> : reference ? <span className="kanban-image-pending">Imagem indisponível</span> : null;
}
function ColorField({ value, onChange, board = false }) {
  return <div className="kanban-colors">{(board ? BOARD_COLORS : LIST_COLORS).map(color => <button key={color} type="button" aria-label={`Cor ${color}`} aria-pressed={value === color} style={{ background: color }} onClick={() => onChange(color)} />)}<label>Cor personalizada<input type="color" value={value || '#94a3b8'} onChange={e => onChange(e.target.value)} /></label></div>;
}
function FileField({ onChange, label }) { return <label className="kanban-file">{label}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => onChange(e.target.files?.[0] || null)} /></label>; }
function FilePreview({ file }) {
  const [url, setUrl] = useState(null);
  useEffect(() => { if (!file) return; const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next); }, [file]);
  return file && url ? <img className="kanban-file-preview" src={url} alt="Prévia da imagem escolhida" /> : null;
}

function KanbanPage({ api, user, workspace }) {
  const orgId = workspace?.id;
  const [boards, setBoards] = useState([]), [boardId, setBoardId] = useState(null), [data, setData] = useState(empty);
  const [catalog, setCatalog] = useState({ tags: [], canManageTags: false, canCreateBoard: false });
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [query, setQuery] = useState(''), [filterTags, setFilterTags] = useState([]), [searchOpen, setSearchOpen] = useState(false);
  const [form, setForm] = useState(null), [confirm, setConfirm] = useState(null), [file, setFile] = useState(null);
  const context = useRef({ orgId, boardId, userId: user?.id }), generation = useRef(0), boardGeneration = useRef(0), saving = useRef(false);
  const boardRef = useRef(null);
  const listDrag = useListDrag(boardRef, `${orgId}:${boardId}:${user?.id}:${data.canWrite}`, moveList);
  context.current = { orgId, boardId, userId: user?.id };
  const board = data.board?.id === boardId ? data.board : boards.find(item => item.id === boardId);
  const background = useAsset(api, orgId, boardId, board?.bg_image_url);
  const loadBoards = useCallback(async () => {
    if (!orgId || !user) return;
    const stamp = ++generation.current;
    try {
      const [rows, markers] = await Promise.all([api.call('kanban', 'getBoards', { orgId }), api.call('kanban', 'getTags', { orgId })]);
      if (stamp !== generation.current || context.current.orgId !== orgId) return;
      setBoards(rows); setCatalog(markers); setBoardId(previous => rows.some(item => item.id === previous) ? previous : rows[0]?.id || null);
    } catch (err) { if (stamp === generation.current) setError(err.message); }
  }, [api, orgId, user?.id]);
  const loadBoard = useCallback(async () => {
    if (!orgId || !boardId || !user) return;
    const stamp = ++boardGeneration.current; setLoading(true);
    try {
      const next = await api.call('kanban', 'getBoard', { orgId, boardId });
      if (stamp !== boardGeneration.current || context.current.orgId !== orgId || context.current.boardId !== boardId) return;
      setData(next);
    } catch (err) {
      if (stamp === boardGeneration.current) { setData(empty); setError(err.message); }
    } finally { if (stamp === boardGeneration.current) setLoading(false); }
  }, [api, orgId, boardId, user?.id]);
  useEffect(() => {
    generation.current++; boardGeneration.current++; setBoards([]); setBoardId(null); setData(empty); setForm(null); setConfirm(null); setFile(null); setQuery(''); setFilterTags([]); setError('');
    loadBoards();
    return () => { generation.current++; boardGeneration.current++; };
  }, [loadBoards]);
  useEffect(() => { setData(empty); setFilterTags([]); setForm(null); setConfirm(null); setFile(null); loadBoard(); }, [loadBoard]);
  useEffect(() => {
    if (!orgId || !user) return;
    const refresh = event => { if (saving.current) return; if (!event?.orgId || event.orgId === orgId) { loadBoards(); if (!event?.boardId || event.boardId === boardId) loadBoard(); } };
    const unsubscribe = api.subscribe('kanban', refresh);
    const reconnect = () => refresh();
    window.addEventListener('online', reconnect); window.addEventListener('focus', reconnect);
    return () => { unsubscribe?.(); window.removeEventListener('online', reconnect); window.removeEventListener('focus', reconnect); };
  }, [api, orgId, boardId, loadBoards, loadBoard, user?.id]);
  async function run(job, { close = true } = {}) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError('');
    const origin = { ...context.current };
    try {
      const result = await job();
      if (context.current.orgId !== origin.orgId || context.current.userId !== origin.userId) return;
      if (close) { setForm(null); setConfirm(null); setFile(null); }
      if (result?.selectBoard) setBoardId(result.selectBoard);
      await loadBoards(); await loadBoard();
    } catch (err) {
      if (context.current.orgId === origin.orgId && context.current.userId === origin.userId) setError(err.message);
    } finally { saving.current = false; setBusy(false); }
  }
  const call = (action, payload) => api.call('kanban', action, { orgId, boardId, ...payload });
  function open(type, record = {}) {
    setFile(null); setError('');
    const defaults = type === 'board' ? { name: '', bg_type: 'none', bg_color: '#c7d2fe', bg_image_url: null, bg_size: 'cover' } : type === 'list' ? { name: '', color: '#475569' } : type === 'tag' ? { name: '', color: '#b91c1c', icon: 'Tag' } : { title: '', description: '', price: '', thumbnail_url: null, list_id: data.lists[0]?.id, tagIds: [] };
    setForm({ ...defaults, ...record, type, expectedRevision: record.revision, ...(type === 'card' && record.id ? { tagIds: data.cardTags.filter(link => link.card_id === record.id).map(link => link.tag_id) } : {}) });
  }
  function change(key, value) { setForm(previous => ({ ...previous, [key]: value })); }
  function save(e) {
    e.preventDefault();
    run(async () => {
      let current = { ...form };
      // Allocate board before uploading, so Storage can authorize the real resource.
      if (current.type === 'board' && !current.id) {
        const created = await call('saveBoard', { ...current, bg_image_url: null });
        current = { ...current, ...created, expectedRevision: created.revision };
        setForm(previous => previous ? { ...previous, id: created.id, expectedRevision: created.revision } : previous);
        if (!file) return { selectBoard: created.id };
      }
      if (file) {
        const result = await call('uploadAsset', { boardId: current.type === 'board' ? current.id : boardId, kind: current.type === 'board' ? 'background' : 'thumbnail', data: await prepareImage(file, current.type === 'board' ? 'background' : 'thumbnail') });
        current[current.type === 'board' ? 'bg_image_url' : 'thumbnail_url'] = result.reference;
      }
      await call(`save${current.type[0].toUpperCase()}${current.type.slice(1)}`, { ...current, boardId: current.type === 'board' ? current.id : boardId, listId: current.list_id });
      if (current.type === 'board') return { selectBoard: current.id };
    });
  }
  function remove(type, record) { setConfirm({ type, record, name: record.name || record.title }); }
  function moveCard(card, listId, beforeId = null) {
    if (saving.current || !data.canWrite || !data.lists.some(list => list.id === listId)) return;
    const previous = data.cards;
    const source = ordered(previous.filter(item => item.list_id === card.list_id));
    if (!source.some(item => item.id === card.id && item.revision === card.revision)) return;
    const destination = listId === card.list_id ? source : ordered(previous.filter(item => item.list_id === listId));
    if (beforeId !== null && !destination.some(item => item.id === beforeId)) return;
    const next = reorderedLists(listId === card.list_id ? source : [...destination, card], card.id, beforeId);
    if (listId === card.list_id && next === source) return;
    const positions = new Map(next.map((item, position) => [item.id, position]));
    const optimistic = previous.map(item => positions.has(item.id) ? { ...item, list_id: listId, position: positions.get(item.id) } : item);
    setData(current => ({ ...current, cards: optimistic }));
    run(async () => {
      try { await call('moveCard', { id: card.id, expectedRevision: card.revision, listId, beforeId }); }
      catch (error) {
        setData(current => current.cards === optimistic ? { ...current, cards: previous } : current);
        throw error;
      }
    }, { close: false });
  }
  function moveList(list, beforeId) {
    if (saving.current || !data.canWrite) return;
    const previous = data.lists, sorted = ordered(previous), next = reorderedLists(sorted, list.id, beforeId);
    if (next === sorted) return;
    setData(current => ({ ...current, lists: next.map((item, position) => ({ ...item, position })) }));
    run(async () => {
      try { await call('moveList', { id: list.id, expectedRevision: list.revision, beforeId }); }
      catch (err) { if (context.current.boardId === boardId && context.current.orgId === orgId) setData(current => ({ ...current, lists: previous })); throw err; }
    }, { close: false });
  }
  const visible = useMemo(() => data.cards.filter(card => matchesCard(card, query, filterTags, data.cardTags)), [data.cards, query, filterTags, data.cardTags]);
  const cardsByList = useMemo(() => {
    const groups = new Map();
    for (const card of ordered(visible)) {
      if (!groups.has(card.list_id)) groups.set(card.list_id, []);
      groups.get(card.list_id).push(card);
    }
    return groups;
  }, [visible]);
  const markersByCard = useMemo(() => {
    const links = new Map(), groups = new Map();
    for (const link of data.cardTags) {
      if (!links.has(link.card_id)) links.set(link.card_id, new Set());
      links.get(link.card_id).add(link.tag_id);
    }
    for (const [cardId, ids] of links) groups.set(cardId, data.tags.filter(tag => ids.has(tag.id)));
    return groups;
  }, [data.cardTags, data.tags]);
  const filtered = !!query.trim() || filterTags.length > 0;
  const lists = useMemo(() => ordered(data.lists), [data.lists]);
  const blocked = busy || !data.canWrite;
  const startCardDrag = useCardDrag(boardRef, boardId, data.cards, data.lists, blocked || filtered, moveCard);
  const tags = data.board ? data.tags : catalog.tags;
  const canManageTags = data.board ? data.canManageTags : catalog.canManageTags;
  const boardStyle = board?.bg_type === 'color' ? { backgroundColor: board.bg_color } : board?.bg_type === 'image' && background ? { backgroundImage: `url("${background}")`, backgroundSize: board.bg_size === 'repeat' ? 'auto' : 'cover', backgroundRepeat: board.bg_size === 'repeat' ? 'repeat' : 'no-repeat', backgroundPosition: 'center' } : {};

  if (!user || !orgId) return <section className="kanban-page"><h1>Quadros</h1><p>Entre na sua conta e selecione um espaço para acessar os quadros.</p></section>;
  return <section className="kanban-page" aria-label="Quadros">
    <div className="page-heading"><h1>Quadros</h1><div className="button-row"><button className="secondary" disabled={busy} onClick={() => { setError(''); loadBoards(); loadBoard(); }}><RefreshCw size={15} />Atualizar</button><PopupMenu label="Novo" icon={Plus} items={[{ id: 'board', label: 'Quadro', disabled: busy || !catalog.canCreateBoard, onSelect: () => open('board') }, { id: 'list', label: 'Coluna', disabled: !board || blocked, onSelect: () => open('list') }, { id: 'card', label: 'Cartão', disabled: !board || blocked || !lists.length, onSelect: () => open('card') }, { id: 'tag', label: 'Marcador', disabled: busy || !canManageTags, onSelect: () => open('tag') }]} /></div></div>
    {error && <div className="kanban-error" role="alert">{error}{form && <p>Seu rascunho continua aberto. Em caso de conflito, copie as alterações e reabra o registro atualizado antes de salvar.</p>}</div>}
    <div className="kanban-toolbar"><select aria-label="Selecionar quadro" value={boardId || ''} disabled={busy} onChange={e => { setBoardId(e.target.value); setQuery(''); }}><option value="" disabled>Selecione</option>{boards.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{board && <div className="kanban-toolbar-actions"><button type="button" className={`icon-button kanban-search-toggle${filtered ? ' has-filters' : ''}`} title={filtered ? 'Buscar e filtrar cartões (filtros ativos)' : 'Buscar e filtrar cartões'} aria-label={filtered ? 'Buscar e filtrar cartões (filtros ativos)' : 'Buscar e filtrar cartões'} aria-expanded={searchOpen} aria-controls="kanban-filters" onClick={() => setSearchOpen(value => !value)}><Search size={16} /></button><PopupMenu label="Ações do quadro" icon={Settings} iconOnly className="icon-button" items={[{ id: 'edit', label: 'Editar quadro e fundo', disabled: blocked, onSelect: () => open('board', board) }, { id: 'delete', label: 'Excluir quadro', disabled: blocked, onSelect: () => remove('board', board) }]} /></div>}</div>
    {board && <><div id="kanban-filters" className="kanban-filters" hidden={!searchOpen}><div className="kanban-search"><Search size={16} /><input aria-label="Buscar cartões" placeholder="Buscar por título ou descrição" value={query} onChange={e => setQuery(e.target.value)} />{filtered && <button onClick={() => { setQuery(''); setFilterTags([]); }}>Limpar filtros</button>}</div><div className="kanban-markers" aria-label="Filtrar marcadores">{data.tags.map(tag => <button type="button" key={tag.id} className="kanban-marker" aria-pressed={filterTags.includes(tag.id)} style={{ '--marker': tag.color }} onClick={() => setFilterTags(previous => previous.includes(tag.id) ? previous.filter(id => id !== tag.id) : [...previous, tag.id])}><MarkerIcon name={tag.icon} />{tag.name}</button>)}</div>{filtered && <details className="kanban-results"><summary>{visible.length} resultado(s)</summary><div>{visible.map(card => <button key={card.id} onClick={() => open('card', card)}>{card.title}<small>{lists.find(list => list.id === card.list_id)?.name}</small></button>)}</div></details>}</div>
      {!data.canWrite && !loading && <p className="muted">Este quadro está disponível para consulta.</p>}
      <div ref={boardRef} className={`kanban-board${listDrag.preview ? ' is-sorting-lists' : ''}`} style={boardStyle} aria-busy={loading || busy}>
        {loading && !data.board && <p role="status">Carregando quadro…</p>}
        {lists.map((list, index) => <section data-list-id={list.id} className={`kanban-column${listDrag.preview?.id === list.id ? ' is-dragging-list' : ''}`} key={list.id} aria-label={list.name}>
          <header style={{ borderTopColor: list.color }} draggable={!blocked} onDragStart={e => listDrag.start(e, list)} title="Arrastar lista para reordenar"><span aria-hidden="true"><GripVertical size={15} /></span><h2>{list.name}</h2><small>{(cardsByList.get(list.id)?.length || 0)}</small><PopupMenu label={`Ações de ${list.name}`} icon={MoreHorizontal} iconOnly className="icon-button" items={[{ id: 'edit', label: 'Editar coluna', disabled: blocked, onSelect: () => open('list', list) }, { id: 'left', label: 'Mover coluna à esquerda', disabled: blocked || index === 0, onSelect: () => moveList(list, lists[index - 1].id) }, { id: 'right', label: 'Mover coluna à direita', disabled: blocked || index === lists.length - 1, onSelect: () => moveList(list, lists[index + 2]?.id || null) }, { id: 'delete', label: 'Excluir coluna e seus cartões', disabled: blocked, onSelect: () => remove('list', list) }]} /></header>
          <div className="kanban-cards">{(cardsByList.get(list.id) || []).map((card, cardIndex, columnCards) => <article key={card.id} data-card-id={card.id} className="kanban-card" draggable={!blocked && !filtered} onDragStart={event => startCardDrag(event, card)}>
            {card.thumbnail_url && <Asset api={api} orgId={orgId} boardId={boardId} reference={card.thumbnail_url} alt={`Miniatura de ${card.title}`} />}
            <div className="kanban-card-top"><button className="kanban-card-title" onClick={() => open('card', card)}>{card.title}</button><PopupMenu label={`Ações de ${card.title}`} icon={MoreHorizontal} iconOnly className="icon-button" items={[{ id: 'edit', label: 'Editar cartão', disabled: blocked, onSelect: () => open('card', card) }, { id: 'up', label: 'Mover para cima', disabled: blocked || filtered || cardIndex === 0, onSelect: () => moveCard(card, list.id, columnCards[cardIndex - 1].id) }, { id: 'down', label: 'Mover para baixo', disabled: blocked || filtered || cardIndex === columnCards.length - 1, onSelect: () => moveCard(card, list.id, columnCards[cardIndex + 2]?.id || null) }, ...lists.filter(target => target.id !== list.id).map(target => ({ id: target.id, label: `Mover para ${target.name}`, disabled: blocked, onSelect: () => moveCard(card, target.id) })), { id: 'delete', label: 'Excluir cartão', disabled: blocked, onSelect: () => remove('card', card) }]} /></div>
            {card.description && <p className="kanban-description">{plainText(card.description)}</p>}{card.price != null && <strong className="kanban-price">{money(card.price)}</strong>}
            <div className="kanban-markers">{(markersByCard.get(card.id) || []).map(tag => <span className="kanban-marker" key={tag.id} style={{ '--marker': tag.color }}><MarkerIcon name={tag.icon} />{tag.name}</span>)}</div>
          </article>)}{!cardsByList.has(list.id) && <p className="muted">{filtered ? 'Nenhum cartão corresponde aos filtros.' : 'Nenhum cartão nesta coluna.'}</p>}</div>
          <button className="kanban-add" disabled={blocked} onClick={() => open('card', { list_id: list.id })}><Plus size={15} />Adicionar cartão</button>
        </section>)}{!loading && !lists.length && <p>Nenhuma coluna. Crie uma coluna para começar.</p>}
      </div></>}
    {!boards.length && <p className="kanban-empty">Nenhum quadro disponível neste espaço. Crie seu primeiro quadro ou atualize após receber acesso.</p>}

    {form && <Modal title={form.type === 'tag' ? 'Marcadores' : `${form.id ? 'Editar' : 'Novo'} ${form.type === 'board' ? 'quadro' : form.type === 'list' ? 'coluna' : 'cartão'}`} wide={form.type === 'card'} onClose={() => { if (!busy) { setForm(null); setFile(null); } }}>
      {form.type === 'tag' && <div className="kanban-tag-manager">{tags.map(tag => <div key={tag.id}><span className="kanban-marker" style={{ '--marker': tag.color }}><MarkerIcon name={tag.icon} />{tag.name}</span><button disabled={busy} onClick={() => open('tag', tag)}>Editar</button><button disabled={busy} onClick={() => remove('tag', tag)}>Excluir</button></div>)}</div>}
      <form className="kanban-form" onSubmit={save}>
        <fieldset disabled={busy || (['card','list'].includes(form.type) && !data.canWrite) || (form.type === 'tag' && !canManageTags)}>
          <label>{form.type === 'card' ? 'Título' : 'Nome'}<input autoFocus required maxLength={form.type === 'card' ? 1000 : form.type === 'tag' ? 150 : 300} value={form.type === 'card' ? form.title : form.name} onChange={e => change(form.type === 'card' ? 'title' : 'name', e.target.value)} /></label>
          {form.type === 'board' && <><label>Fundo<select value={form.bg_type} onChange={e => change('bg_type', e.target.value)}><option value="none">Sem fundo</option><option value="color">Cor</option><option value="image">Imagem</option></select></label>{form.bg_type === 'color' && <ColorField board value={form.bg_color} onChange={value => change('bg_color', value)} />}{form.bg_type === 'image' && <><FilePreview file={file} />{!file && form.bg_image_url && <Asset api={api} orgId={orgId} boardId={form.id} reference={form.bg_image_url} alt="Fundo atual" />}<FileField label={file ? file.name : 'Escolher imagem de fundo'} onChange={setFile} /><button type="button" onClick={() => { setFile(null); change('bg_image_url', null); }}>Remover imagem</button><label>Ajuste<select value={form.bg_size} onChange={e => change('bg_size', e.target.value)}><option value="cover">Preencher</option><option value="repeat">Repetir</option></select></label></>}</>}
          {(form.type === 'list' || form.type === 'tag') && <ColorField value={form.color} onChange={value => change('color', value)} />}
          {form.type === 'tag' && <><label>Ícone</label><div className="kanban-icons">{ICON_NAMES.map(name => <button key={name} title={name} aria-label={name} aria-pressed={name === form.icon} type="button" onClick={() => change('icon', name)}><MarkerIcon name={name} size={18} /></button>)}</div><span className="kanban-marker" style={{ '--marker': form.color }}><MarkerIcon name={form.icon} />{form.name || 'Marcador'}</span></>}
          {form.type === 'card' && <>
            {!form.id && <label>Coluna<select required value={form.list_id || ''} onChange={e => change('list_id', e.target.value)}>{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>}
            <label>Descrição (opcional)</label><RichTextField identity={`${orgId}:${form.id || 'new'}:${form.type}`} label="Descrição do cartão" content={editorContent(form.description)} disabled={blocked} onChange={value => change('description', value.html)} loadImage={async reference => { const result = await call('getAsset', { reference }); if (!result.data) return null; const [header, body] = result.data.split(','); return { mime: header.slice(5, header.indexOf(';')), bytes: Uint8Array.from(atob(body), char => char.charCodeAt(0)) }; }} />
            <details><summary>Editar texto/HTML original</summary><textarea aria-label="Descrição original" value={form.description} maxLength={200000} onChange={e => change('description', e.target.value)} /><p className="muted">O conteúdo original é preservado até você editar. Para reapresentar alterações deste campo no editor, feche e reabra o cartão após salvar.</p></details>
            <label>Preço / valor (opcional)<input inputMode="decimal" placeholder="0,00" value={form.price ?? ''} onChange={e => change('price', e.target.value)} /></label><FilePreview file={file} />{!file && form.thumbnail_url && <Asset api={api} orgId={orgId} boardId={boardId} reference={form.thumbnail_url} alt="Miniatura atual" />}<FileField label={file ? file.name : 'Adicionar miniatura'} onChange={setFile} /><button type="button" onClick={() => { setFile(null); change('thumbnail_url', null); }}>Remover miniatura</button>
            <label>Marcadores</label><div className="kanban-markers">{data.tags.map(tag => <button type="button" key={tag.id} className="kanban-marker" aria-pressed={form.tagIds.includes(tag.id)} style={{ '--marker': tag.color }} onClick={() => change('tagIds', form.tagIds.includes(tag.id) ? form.tagIds.filter(id => id !== tag.id) : [...form.tagIds, tag.id])}><MarkerIcon name={tag.icon} />{tag.name}</button>)}</div>{!data.tags.length && <p className="muted">Nenhum marcador disponível.</p>}
          </>}
        </fieldset>
        {error && <p className="kanban-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={() => { setForm(null); setFile(null); }}>Fechar</button>{form.type === 'tag' && form.id && <button type="button" className="secondary" disabled={busy} onClick={() => open('tag')}>Novo marcador</button>}<button className="primary" disabled={busy || (['card','list'].includes(form.type) && !data.canWrite) || (form.type === 'tag' && !canManageTags)}>{busy ? 'Salvando…' : 'Salvar'}</button></div>
      </form>
    </Modal>}
    {confirm && <Modal small title="Confirmar exclusão" onClose={() => { if (!busy) setConfirm(null); }}><p>Excluir “{confirm.name}”?</p>{['board','list'].includes(confirm.type) && <p>Os cartões e vínculos dentro {confirm.type === 'board' ? 'do quadro' : 'da coluna'} também serão excluídos.</p>}{confirm.type === 'tag' && <p>O marcador será removido de todos os cartões do espaço.</p>}{error && <p className="kanban-error" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary" disabled={busy} onClick={() => setConfirm(null)}>Cancelar</button><button className="primary kanban-danger" disabled={busy} onClick={() => run(() => call(`delete${confirm.type[0].toUpperCase()}${confirm.type.slice(1)}`, { id: confirm.record.id, expectedRevision: confirm.record.revision }))}>{busy ? 'Excluindo…' : 'Excluir'}</button></div></Modal>}
  </section>;
}

export default React.memo(function Kanban(props) {
  return <KanbanPage key={`${props.user?.id || 'anonymous'}:${props.workspace?.id || 'none'}`} {...props} />;
});

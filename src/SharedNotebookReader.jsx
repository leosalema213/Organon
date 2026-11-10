import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, Users } from 'lucide-react';
import { seed, validateData } from './model.js';
import { waitForImages } from './images.js';
import { mergeSharedNotebook, notebookEqual } from './shared-notebook-merge.js';

export default function SharedNotebookReader({ userId, notebook, api, onClose, onCopy, onSynced, copying, notify, Modal, Sketch, Editor }) {
  const [opened, setOpened] = useState(null), [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [members, setMembers] = useState([]), [now, setNow] = useState(Date.now());
  const [comparison, setComparison] = useState(null), [comparing, setComparing] = useState(false), [choices, setChoices] = useState({});
  const mounted = useRef(false), working = useRef(null), base = useRef(null), dirty = useRef(false), timer = useRef(null), sequence = useRef(0);
  const refreshRef = useRef(), refreshPending = useRef(false);
  const draftRef = useRef(draft); draftRef.current = draft;
  const synced = useRef(onSynced); synced.current = onSynced;
  const recoveryKey = `organon:shared-notebook-draft:${userId}:${notebook.orgId}:${notebook.id}`;
  const recovery = useRef(null);
  const sent = useRef(null);
  const comparisonRef = useRef(comparison); comparisonRef.current = comparison;
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(recoveryKey) || 'null');
      if (stored?.base?.id === notebook.id && stored?.content?.id === notebook.id) recovery.current = stored;
    } catch { /* An incomplete recovery record does not replace the authorized server copy. */ }
  }, [recoveryKey]);
  function remember() {
    try { localStorage.setItem(recoveryKey, JSON.stringify({ base: base.current.content, content: draftRef.current, sent: sent.current })); }
    catch { notify('Não foi possível guardar o rascunho local. Mantenha o caderno aberto até concluir o salvamento.'); }
  }
  function forget() { recovery.current = null; sent.current = null; localStorage.removeItem(recoveryKey); }
  function mergeDraft(remote, previous) {
    // A response may be lost after the write committed. Recognize our own snapshot.
    const before = previous || (sent.current && notebookEqual(sent.current, remote.content) ? sent.current : base.current.content);
    try { return mergeSharedNotebook(before, draftRef.current, remote.content); }
    catch (error) {
      if (error.conflicts) { setComparison({ before, local: draftRef.current, remote, conflicts: error.conflicts }); setChoices({}); }
      throw error;
    }
  }
  useEffect(() => {
    let active = true;
    api.call('teams', 'roster', { orgId: notebook.orgId }).then(value => { if (active) setMembers(value); }).catch(() => {});
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { active = false; clearInterval(tick); };
  }, [api, notebook.orgId]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(timer.current); sequence.current++; }; }, []);
  useEffect(() => {
    let active = true;
    async function refresh() {
      if (working.current) { refreshPending.current = true; return; }
      const request = ++sequence.current;
      try {
        const result = await api.call('teams', 'openResource', { orgId: notebook.orgId, module: 'notebooks', resourceId: notebook.id });
        const content = validateData({ ...seed(), notebooks: [result.content] }).notebooks[0];
        if (active && request === sequence.current && !working.current) {
          setOpened(result);
          if (comparisonRef.current) return;
          if (dirty.current) {
            if (base.current.revision === result.revision) { base.current.canWrite = result.canWrite; setError(''); return; }
            const merged = mergeDraft({ ...result, content });
            base.current = { ...result, content }; draftRef.current = merged; remember(); setDraft(merged);
            setError('');
            return;
          }
          base.current = { ...result, content }; draftRef.current = content; setError('');
          if (recovery.current) {
            const stored = recovery.current; recovery.current = null; dirty.current = true;
            base.current.content = validateData({ ...seed(), notebooks: [stored.base] }).notebooks[0];
            draftRef.current = validateData({ ...seed(), notebooks: [stored.content] }).notebooks[0];
            sent.current = stored.sent || null;
          } else synced.current?.(content);
          setDraft(draftRef.current);
        }
      } catch (error) { if (active && request === sequence.current) setError(error.message); }
    }
    refreshRef.current = refresh;
    refresh();
    let checking = false;
    async function checkVersion() {
      if (checking || !base.current) return;
      checking = true;
      try {
        const value = await api.call('teams', 'resourceVersion', { orgId: notebook.orgId, module: 'notebooks', resourceId: notebook.id });
        if (active && (value.revision !== base.current.revision || value.canWrite !== base.current.canWrite)) await refresh();
      } catch (error) { if (active) setError(error.message); }
      finally { checking = false; }
    }
    const poll = setInterval(checkVersion, 3000);
    const stop = api.subscribe('teams', event => { if (event.type !== 'connection') refresh(); });
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh);
    return () => { active = false; clearInterval(poll); stop(); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); };
  }, [api, notebook.orgId, notebook.id, notebook.revision, retry]);
  async function save() {
    clearTimeout(timer.current);
    timer.current = null;
    if (working.current) return working.current;
    if (!dirty.current) return true;
    sequence.current++;
    const pending = flush(); working.current = pending;
    return pending;
  }
  async function flush() {
    setBusy(true); setError('');
    try {
      let conflicts = 0, lastSent = 0;
      while (dirty.current && mounted.current) {
        const delay = 500 - (Date.now() - lastSent);
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        if (!mounted.current) return false;
        lastSent = Date.now();
        await waitForImages();
        const remote = await api.call('teams', 'openResource', { orgId: notebook.orgId, module: 'notebooks', resourceId: notebook.id });
        if (!mounted.current) return false;
        setOpened(remote);
        if (!remote.canWrite) throw new Error('Você não tem mais permissão para editar. Seu rascunho foi preservado.');
        const content = validateData({ ...seed(), notebooks: [remote.content] }).notebooks[0];
        const snapshot = draftRef.current;
        const merged = mergeDraft({ ...remote, content });
        // Focus/selection and retries of an already committed write need no revision.
        if (notebookEqual(merged, content)) {
          base.current = { ...remote, content }; dirty.current = false; draftRef.current = content;
          forget(); setComparison(null); setDraft(content); synced.current?.(content);
          continue;
        }
        let result;
        try {
          sent.current = merged; remember();
          result = await api.call('teams', 'editResource', { orgId: notebook.orgId, module: 'notebooks', resourceId: notebook.id, revision: remote.revision, content: merged });
        } catch (error) {
          if (/registro mudou/.test(error.message) && conflicts++ < 2) continue;
          throw error;
        }
        if (!mounted.current) return false;
        const changedDuringSave = !notebookEqual(draftRef.current, snapshot);
        const next = changedDuringSave ? mergeDraft({ ...remote, ...result, content: merged }, snapshot) : merged;
        base.current = { ...remote, ...result, content: merged };
        sent.current = null; setComparison(null);
        setOpened(base.current);
        synced.current?.(merged);
        // Changes typed while the request was pending remain queued for the next revision.
        dirty.current = changedDuringSave;
        draftRef.current = next;
        if (dirty.current) remember(); else forget();
        setDraft(draftRef.current);
      }
      api.refresh();
      return true;
    } catch (error) { if (mounted.current) setError(error.message); return false; }
    finally {
      working.current = null;
      if (mounted.current) {
        setBusy(false);
        if (!dirty.current && refreshPending.current) { refreshPending.current = false; refreshRef.current?.(); }
      }
    }
  }
  useEffect(() => {
    if (error) { clearTimeout(timer.current); timer.current = null; }
    else if (dirty.current && opened?.canWrite && !comparison && !timer.current) timer.current = setTimeout(save, 500);
  }, [draft, error, opened?.canWrite, comparison]);
  const close = async () => { if (await save()) onClose(); };
  async function resolveComparison() {
    const merged = mergeSharedNotebook(comparison.before, comparison.local, comparison.remote.content, choices);
    base.current = comparison.remote; draftRef.current = merged; dirty.current = true; sent.current = null;
    remember(); setDraft(merged); setComparison(null); setComparing(false); setError('');
    await save();
  }
  function describe(value) {
    if (value === undefined) return 'Removido nesta versão';
    if (value === null) return '(vazio)';
    if (typeof value !== 'object' && typeof value !== 'string') return String(value);
    if (typeof value === 'string') return /^data:image\//.test(value) ? 'Imagem anexada' : value || '(vazio)';
    if (Array.isArray(value)) return value.map(describe).join('\n');
    if (value.type === 'image') return 'Imagem anexada';
    if (value.type === 'text') return value.text;
    if (value.content) return value.content.map(describe).join('\n');
    const labels = { title: 'Título', name: 'Nome', text: 'Texto', document: 'Conteúdo', images: 'Imagens', cover: 'Capa', color: 'Cor', date: 'Data', icon: 'Ícone', marks: 'Formatação', attrs: 'Formato', size: 'Tamanho', level: 'Nível', type: 'Tipo', bold: 'Negrito', italic: 'Itálico', underline: 'Sublinhado' };
    return Object.entries(value).filter(([key]) => key !== 'id').map(([key, item]) => `${labels[key] || key}: ${typeof item === 'object' && item !== null ? describe(item) : labels[item] || String(item)}`).join('\n');
  }
  function preview(value) {
    const images = new Set();
    function visit(item) {
      if (typeof item === 'string' && /^data:image\//.test(item)) images.add(item);
      else if (item && typeof item === 'object') Object.values(item).forEach(visit);
    }
    visit(value);
    return <><pre>{describe(value)}</pre>{[...images].map((src, index) => <img className="journal-conflict-image" key={index} src={src} alt="Imagem nesta versão" />)}</>;
  }
  const editedAt = Date.parse(opened?.last_edited_at), editorId = opened?.last_edited_by;
  const activeEditor = editorId && editorId !== userId && now - editedAt >= -1000 && now - editedAt < 5000;
  const editorName = members.find(member => member.user_id === editorId);
  return <section className="journal-shared-reader">
    {error && <div role="alert" className="form-error journal-sync-error"><span>{error}</span><button className="secondary" disabled={busy} onClick={() => comparison ? setComparing(true) : dirty.current ? save() : setRetry(value => value + 1)}>{comparison ? 'Comparar versões' : 'Sincronizar'}</button></div>}
    {comparing && comparison && <Modal title="Comparar versões do caderno" wide onClose={() => setComparing(false)}>
      <p>Escolha qual versão manter em cada trecho. As demais alterações serão mescladas no mesmo caderno.</p>
      <div className="journal-conflicts">{comparison.conflicts.map(conflict => <fieldset key={conflict.key}><legend>{draft?.pages.find(page => page.id === conflict.path[1])?.title || 'Caderno'} · {({ title: 'Título', name: 'Nome', text: 'Texto', cover: 'Capa', date: 'Data' })[conflict.path.at(-1)] || 'Conteúdo'}</legend><div className="journal-conflict-options">{['local', 'remote'].map(side => <label key={side}><span><input type="radio" aria-label={side === 'local' ? 'Neste dispositivo' : 'No servidor'} name={conflict.key} checked={choices[conflict.key] === side} onChange={() => setChoices(current => ({ ...current, [conflict.key]: side }))} />{side === 'local' ? 'Neste dispositivo' : 'No servidor'}</span>{preview(conflict[side])}</label>)}</div></fieldset>)}</div>
      <div className="modal-actions"><button className="secondary" onClick={() => setComparing(false)}>Decidir depois</button><button className="primary" disabled={comparison.conflicts.some(conflict => !choices[conflict.key]) || busy} onClick={resolveComparison}>Mesclar e sincronizar</button></div>
    </Modal>}
    {!opened && !error && <p role="status">Preparando caderno compartilhado…</p>}
    {!opened && <button className="icon-button" aria-label="Todos os cadernos" onClick={onClose}><ArrowLeft size={19} /></button>}
    {opened && draft && <Editor key={`${notebook.orgId}:${notebook.id}`} notebooks={[draft]} initialBookId={draft.id} onBack={close} readOnly={!opened.canWrite || !!comparison} sharedView saveError={!!error} saveLabel={busy ? 'Salvando…' : dirty.current ? 'Alterações pendentes' : opened.canWrite ? 'Salvo automaticamente' : 'Somente leitura'} headerMark={<span className="journal-shared-indicator" title="Caderno compartilhado" role="img" aria-label="Caderno compartilhado"><Users size={14} /></span>} headerActions={<><span className="journal-live-editor" role="status">{activeEditor ? `${editorName?.nickname || editorName?.name || 'Outra pessoa'} editando…` : ''}</span><button className="secondary" disabled={copying || busy} onClick={async () => { if (await save()) onCopy(); }}><Download size={14} />{copying ? 'Baixando…' : 'Baixar cópia'}</button></>} onChange={change => { if (opened.canWrite && !comparison) { const next = (typeof change === 'function' ? change([draftRef.current]) : change)[0]; if (notebookEqual(next, draftRef.current)) return; dirty.current = true; draftRef.current = next; remember(); setDraft(next); } }} notify={notify} Modal={Modal} Sketch={Sketch} />}
  </section>;
}

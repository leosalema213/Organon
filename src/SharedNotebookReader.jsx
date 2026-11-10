import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, Users } from 'lucide-react';
import { seed, validateData } from './model.js';
import { waitForImages } from './images.js';
import { mergeSharedNotebook } from './shared-notebook-merge.js';

export default function SharedNotebookReader({ userId, notebook, api, onClose, onCopy, onRecover, onSynced, copying, notify, Modal, Sketch, Editor }) {
  const [opened, setOpened] = useState(null), [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [members, setMembers] = useState([]), [now, setNow] = useState(Date.now());
  const mounted = useRef(false), working = useRef(null), base = useRef(null), dirty = useRef(false), timer = useRef(null), sequence = useRef(0);
  const refreshRef = useRef(), refreshPending = useRef(false);
  const draftRef = useRef(draft); draftRef.current = draft;
  const synced = useRef(onSynced); synced.current = onSynced;
  const recoveryKey = `organon:shared-notebook-draft:${userId}:${notebook.orgId}:${notebook.id}`;
  const recovery = useRef(null);
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(recoveryKey) || 'null');
      if (stored?.base?.id === notebook.id && stored?.content?.id === notebook.id) recovery.current = stored;
    } catch { /* An incomplete recovery record does not replace the authorized server copy. */ }
  }, [recoveryKey]);
  function remember() {
    try { localStorage.setItem(recoveryKey, JSON.stringify({ base: base.current.content, content: draftRef.current })); }
    catch { notify('Não foi possível guardar o rascunho local. Mantenha o caderno aberto até concluir o salvamento.'); }
  }
  function forget() { recovery.current = null; localStorage.removeItem(recoveryKey); }
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
          if (dirty.current) {
            if (base.current.revision === result.revision) return;
            const merged = mergeSharedNotebook(base.current.content, draftRef.current, content);
            base.current = { ...result, content }; draftRef.current = merged; remember(); setDraft(merged);
            return;
          }
          base.current = { ...result, content }; draftRef.current = content; setError('');
          if (recovery.current) {
            const stored = recovery.current; recovery.current = null; dirty.current = true;
            base.current.content = validateData({ ...seed(), notebooks: [stored.base] }).notebooks[0];
            draftRef.current = validateData({ ...seed(), notebooks: [stored.content] }).notebooks[0];
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
        const merged = mergeSharedNotebook(base.current.content, snapshot, content);
        let result;
        try {
          result = await api.call('teams', 'editResource', { orgId: notebook.orgId, module: 'notebooks', resourceId: notebook.id, revision: remote.revision, content: merged });
        } catch (error) {
          if (/registro mudou/.test(error.message) && conflicts++ < 2) continue;
          throw error;
        }
        if (!mounted.current) return false;
        base.current = { ...remote, ...result, content: merged };
        setOpened(base.current);
        synced.current?.(merged);
        // Changes typed while the request was pending remain queued for the next revision.
        dirty.current = draftRef.current !== snapshot;
        draftRef.current = dirty.current ? mergeSharedNotebook(snapshot, draftRef.current, merged) : merged;
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
    else if (dirty.current && !timer.current) timer.current = setTimeout(save, 500);
  }, [draft, error]);
  const close = async () => { if (await save()) onClose(); };
  const editedAt = Date.parse(opened?.last_edited_at), editorId = opened?.last_edited_by;
  const activeEditor = editorId && editorId !== userId && now - editedAt >= -1000 && now - editedAt < 5000;
  const editorName = members.find(member => member.user_id === editorId);
  return <section className="journal-shared-reader">
    {error && <div role="alert" className="form-error">{error} <button className="secondary" disabled={busy} onClick={() => dirty.current ? save() : setRetry(value => value + 1)}>Tentar novamente</button>{(dirty.current || recovery.current) && <button className="secondary" disabled={busy || copying} onClick={async () => { if (await onRecover(dirty.current ? draftRef.current : recovery.current.content)) { dirty.current = false; forget(); setRetry(value => value + 1); } }}>Baixar cópia do rascunho</button>}</div>}
    {!opened && !error && <p role="status">Preparando caderno compartilhado…</p>}
    {!opened && <button className="icon-button" aria-label="Todos os cadernos" onClick={onClose}><ArrowLeft size={19} /></button>}
    {opened && draft && <Editor key={`${notebook.orgId}:${notebook.id}`} notebooks={[draft]} initialBookId={draft.id} onBack={close} readOnly={!opened.canWrite} sharedView saveError={!!error} saveLabel={busy ? 'Salvando…' : dirty.current ? 'Alterações pendentes' : opened.canWrite ? 'Salvo automaticamente' : 'Somente leitura'} headerMark={<span className="journal-shared-indicator" title="Caderno compartilhado" role="img" aria-label="Caderno compartilhado"><Users size={14} /></span>} headerActions={<><span className="journal-live-editor" role="status">{activeEditor ? `${editorName?.nickname || editorName?.name || 'Outra pessoa'} editando…` : ''}</span><button className="secondary" disabled={copying || busy} onClick={async () => { if (await save()) onCopy(); }}><Download size={14} />{copying ? 'Baixando…' : 'Baixar cópia'}</button></>} onChange={change => { if (opened.canWrite) { const next = (typeof change === 'function' ? change([draftRef.current]) : change)[0]; dirty.current = true; draftRef.current = next; remember(); setDraft(next); } }} notify={notify} Modal={Modal} Sketch={Sketch} />}
  </section>;
}

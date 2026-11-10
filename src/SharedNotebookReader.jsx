import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, Pencil, Users } from 'lucide-react';
import { seed, validateData } from './model.js';
import { waitForImages } from './images.js';

export default function SharedNotebookReader({ notebook, api, onClose, onCopy, copying, notify, Modal, Sketch, Editor }) {
  const [opened, setOpened] = useState(null), [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(false), [stale, setStale] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0), [leaving, setLeaving] = useState(false);
  const editingRef = useRef(false), mounted = useRef(false), working = useRef(false);
  const draftRef = useRef(draft); draftRef.current = draft;
  editingRef.current = editing;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (editingRef.current) { setStale(true); return; }
    let active = true;
    setOpened(null); setError('');
    api.call('teams', 'openResource', { orgId: notebook.orgId, module: 'notebooks', resourceId: notebook.id }).then(result => {
      const content = validateData({ ...seed(), notebooks: [result.content] }).notebooks[0];
      if (active) { setOpened(result); setDraft(content); setStale(false); }
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [api, notebook.orgId, notebook.id, notebook.revision, retry]);
  async function save() {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try {
      await waitForImages();
      await api.call('teams', 'editResource', { orgId: notebook.orgId, module: 'notebooks', resourceId: notebook.id, revision: opened.revision, content: draftRef.current });
      api.refresh();
      if (mounted.current) { notify('Caderno compartilhado salvo.'); onClose(); }
    } catch (error) { if (mounted.current) setError(error.message); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }
  const close = () => { if (!busy) editing ? setLeaving(true) : onClose(); };
  return <section className="journal-shared-reader">
    <div className="journal-shared-toolbar"><button className="secondary" disabled={busy} onClick={close}><ArrowLeft size={14} />Todos os cadernos</button><span className="muted"><Users size={14} />Caderno compartilhado</span><div className="button-row">
      <button className="secondary" disabled={busy || copying || !opened || editing} onClick={onCopy}><Download size={14} />{copying ? 'Baixando…' : 'Baixar cópia'}</button>
      {opened?.canWrite && !editing && <button className="secondary" onClick={() => setEditing(true)}><Pencil size={14} />Editar caderno compartilhado</button>}
      {editing && <><button className="secondary" disabled={busy} onClick={() => { setEditing(false); setDraft(structuredClone(opened.content)); setRetry(value => value + 1); }}>Descartar alterações</button><button className="primary" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar alterações'}</button></>}
    </div></div>
    {error && <div role="alert" className="form-error">{error} {!editing && <button className="secondary" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button>}</div>}
    {!opened && !error && <p role="status">Preparando caderno compartilhado…</p>}
    {stale && <p role="status">O caderno mudou em outro lugar. Seu rascunho está preservado; o salvamento verificará a revisão.</p>}
    {opened && draft && <div inert={busy || undefined}><Editor key={`${notebook.orgId}:${notebook.id}`} notebooks={[draft]} initialBookId={draft.id} onBack={close} readOnly={!editing} sharedView saveLabel={editing ? 'Rascunho · salve as alterações' : 'Caderno compartilhado · somente leitura'} onChange={change => { if (editing) { const next = (typeof change === 'function' ? change([draftRef.current]) : change)[0]; draftRef.current = next; setDraft(next); } }} notify={notify} Modal={Modal} Sketch={Sketch} /></div>}
    {leaving && <Modal title="Descartar alterações do caderno?" small onClose={() => setLeaving(false)}><p>Seu rascunho ainda não foi salvo no compartilhamento.</p><div className="modal-actions"><button className="secondary" onClick={() => setLeaving(false)}>Continuar editando</button><button className="primary" onClick={onClose}>Descartar e sair</button></div></Modal>}
  </section>;
}

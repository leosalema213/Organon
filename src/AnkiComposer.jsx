import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { AnkiDeckEditor, AnkiNoteEditor } from './Anki.jsx';
import { bookAnkiDecks, newAnkiDraft } from './book-anki.js';

export default function AnkiComposer({ request, drafts, collection: a, plans, Modal, notify, onChange, onClose }) {
  const [session, setSession] = useState(null);
  useEffect(() => {
    if (!request) { setSession(null); return; }
    const context = request.book ? request.context : request.editor.isNew ? 'new:anki' : `edit:${request.editor.id}`;
    const saved = drafts.current.get(context);
    const linked = request.book ? bookAnkiDecks(a, request.book, plans) : [];
    const editor = saved?.editor || request.editor || (linked.length === 1 ? newAnkiDraft(a, linked[0].id) : null);
    setSession({ key: request.key, context, editor, saved, phase: editor ? 'note' : 'choose', selected: '' });
  }, [request]);
  if (!request || session?.key !== request.key) return null;

  function close(reason, saved) {
    if (saved && reason !== 'close') drafts.current.set(session.context, saved);
    else if (reason === 'close') drafts.current.delete(session.context);
    onClose();
  }
  function choose(deckId, saved = session.saved) {
    const editor = saved ? { ...saved.editor, deckId } : newAnkiDraft(a, deckId);
    setSession(previous => ({ ...previous, phase: 'note', editor, saved: saved ? { ...saved, editor } : null }));
  }
  function createDeck(saved = session.saved) {
    if (saved) drafts.current.set(session.context, saved);
    setSession(previous => ({ ...previous, phase: 'deck', saved, fromNote: !!saved }));
  }
  if (session.phase === 'deck') return <AnkiDeckEditor key={`deck:${session.key}`} a={a} plans={plans} Modal={Modal} notify={notify} initial={{ name: '', planIds: (request.book?.planIds || []).filter(id => plans.some(plan => plan.id === id)) }} onClose={() => setSession(previous => ({ ...previous, phase: previous.fromNote ? 'note' : 'choose', editor: previous.saved?.editor || previous.editor }))} onSave={deck => {
    onChange(current => ({ ...current, decks: [...current.decks, deck] })); choose(deck.id);
  }} />;
  if (session.phase === 'choose') {
    const linked = bookAnkiDecks(a, request.book, plans);
    return <Modal title="Anotar no Anki" small onClose={reason => close(reason)}><form className="anki-editor" onSubmit={event => { event.preventDefault(); if (a.decks.some(deck => deck.id === session.selected)) choose(session.selected); }}>
      <p>{linked.length > 1 ? 'Este livro tem mais de um baralho vinculado pelos planos. Escolha onde criar a carta.' : 'Escolha um baralho para criar a carta sem fechar o livro.'}</p>
      <label>Baralho<select aria-label="Baralho" autoFocus required value={session.selected} onChange={event => setSession(previous => ({ ...previous, selected: event.target.value }))}><option value="" disabled>Selecione um baralho</option>{a.decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select></label>
      <div className="button-row"><button type="button" className="secondary" onClick={() => createDeck()}><Plus size={15} />Criar baralho</button></div>
      <div className="modal-actions"><button type="button" className="secondary" onClick={() => close('close')}>Cancelar</button><button className="primary" disabled={!session.selected} type="submit">Continuar</button></div>
    </form></Modal>;
  }
  // A removed deck must be explicitly replaced; the note editor never saves to a fallback silently.
  const editor = a.decks.some(deck => deck.id === session.editor.deckId) ? session.editor : { ...session.editor, deckId: '' };
  return <AnkiNoteEditor key={session.editor.id} a={a} editor={editor} initialState={session.saved} Modal={Modal} notify={notify} onCreateDeck={createDeck} onClose={close} onSave={(next, following) => {
    onChange(next); drafts.current.delete(session.context);
    if (request.book || !following) onClose();
    else setSession(previous => ({ ...previous, editor: following, saved: null }));
  }} />;
}

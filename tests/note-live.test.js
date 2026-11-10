import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import { remoteNoteTransaction } from '../src/note-live.js';

const schema = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { content: 'inline*', group: 'block' }, text: { group: 'inline' }, image: { group: 'block', atom: true, attrs: { src: {} } } } });
const doc = text => schema.node('doc', null, [schema.node('paragraph', null, text ? [schema.text(text)] : [])]);
test('patch remoto atualiza o texto aberto sem eco e preserva seleção anterior ao trecho', () => {
  const initial = doc('Olá mundo');
  const state = EditorState.create({ schema, doc: initial, selection: TextSelection.create(initial, 2) });
  const transaction = remoteNoteTransaction(state, doc('Olá mundo novo'));
  assert.equal(state.apply(transaction).doc.textContent, 'Olá mundo novo');
  assert.equal(transaction.selection.from, 2);
  assert.equal(transaction.getMeta('preventUpdate'), true);
  assert.equal(transaction.getMeta('addToHistory'), false);
  assert.equal(remoteNoteTransaction(state, state.doc), null);
});
test('desfazer edição local conserva texto remoto e inserção/remoção de imagem', () => {
  let state = EditorState.create({ schema, doc: doc('Base'), plugins: [history()] });
  state = state.apply(state.tr.insertText(' local', 5));
  state = state.apply(remoteNoteTransaction(state, doc('Base local remoto')));
  assert(undo(state, transaction => { state = state.apply(transaction); }));
  assert.equal(state.doc.textContent, 'Base remoto');
  const imageDoc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('Base remoto')]), schema.node('image', { src: 'data:image/png;base64,test' }), schema.node('paragraph')]);
  state = state.apply(remoteNoteTransaction(state, imageDoc));
  assert.equal(state.doc.child(1).attrs.src, 'data:image/png;base64,test');
  state = state.apply(remoteNoteTransaction(state, doc('Sem foto')));
  assert.equal(state.doc.childCount, 1);
  assert.equal(state.doc.textContent, 'Sem foto');
});

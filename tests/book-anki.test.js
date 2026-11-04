import test from 'node:test';
import assert from 'node:assert/strict';
import { bookAnkiDecks, newAnkiDraft } from '../src/book-anki.js';
import { basicModel, emptyAnki } from '../src/anki.js';
import { seed, validateData } from '../src/model.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { packDocument } = require('../electron/cloud-document.cjs');

test('reader resolves decks through existing shared plan links, without changing either record', () => {
  const a = emptyAnki(), plans = [{ id: 'one' }, { id: 'two' }];
  a.decks = [{ id: 'a', planIds: ['one'] }, { id: 'b', planIds: ['one', 'two'] }, { id: 'c', planIds: ['deleted'] }, { id: 'd' }];
  const before = structuredClone(a), book = { planIds: ['one', 'two', 'deleted'] };
  assert.deepEqual(bookAnkiDecks(a, book, plans).map(deck => deck.id), ['a', 'b']);
  assert.deepEqual(bookAnkiDecks(a, { planIds: ['two'] }, plans).map(deck => deck.id), ['b']);
  assert.deepEqual(bookAnkiDecks(a, { planIds: [] }, plans), []);
  assert.deepEqual(bookAnkiDecks(a, { planIds: ['deleted'] }, plans), []);
  assert.deepEqual(a, before); assert.deepEqual(book.planIds, ['one', 'two', 'deleted']);
});

test('new drafts have independent identities and do not enter the backup or sync snapshot', () => {
  const a = emptyAnki(); a.models = [basicModel];
  const first = newAnkiDraft(a, 'deck'), second = newAnkiDraft(a, 'deck');
  assert.notEqual(first.id, second.id); assert.equal(first.deckId, 'deck');
  assert.deepEqual(first.fields, ['', '']); assert.deepEqual(first.tags, []);
  const state = seed(), draftCache = new Map([['new:anki', { editor: first }]]);
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(state))).anki, state.anki);
  assert.equal(JSON.stringify(packDocument(state).payload).includes(first.id), false);
  assert.equal(draftCache.size, 1); assert.equal(a.notes.length, 0); assert.equal(a.cards.length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewAttention } from '../src/useAnkiReviewCount.js';

test('sidebar counts only due learning/review cards and identifies the next boundary without polling', () => {
  const now = 1000;
  const card = (id, patch = {}) => ({ id, state: 2, due: now, deckId: 'deck', noteId: 'note', ...patch });
  const collection = { decks: [{ id: 'deck' }], notes: [{ id: 'note' }], cards: [
    card('review'), card('learn', { state: 1 }), card('relearn', { state: 3 }),
    card('new', { state: 0 }), card('suspended', { suspended: true }), card('unsupported', { unsupported: true }),
    card('missing', { deckId: 'deleted' }), card('orphan', { noteId: 'deleted' }),
    card('buried', { buriedUntil: now + 10 }), card('future', { due: now + 20 }),
  ] };
  assert.deepEqual(reviewAttention(collection, now), { count: 3, nextAt: now + 10 });
  assert.deepEqual(reviewAttention(collection, now + 10), { count: 4, nextAt: now + 20 });
  assert.deepEqual(reviewAttention(collection, now + 20), { count: 5, nextAt: Infinity });
  assert.deepEqual(reviewAttention(undefined, now), { count: 0, nextAt: Infinity });
});

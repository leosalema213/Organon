import test from 'node:test';
import assert from 'node:assert/strict';
import { cardCreatedAt, cardCreatedOn, newCard } from '../src/anki.js';

test('datas de cartas novas, antigas e importadas', () => {
  const timestamp = new Date(2022, 4, 12, 23, 59).getTime();
  const card = newCard('note', 'deck', 0, 123);
  assert.ok(cardCreatedAt(card) >= Date.now() - 1000);
  assert.equal(cardCreatedAt({ position: timestamp }), timestamp);
  assert.equal(cardCreatedAt({ position: 123 }), null);
  assert.equal(cardCreatedAt({ source: { id: timestamp }, position: 123 }), timestamp);
  assert.equal(cardCreatedAt({ source: { id: 123 }, position: timestamp }), null);
  assert.equal(cardCreatedOn({ position: timestamp }, '2022-05-12'), true);
  assert.equal(cardCreatedOn({ position: timestamp }, '2022-05-13'), false);
  assert.equal(cardCreatedOn({}, '2022-05-12'), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { listInsertion, reorderedLists } from '../src/kanban/list-drag.js';

const lists = ['a', 'b', 'c', 'd'].map((id, position) => ({ id, position, revision: 7 }));
const ids = rows => rows.map(row => row.id);
test('list targets use both halves, gaps and the end, excluding the moving list', () => {
  const columns = lists.map((list, i) => ({ ...list, left: i * 300, width: 285 }));
  assert.equal(listInsertion(columns, 'a', 320), 'b');
  assert.equal(listInsertion(columns, 'a', 560), 'c');
  assert.equal(listInsertion(columns, 'a', 595), 'c');
  assert.equal(listInsertion(columns, 'a', 1180), null);
  assert.equal(listInsertion(columns, 'd', 10), 'a');
  const scrolled = columns.map(column => ({ ...column, left: column.left - 600 }));
  assert.equal(listInsertion(scrolled, 'a', 260), 'd');
});
test('moving lists preserves IDs, revisions and records without mutating the server snapshot', () => {
  const snapshot = structuredClone(lists);
  assert.deepEqual(ids(reorderedLists(lists, 'a', 'd')), ['b', 'c', 'a', 'd']);
  assert.deepEqual(ids(reorderedLists(lists, 'a', null)), ['b', 'c', 'd', 'a']);
  const moved = reorderedLists(lists, 'd', 'a');
  assert.deepEqual(ids(moved), ['d', 'a', 'b', 'c']);
  assert.equal(moved[0], lists[3]);
  assert.deepEqual(lists, snapshot);
  for (const [id, before] of [['b', 'c'], ['b', 'b'], ['d', null], ['missing', 'a'], ['a', 'missing']]) assert.equal(reorderedLists(lists, id, before), lists);
});

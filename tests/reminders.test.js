import test from 'node:test';
import assert from 'node:assert/strict';
import { firstPlan, focusMs, getRecord, play, preferences, seed, setManualDone, tick, validateData } from '../src/model.js';
import { calendarDate, markReminder, newReminder, pendingReminders, validReminders } from '../src/reminders.js';
const date = '2026-10-27';
const started = new Date(`${date}T12:00:00`).getTime();
function setup(enabled = false) { const plan = firstPlan(); return { plan, block: plan.blocks[0], state: { ...seed(), plans: [plan], settings: { ...preferences(), creditManualTime: enabled } } }; }
test('manual credit is off by default and old backups migrate without adding time', () => {
  const { state, plan, block } = setup();
  assert.equal(preferences().creditManualTime, false);
  assert.equal(getRecord(setManualDone(state, date, plan.id, block.id, true), date, plan.id, block.id).elapsedMs, 0);
  const old = { ...state }; delete old.reminders; delete old.settings.creditManualTime;
  assert.deepEqual(validateData(old).reminders, []);
  assert.equal(validateData(old).settings.creditManualTime, false);
});
test('manual completion fills only the missing duration, is idempotent and undo preserves actual time', () => {
  const { state, plan, block } = setup(true);
  let next = play(state, plan, block, date, started);
  next = setManualDone(next, date, plan.id, block.id, true, started + 180000);
  assert.equal(getRecord(next, date, plan.id, block.id).elapsedMs, 25 * 60000);
  assert.equal(getRecord(next, date, plan.id, block.id).manualMs, 22 * 60000);
  assert.equal(next.active.running, false); assert.equal(next.active.blockId, plan.blocks[1].id); assert.equal(next.active.remainingMs, 5 * 60000);
  next = setManualDone(next, date, plan.id, block.id, true, started + 181000);
  assert.equal(getRecord(next, date, plan.id, block.id).elapsedMs, 25 * 60000);
  next = { ...next, settings: { ...next.settings, creditManualTime: false } };
  next = setManualDone(next, date, plan.id, block.id, false, started + 182000);
  assert.equal(getRecord(next, date, plan.id, block.id).elapsedMs, 3 * 60000);
  assert.equal(next.active.remainingMs, 5 * 60000);
  assert.equal(next.active.blockId, plan.blocks[1].id);
  assert.equal(getRecord(next, date, plan.id, block.id).manualMs, 0);
  assert.equal(getRecord(state, date, plan.id, block.id).elapsedMs, 0);
});
test('repeated checks never accumulate credit and credited breaks stay outside focus', () => {
  const { state, plan, block } = setup(true);
  let next = state;
  for (let count = 0; count < 3; count++) {
    next = setManualDone(next, date, plan.id, block.id, true);
    assert.equal(focusMs(next, date, date), 25 * 60000);
    next = setManualDone(next, date, plan.id, block.id, false);
    assert.equal(focusMs(next, date, date), 0);
  }
  next = setManualDone(next, date, plan.id, plan.blocks[1].id, true);
  assert.equal(focusMs(next, date, date), 0);
  assert.equal(getRecord(next, date, plan.id, plan.blocks[1].id).elapsedMs, 5 * 60000);
});
test('completed timer time is never removed by unchecking or credited twice', () => {
  const { state, plan, block } = setup(true);
  let next = tick(play(state, plan, block, date, started), started + 1500000).state;
  next = setManualDone(next, date, plan.id, block.id, false);
  assert.equal(focusMs(next, date, date), 25 * 60000);
  next = setManualDone(next, date, plan.id, block.id, true);
  assert.equal(getRecord(next, date, plan.id, block.id).manualMs, 0);
});
test('daily notes return next day while dated notes show only on their scheduled day', () => {
  const daily = { ...newReminder(date), title: 'Todos os dias', schedule: 'daily' };
  const dated = { ...newReminder(date), title: 'Só hoje' };
  let notes = [daily, dated];
  assert.equal(pendingReminders(notes, date).length, 2);
  notes = markReminder(notes, daily.id, date, true);
  notes = markReminder(notes, dated.id, date, true);
  assert.equal(pendingReminders(notes, date).length, 0);
  assert.deepEqual(pendingReminders(notes, '2026-10-28').map(note => note.id), [daily.id]);
  notes = markReminder(notes, daily.id, date, false);
  assert.deepEqual(pendingReminders(notes, date).map(note => note.id), [daily.id]);
  assert.deepEqual(daily.seenDates, []);
});
test('notes, read confirmations and manual credit survive backup roundtrip', () => {
  const { state, plan, block } = setup(true);
  const note = { ...newReminder(date), title: 'Lembrete', description: 'Um detalhe importante.', seenDates: [date] };
  const next = { ...setManualDone(state, date, plan.id, block.id, true, started), reminders: [note] };
  assert.equal(next.active.blockId, plan.blocks[1].id);
  assert.equal(next.active.running, false);
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(next))), next);
});
test('invalid dates, duplicated notes and inconsistent manual credit are rejected', () => {
  assert.equal(calendarDate('2026-02-30'), false); assert.equal(calendarDate('2028-02-29'), true);
  const note = { ...newReminder(date), title: 'Nota' };
  assert.equal(validReminders([note, note]), false);
  assert.equal(validReminders([{ ...note, seenDates: ['bad'] }]), false);
  assert.throws(() => validateData({ ...seed(), reminders: [{ ...note, date: '2026-02-30' }] }));
  assert.throws(() => validateData({ ...seed(), records: { '2026-10-27|p|b': { done: true, elapsedMs: 100, manualMs: 101 } } }));
});

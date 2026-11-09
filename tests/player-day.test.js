import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, firstPlan, getRecord, pause, play, prepareCurrentDay, seed, setDone, setManualDone, tick, validateData } from '../src/model.js';
const before = new Date(2026, 10, 9, 23, 59).getTime();
const after = new Date(2026, 10, 10, 0, 1).getTime();
const yesterday = dayKey(new Date(before)), today = dayKey(new Date(after));
function fixture() {
  return { ...seed(), plans: [firstPlan(), firstPlan(), firstPlan()].map((plan, index) => ({ ...plan, name: `Plano ${index}`, days: [0, 1, 2, 3, 4, 5, 6] })) };
}
test('opening with yesterday unfinished selects today paused without charging time away', () => {
  const state = fixture(), plan = state.plans[0], oldBlock = plan.blocks[2];
  const saved = pause(play(state, plan, oldBlock, yesterday, before - 120000), before);
  const next = prepareCurrentDay(validateData(JSON.parse(JSON.stringify(saved))), after);
  assert.equal(next.active.date, today);
  assert.equal(next.active.blockId, plan.blocks[0].id);
  assert.equal(next.active.running, false);
  assert.equal(next.active.startedAt, after);
  assert.deepEqual(next.records, saved.records);
  assert.equal(getRecord(next, yesterday, plan.id, oldBlock.id).done, false);
});
test('today selection follows scheduled plans, pending order, overrides and partial progress', () => {
  let state = fixture();
  state.plans[0].completedAt = yesterday;
  state.plans[1].days = [];
  const plan = state.plans[2];
  plan.days = [];
  plan.dayOverrides = { [today]: { name: 'Plano do dia', blocks: [plan.blocks[2], plan.blocks[0]] } };
  state = pause(play(state, plan, plan.blocks[0], yesterday, before), before);
  state = setDone(state, today, plan.id, plan.blocks[2].id, true);
  state.records[`${today}|${plan.id}|${plan.blocks[0].id}`] = { elapsedMs: 120000, done: false };
  const next = prepareCurrentDay(state, after);
  assert.equal(next.active.planId, plan.id);
  assert.equal(next.active.planName, 'Plano do dia');
  assert.equal(next.active.blockId, plan.blocks[0].id);
  assert.equal(next.active.remainingMs, 23 * 60000);
  assert.equal(next.records, state.records);
});
test('midnight preserves a running lesson and completion then prepares today', () => {
  const state = fixture(), plan = state.plans[0], block = plan.blocks[2];
  const running = play(state, plan, block, yesterday, before);
  assert.equal(prepareCurrentDay(running, after), running);
  const partial = tick(running, after);
  assert.equal(partial.finished, false);
  assert.equal(prepareCurrentDay(partial.state, after), partial.state);
  const end = before + block.minutes * 60000;
  const finished = tick(partial.state, end);
  assert.equal(finished.completed.blockId, block.id);
  const next = prepareCurrentDay(finished.state, end);
  assert.equal(next.active.date, today);
  assert.equal(next.active.blockId, plan.blocks[0].id);
  assert.equal(next.active.running, false);
  assert.equal(getRecord(next, yesterday, plan.id, block.id).done, true);
  assert.equal(getRecord(next, today, plan.id, block.id).done, false);
  assert.equal(getRecord(next, yesterday, plan.id, block.id).elapsedMs, 60000);
  assert.equal(getRecord(next, today, plan.id, block.id).elapsedMs, 24 * 60000);
});
test('manual completion after midnight prepares today without finishing today by mistake', () => {
  const state = fixture(), plan = state.plans[0], block = plan.blocks[2];
  const next = prepareCurrentDay(setManualDone(play(state, plan, block, yesterday, before), yesterday, plan.id, block.id, true, after), after);
  assert.equal(next.active.date, today);
  assert.equal(next.active.blockId, plan.blocks[0].id);
  assert.equal(getRecord(next, yesterday, plan.id, block.id).done, true);
  assert.equal(getRecord(next, today, plan.id, block.id).done, false);
});
test('no eligible pending task clears the stale player, preserving records', () => {
  let state = fixture(), plan = state.plans[0];
  state = pause(play(state, plan, plan.blocks[0], yesterday, before), before);
  for (const item of state.plans) for (const block of item.blocks) state = setDone(state, today, item.id, block.id, true);
  const next = prepareCurrentDay(state, after);
  assert.equal(next.active, null);
  assert.equal(next.records, state.records);
  for (const item of state.plans) item.days = [];
  assert.equal(prepareCurrentDay(state, after).active, null);
});
test('same-day selection, future selection and absent selection remain unchanged', () => {
  const state = fixture(), plan = state.plans[0];
  assert.equal(prepareCurrentDay(state, after), state);
  const sameDay = pause(play(state, plan, plan.blocks[2], today, after), after);
  assert.equal(prepareCurrentDay(sameDay, after), sameDay);
  const future = { ...sameDay, active: { ...sameDay.active, date: '2026-11-11' } };
  assert.equal(prepareCurrentDay(future, after), future);
});

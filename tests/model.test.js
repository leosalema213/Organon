import test from 'node:test';
import assert from 'node:assert/strict';
import { dailySummary, dayKey, editBlock, focusMs, getRecord, pause, play, preferences, orderedNotes, themePresets, resetTimer, seed as emptySeed, firstPlan, newBlock, setDone, tick, validateData } from '../src/model.js';
function seed() { const state = emptySeed(); state.plans = [firstPlan(), firstPlan(), firstPlan()]; return state; }
const baseTime = new Date(2026, 9, 27, 12).getTime();
function fixture() { const state = seed(); const plan = state.plans[0]; const block = plan.blocks[0]; return { state, plan, block, date: dayKey(new Date(baseTime)) }; }

test('timer completes at configured duration and never starts the next block', () => {
  const { state, plan, block, date } = fixture();
  const next = tick(play(state, plan, block, date, baseTime), baseTime + 30 * 60000);
  assert.equal(next.finished, true);
  assert.equal(next.state.active.running, false);
  assert.equal(next.state.active.blockId, plan.blocks[1].id);
  assert.equal(next.completed.blockId, block.id);
  assert.equal(getRecord(next.state, date, plan.id, block.id).done, true);
  assert.equal(focusMs(next.state, date, date), block.minutes * 60000);
  assert.equal(getRecord(next.state, date, plan.id, plan.blocks[1].id).done, false);
  assert.equal(tick(next.state, baseTime + 31 * 60000).finished, false);
});
test('pausing and resuming excludes all time spent paused', () => {
  const { state, plan, block, date } = fixture();
  let s = pause(play(state, plan, block, date, baseTime), baseTime + 60000);
  s = tick(s, baseTime + 10 * 60000).state;
  assert.equal(focusMs(s, date, date), 60000);
  s = play(s, plan, block, date, baseTime + 10 * 60000);
  s = pause(s, baseTime + 12 * 60000);
  assert.equal(focusMs(s, date, date), 3 * 60000);
  assert.equal(s.active.remainingMs, 22 * 60000);
});
test('switching blocks settles the previous session and only one timer runs', () => {
  const { state, plan, block, date } = fixture();
  const s = play(play(state, plan, block, date, baseTime), plan, plan.blocks[2], date, baseTime + 30000);
  assert.equal(s.active.blockId, plan.blocks[2].id);
  assert.equal(getRecord(s, date, plan.id, block.id).elapsedMs, 30000);
});
test('break time is tracked but excluded from focus metrics', () => {
  const { state, plan, date } = fixture(); const block = plan.blocks[1];
  const s = tick(play(state, plan, block, date, baseTime), baseTime + 5 * 60000).state;
  assert.equal(getRecord(s, date, plan.id, block.id).elapsedMs, 300000);
  assert.equal(focusMs(s, date, date), 0);
});
test('manual completion and unchecking do not invent study time', () => {
  const { state, plan, block, date } = fixture();
  let s = setDone(state, date, plan.id, block.id, true);
  s = setDone(s, date, plan.id, plan.blocks[1].id, true);
  assert.equal(focusMs(s, date, date), 0);
  assert.equal(getRecord(s, date, plan.id, plan.blocks[1].id).type, 'break');
  assert.equal(getRecord(s, '2026-10-28', plan.id, block.id).done, false);
  s = setDone(s, date, plan.id, block.id, false);
  assert.equal(getRecord(s, date, plan.id, block.id).done, false);
});
test('time crossing midnight is allocated to the correct local dates', () => {
  const { state, plan, block } = fixture();
  const start = new Date(2026, 9, 27, 23, 59).getTime();
  const s = pause(play(state, plan, block, '2026-10-27', start), start + 3 * 60000);
  assert.equal(focusMs(s, '2026-10-27', '2026-10-27'), 60000);
  assert.equal(focusMs(s, '2026-10-28', '2026-10-28'), 120000);
});
test('restarting preserves logged time and resets only the timer', () => {
  const { state, plan, block, date } = fixture();
  const s = resetTimer(play(state, plan, block, date, baseTime), baseTime + 60000);
  assert.equal(s.active.remainingMs, block.minutes * 60000);
  assert.equal(s.active.running, false);
  assert.equal(focusMs(s, date, date), 60000);
});
test('backups preserve notes and history and restore with no running session', () => {
  const { state, plan, block, date } = fixture();
  const s = play(state, plan, block, date, baseTime);
  plan.notes.push({ id: 'test-note', date, text: 'Hoje aprendi sobre DNS.', images: [] });
  const restored = validateData(JSON.parse(JSON.stringify(s)));
  assert.equal(restored.plans[0].notes[0].text, 'Hoje aprendi sobre DNS.');
  assert.deepEqual(restored.active, { ...s.active, running: false });
});
test('malformed backups and duplicate ids are rejected', () => {
  assert.throws(() => validateData({ version: 2 }));
  const s = seed(); s.plans[0].blocks[0].minutes = -1;
  assert.throws(() => validateData(s));
  const duplicate = seed(); duplicate.plans[1].id = duplicate.plans[0].id;
  assert.throws(() => validateData(duplicate));
});
test('older backups migrate to device mode and the light preference survives import', () => {
  const old = seed(); delete old.settings.theme;
  assert.equal(validateData(old).settings.theme, 'system');
  old.settings.theme = 'light';
  assert.equal(validateData(old).settings.theme, 'light');
});
test('clock moving backwards cannot credit negative time', () => {
  const { state, plan, block, date } = fixture();
  const s = tick(play(state, plan, block, date, baseTime), baseTime - 10000).state;
  assert.equal(s.active.remainingMs, block.minutes * 60000);
  assert.equal(focusMs(s, date, date), 0);
});
test('density preferences migrate without losing theme or sound', () => {
  assert.deepEqual(preferences({ theme: 'light', sound: false }), { theme: 'light', sound: false, reminderSound: 'chime', startWithWindows: true, creditManualTime: false, density: 'compact', plansView: 'cards', palette: 'pink' });
  assert.equal(preferences({ density: 'minimal' }).density, 'minimal');
  assert.equal(preferences({ density: 'comfortable' }).density, 'comfortable');
  assert.equal(preferences({ density: 'invalid' }).density, 'compact');
});
test('editing one block preserves ids, other blocks and logged study time', () => {
  const { state, plan, block, date } = fixture();
  const running = play(state, plan, block, date, baseTime);
  const edited = editBlock(running, plan.id, block.id, { name: 'Novo nome', minutes: 30 }, baseTime + 5 * 60000);
  assert.equal(edited.active.blockName, 'Novo nome');
  assert.equal(edited.active.running, false);
  assert.equal(edited.active.remainingMs, 25 * 60000);
  assert.equal(focusMs(edited, date, date), 5 * 60000);
  assert.equal(edited.plans[0].blocks[0].id, block.id);
  assert.equal(edited.plans[0].blocks[1], plan.blocks[1]);
  assert.equal(edited.plans[1], state.plans[1]);
});
test('reducing a running block below elapsed time completes only that block', () => {
  const { state, plan, block, date } = fixture();
  const edited = editBlock(play(state, plan, block, date, baseTime), plan.id, block.id, { name: block.name, minutes: 2 }, baseTime + 5 * 60000);
  assert.equal(edited.active.remainingMs, plan.blocks[1].minutes * 60000);
  assert.equal(edited.active.blockId, plan.blocks[1].id);
  assert.equal(edited.active.running, false);
  assert.equal(getRecord(edited, date, plan.id, block.id).done, true);
  assert.equal(focusMs(edited, date, date), 5 * 60000);
  assert.equal(getRecord(edited, date, plan.id, plan.blocks[1].id).done, false);
});
test('invalid individual edits leave existing state intact', () => {
  const { state, plan, block } = fixture();
  assert.throws(() => editBlock(state, plan.id, block.id, { name: '', minutes: 25 }));
  assert.throws(() => editBlock(state, plan.id, block.id, { name: 'Aula', minutes: 361 }));
  assert.throws(() => editBlock(state, plan.id, block.id, { name: 'Aula', minutes: 0.5 }));
  assert.equal(state.plans[0].blocks[0], block);
});

test('fresh installs start empty and the tutorial offers one generic plan', () => {
  const state = emptySeed();
  assert.equal(state.plans.length, 0);
  assert.equal(state.onboardingCompleted, false);
  assert.equal(state.settings.theme, 'system');
  const plan = firstPlan();
  assert.deepEqual(plan.blocks.map(b => b.name), ['Aula 1', 'Descanso', 'Aula 2']);
});
test('manual themes and list preferences survive normalization and backup import', () => {
  const state = seed(); state.settings = { theme: 'dark', plansView: 'list' };
  const restored = validateData(state);
  assert.equal(restored.settings.theme, 'dark');
  assert.equal(restored.settings.plansView, 'list');
  assert.equal(restored.plans.length, 3);
});

test('custom theme selection survives backups and invalid palettes fall back safely', () => {
  const state=seed(); state.settings={theme:'custom',palette:'green'};
  assert.equal(validateData(state).settings.palette,'green');
  assert.equal(validateData(state).settings.theme,'custom');
  assert.equal(preferences({theme:'custom',palette:'invalid'}).palette,'pink');
});
test('pinned notes sort first without mutating notes or reordering their peers', () => {
  const notes=[{id:'new'},{id:'pinned',pinned:true},{id:'old'},{id:'also-pinned',pinned:true}];
  assert.deepEqual(orderedNotes(notes).map(n=>n.id),['pinned','also-pinned','new','old']);
  assert.equal(notes[0].id,'new');
});
test('pinned notes survive backups and malformed pin flags are rejected', () => {
  const state=seed(); state.plans[0].notes=[{id:'note',date:'2026-10-27',text:'Texto',images:[],pinned:true}];
  assert.equal(validateData(state).plans[0].notes[0].pinned,true);
  state.plans[0].notes[0].pinned='yes';
  assert.throws(()=>validateData(state));
});
test('preset text, secondary text and primary button labels meet AA contrast', () => {
  function luminance(hex) {
    const c=hex.slice(1).match(/../g).map(n=>parseInt(n,16)/255).map(n=>n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4);
    return c[0]*0.2126+c[1]*0.7152+c[2]*0.0722;
  }
  function ratio(a,b) { const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); }
  for(const p of themePresets) {
    assert(ratio(p.text,p.surface)>=4.5,p.name+' text');
    assert(ratio(p.muted,p.surface)>=4.5,p.name+' secondary text');
    assert(ratio('#172019',p.accent)>=4.5,p.name+' button');
  }
});

test('daily summary counts all fourteen blocks from the reported schedule', () => {
  let state=emptySeed();
  const make=(name,blocks)=>({...firstPlan(),name,blocks:blocks.map(([type,minutes])=>({...newBlock(type),minutes}))});
  state.plans=[make('Linux',[['lesson',25],['break',5],['lesson',25],['break',10],['lesson',10]]),make('Design',[['lesson',30],['break',5],['lesson',35],['break',10]]),make('Inglês',[['lesson',10],['lesson',30],['break',5],['lesson',30],['break',10]])];
  for(const block of state.plans[0].blocks)state=setDone(state,'2026-10-27',state.plans[0].id,block.id,true);
  for(const block of state.plans[1].blocks.slice(0,2))state=setDone(state,'2026-10-27',state.plans[1].id,block.id,true);
  let summary=dailySummary(state,'2026-10-27');
  assert.equal(summary.total,14);assert.equal(summary.completed,7);assert.equal(summary.percent,50);assert.equal(summary.studyMinutes,195);
  state=setDone(state,'2026-10-27',state.plans[1].id,state.plans[1].blocks[2].id,true);
  summary=dailySummary(state,'2026-10-27');assert.equal(summary.completed,8);assert.equal(summary.percent,57);
  assert.equal(dailySummary(state,'2026-10-28').completed,0);
  assert.equal(dailySummary(state,'2026-11-01').total,0);assert.equal(dailySummary(state,'2026-11-01').percent,0);
});

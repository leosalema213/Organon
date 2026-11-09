import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeReminder, dueReminders, newReminder, reminderAgenda, validReminders } from '../src/reminders.js';
import { preferences, seed, validateData } from '../src/model.js';
const day = '2026-11-09';
const note = fields => ({ ...newReminder(day), title: 'Verificar o arroz', time: '13:10', notifyOnStartup: true, ...fields });
const at = time => new Date(`${day}T${time}:00`);

test('alarms wait for local time, ignore the selected UI day, and catch overdue dated notes', () => {
  const notes = [note(), note({ id: 'tomorrow', date: '2026-11-10' }), note({ id: 'disabled', notifyOnStartup: false }), note({ id: 'legacy', time: '' })];
  assert.equal(dueReminders(notes, at('13:09')).length, 0);
  assert.deepEqual(dueReminders(notes, at('13:10')).map(n => n.id), [notes[0].id]);
  assert.equal(dueReminders([notes[0]], new Date('2026-11-11T00:01:00')).length, 1);
  assert.equal(dueReminders([note({ seenDates: [day] })], at('13:11')).length, 0);
});
test('single-use deletion preserves other notes; regular alarms fire once, separately from seen', () => {
  const once = note({ singleUse: true }), regular = note();
  let notes = consumeReminder([once, regular], once.id, day);
  assert.deepEqual(notes, [regular]);
  notes = consumeReminder(notes, regular.id, day);
  assert.deepEqual(notes[0].seenDates, []);
  assert.deepEqual(notes[0].notifiedDates, [day]);
  assert.equal(dueReminders(notes, at('13:30')).length, 0);
  assert.equal(dueReminders(validateData({ ...seed(), reminders: notes }).reminders, at('13:30')).length, 0);
  assert.equal(once.singleUse, true);
});
test('daily alarm renews on the next day without replaying missed days', () => {
  const daily = note({ schedule: 'daily' });
  const notes = consumeReminder([daily], daily.id, day);
  assert.equal(dueReminders(notes, new Date('2026-11-10T13:09:00')).length, 0);
  assert.equal(dueReminders(notes, new Date('2026-11-10T13:10:00')).length, 1);
});
test('old backups default to chime and accept notes without scheduling fields', () => {
  const old = { id: 'old', title: 'Antiga', description: '', schedule: 'date', date: day, seenDates: [] };
  assert.deepEqual(validateData({ ...seed(), settings: {}, reminders: [old] }).reminders, [old]);
  assert.equal(preferences().reminderSound, 'chime');
  const current = { ...seed(), settings: { ...preferences(), reminderSound: 'rise' }, reminders: [note({ sound: 'double', notifiedDates: [day] })] };
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(current))), current);
});
test('invalid alarm fields and inconsistent single-use notes are rejected', () => {
  for (const fields of [{ time: '24:00' }, { time: '9:00' }, { sound: 'file:///bad.wav' }, { notifiedDates: ['bad'] }, { singleUse: 'yes' }, { singleUse: true, time: '' }, { singleUse: true, schedule: 'daily' }, { singleUse: true, notifyOnStartup: false }]) assert.equal(validReminders([note(fields)]), false);
});
test('agenda orders local occurrences and handles weeks crossing months and leap years', () => {
  const daily = note({ schedule: 'daily', time: '' });
  const early = note({ time: '08:00' }), late = note({ time: '20:00' });
  assert.deepEqual(reminderAgenda([late, daily, early], day)[0].notes.map(n => n.id), [early.id, late.id, daily.id]);
  const week = reminderAgenda([daily], '2026-11-01', 'week');
  assert.equal(week[0].day, '2026-10-26'); assert.equal(week.at(-1).day, '2026-11-01');
  assert.equal(week.every(row => row.notes.length === 1), true);
  assert.equal(reminderAgenda([], '2028-02-03', 'month').length, 29);
});

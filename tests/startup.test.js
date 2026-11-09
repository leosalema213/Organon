import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { preferences, seed, validateData } from '../src/model.js';
import { newReminder } from '../src/reminders.js';
const require = createRequire(import.meta.url);
const { WindowsStartup } = require('../electron/startup.cjs');
const { ReminderNotifications, eligibleReminders, openRemindersWindow } = require('../electron/reminder-notifications.cjs');
const today = '2026-10-27';
function startupFixture(available = true) {
  const calls = []; let current = { openAtLogin: false, executableWillLaunchAtLogin: false };
  const app = { getLoginItemSettings: () => current, setLoginItemSettings: options => { calls.push(options); current = { openAtLogin: options.openAtLogin, executableWillLaunchAtLogin: options.enabled }; } };
  return { manager: new WindowsStartup({ app, available, path: 'C:\\Program Files\\Compasso\\Compasso.exe' }), calls, app, setCurrent: value => { current = value; } };
}
test('startup defaults to enabled, preserves a disabled preference and uses the current executable', () => {
  assert.equal(preferences().startWithWindows, true);
  const { manager, calls } = startupFixture();
  manager.sync({}); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { openAtLogin: true, enabled: true, name: 'Compasso', path: 'C:\\Program Files\\Compasso\\Compasso.exe', args: ['--autostart'] });
  manager.sync({}); assert.equal(calls.length, 1);
  manager.set(false); assert.equal(calls.at(-1).openAtLogin, false); assert.equal(manager.status().enabled, false);
  assert.equal(preferences({ startWithWindows: false }).startWithWindows, false);
});
test('temporary/development profiles never touch Windows login registration', () => {
  const { manager, calls } = startupFixture(false);
  manager.sync({}); manager.set(false); manager.set(true);
  assert.equal(calls.length, 0); assert.equal(manager.status().available, false);
  assert.throws(() => manager.set('true'), /inválida/);
});
test('automatic sync respects the Windows disabled flag while an explicit choice can re-enable it', () => {
  const { manager, calls, setCurrent } = startupFixture();
  setCurrent({ openAtLogin: true, executableWillLaunchAtLogin: false });
  manager.sync({}); assert.equal(calls.length, 0); assert.equal(manager.status().enabled, false);
  manager.set(true); assert.equal(calls.length, 1); assert.equal(manager.status().enabled, true);
});
test('startup OS errors are reported without throwing or losing study data', () => {
  const { manager, app } = startupFixture(); app.setLoginItemSettings = () => { throw Error('Denied'); };
  assert(manager.set(true).error); assert.equal(manager.status().enabled, false);
});
test('only opted-in, due, unseen notes are eligible, including daily notes', () => {
  const note = { ...newReminder(today), title: 'Nota' }; assert.equal(note.notifyOnStartup, false);
  const notes = [note, { ...note, id: 'due', notifyOnStartup: true }, { ...note, id: 'daily', schedule: 'daily', notifyOnStartup: true }, { ...note, id: 'future', date: '2026-10-28', notifyOnStartup: true }, { ...note, id: 'seen', seenDates: [today], notifyOnStartup: true }];
  assert.deepEqual(eligibleReminders(notes, today).map(value => value.id), ['due', 'daily']);
  assert.deepEqual(eligibleReminders(notes, '2026-10-28').map(value => value.id), ['daily', 'future']);
});
test('one aggregated notification per launch opens notes without marking them seen', () => {
  const shown = []; let opens = 0;
  class Notification extends EventEmitter { static isSupported() { return true; } constructor(options) { super(); this.options = options; } show() { shown.push(this); } }
  const notes = [1, 2].map(id => ({ ...newReminder(today), id: String(id), title: 'Teste', notifyOnStartup: true })), before = structuredClone(notes);
  const service = new ReminderNotifications({ Notification, open: () => opens++, now: () => new Date(`${today}T12:00:00`) });
  assert.deepEqual(service.startup(notes), { shown: true, count: 2 }); assert.match(shown[0].options.body, /2 notas pendentes/);
  service.startup(notes); assert.equal(shown.length, 1);
  shown[0].emit('click'); assert.equal(opens, 1); assert.deepEqual(notes, before);
});

test('timed alarms stay outside the startup summary and use the selected app sound only', () => {
  const shown = []; let opens = 0;
  class Notification extends EventEmitter { static isSupported() { return true; } constructor(options) { super(); this.options = options; } show() { shown.push(this); } }
  const note = { ...newReminder(today), title: 'Alarme', notifyOnStartup: true, time: '15:00' };
  assert.deepEqual(eligibleReminders([note], today), []);
  const service = new ReminderNotifications({ Notification, open: () => opens++ });
  assert.equal(service.alarm(note).shown, true);
  assert.equal(shown[0].options.silent, true);
  assert.match(shown[0].options.title, /Alarme/);
  shown[0].emit('click'); assert.equal(opens, 1);
  assert.equal(service.alarm({ title: 'x'.repeat(121) }).shown, false);
});
test('no notification for disabled/seen/future notes or unsupported OS', () => {
  class Notification { static isSupported() { return false; } constructor() { throw Error('Must not create'); } }
  for (const notes of [[], [{ ...newReminder(today), title: 'Off' }], [{ ...newReminder(today), title: 'Seen', notifyOnStartup: true, seenDates: [today] }], [{ ...newReminder('2026-10-28'), title: 'Future', notifyOnStartup: true }], [{ ...newReminder(today), title: 'Unsupported', notifyOnStartup: true }]]) {
    const service = new ReminderNotifications({ Notification, open() {}, now: () => new Date(`${today}T12:00:00`) });
    assert.equal(service.startup(notes).shown, false);
  }
});
test('notification click restores the app and routes to notes', () => {
  const calls = [];
  openRemindersWindow({ isDestroyed: () => false, isMinimized: () => true, restore: () => calls.push('restore'), show: () => calls.push('show'), focus: () => calls.push('focus'), webContents: { send: channel => calls.push(channel) } });
  assert.deepEqual(calls, ['restore', 'show', 'focus', 'reminders:open']);
});
test('notification preference is optional in old backups and preserved in new ones', () => {
  const old = { ...newReminder(today), title: 'Antiga' }; delete old.notifyOnStartup;
  assert.equal(validateData({ ...seed(), reminders: [old] }).reminders[0].notifyOnStartup, undefined);
  const state = { ...seed(), settings: { ...preferences(), startWithWindows: false }, reminders: [{ ...old, notifyOnStartup: true }] };
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(state))).reminders, state.reminders);
  assert.equal(validateData(state).settings.startWithWindows, false);
  assert.throws(() => validateData({ ...state, reminders: [{ ...old, notifyOnStartup: 'yes' }] }));
});

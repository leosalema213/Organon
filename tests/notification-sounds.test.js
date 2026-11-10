import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { notificationSounds, notificationSoundNotes } from '../src/notification-sounds.js';
import { playReminderSound } from '../src/reminder-audio.js';
import { reminderSounds, newReminder } from '../src/reminders.js';
import { preferences, seed, validateData } from '../src/model.js';
const require = createRequire(import.meta.url);
const { packDocument, unpackDocument } = require('../electron/cloud-document.cjs');

test('notes and completion share all sounds, including six bounded short/long additions', () => {
  assert.equal(reminderSounds, notificationSounds);
  assert.equal(new Set(notificationSounds.map(([id]) => id)).size, notificationSounds.length);
  for (const [id] of notificationSounds) {
    const notes = notificationSoundNotes(id);
    if (id === 'silent') { assert.deepEqual(notes, []); continue; }
    const end = Math.max(...notes.map(note => note.at + note.duration));
    assert(end > 0 && end < 10, id);
    if (id.endsWith('-long')) assert(end >= 5, id);
    if (id.endsWith('-short')) assert(end < 1, id);
    assert(notes.every(note => note.attack < note.fade && note.fade < note.duration && note.frequency > 0 && note.volume <= 0.22));
  }
  assert.equal(notificationSounds.filter(([id]) => id.endsWith('-short')).length, 3);
  assert.equal(notificationSounds.filter(([id]) => id.endsWith('-long')).length, 3);
  assert.deepEqual(notificationSoundNotes('completion').map(note => note.frequency), [660, 880, 660, 880]);
  assert.deepEqual(notificationSoundNotes('chime').map(note => note.frequency), [880, 660, 880]);
});

test('legacy profiles preserve sound switches; choices survive backup and cloud serialization independently', async () => {
  assert.equal(preferences({ sound: false }).completionSound, 'completion');
  assert.equal(preferences({ completionSound: 'invalid' }).completionSound, 'completion');
  assert.equal(preferences().reminderSound, 'chime');
  for (const [id] of notificationSounds) {
    const state = { ...seed(), settings: preferences({ sound: false, completionSound: id, reminderSound: 'double' }), reminders: [{ ...newReminder('2026-11-10', id), title: 'Sintética' }] };
    assert.deepEqual(validateData(JSON.parse(JSON.stringify(state))), state);
    const packed = packDocument(state);
    assert.equal(packed.assets.size, 0);
    const restored = validateData(await unpackDocument(packed.payload, () => { throw new Error('No downloads expected'); }));
    assert.equal(restored.settings.completionSound, id);
    assert.equal(restored.settings.sound, false);
    assert.equal(restored.settings.reminderSound, 'double');
    assert.equal(restored.reminders[0].sound, id);
  }
});

test('audio schedules actual notes and replaces a long audition; silent cancels without new nodes', () => {
  const oscillators = [], events = [];
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = class {
    state = 'running'; currentTime = 100; destination = {};
    createOscillator() { const oscillator = { frequency: {}, connect() {}, disconnect() {}, start(at) { this.startAt = at; }, stop(at) { events.push({ oscillator: this, at }); } }; oscillators.push(oscillator); return oscillator; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  };
  try {
    playReminderSound('alarm-long');
    const long = [...oscillators]; assert.equal(long.length, 24);
    assert.equal(long[0].startAt, 100); assert(long.at(-1).startAt > 109);
    playReminderSound('double');
    assert(long.every(oscillator => events.some(event => event.oscillator === oscillator && event.at === undefined)));
    assert.equal(oscillators.length, 26);
    playReminderSound('silent'); assert.equal(oscillators.length, 26);
    assert(oscillators.slice(-2).every(oscillator => events.some(event => event.oscillator === oscillator && event.at === undefined)));
  } finally { globalThis.AudioContext = previous; }
});

import { documentImages, documentText, validNoteDocument } from './note-document.js';
import { notificationSounds } from './notification-sounds.js';

export function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export const reminderSounds = notificationSounds;
export const validReminderTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export function newReminder(date, sound = 'chime') { return { id: crypto.randomUUID(), title: '', description: '', schedule: 'date', date, seenDates: [], notifyOnStartup: false, time: '', singleUse: false, sound }; }
export function validReminderDocument(note) { return note.descriptionDocument === undefined || (validNoteDocument(note.descriptionDocument) && !documentImages({ document: note.descriptionDocument }).length && documentText(note.descriptionDocument) === note.description); }
export function validReminders(notes) {
  if (!Array.isArray(notes)) return false;
  const ids = new Set();
  return notes.every(note => {
    if (!note || typeof note.id !== 'string' || !note.id || ids.has(note.id) || typeof note.title !== 'string' || !note.title.trim() || note.title.length > 120 || typeof note.description !== 'string' || note.description.length > 4000 || (note.notifyOnStartup !== undefined && typeof note.notifyOnStartup !== 'boolean') || !['daily', 'date'].includes(note.schedule) || (note.schedule === 'date' && !calendarDate(note.date)) || !Array.isArray(note.seenDates) || note.seenDates.some(date => !calendarDate(date))) return false;
    if ((note.time !== undefined && note.time !== '' && !validReminderTime(note.time)) || (note.singleUse !== undefined && typeof note.singleUse !== 'boolean') || (note.singleUse && (note.schedule !== 'date' || !validReminderTime(note.time) || !note.notifyOnStartup)) || (note.sound !== undefined && !reminderSounds.some(([id]) => id === note.sound)) || (note.notifiedDates !== undefined && (!Array.isArray(note.notifiedDates) || note.notifiedDates.some(date => !calendarDate(date))))) return false;
    ids.add(note.id); return validReminderDocument(note);
  });
}
export const reminderDay = (note, date) => note.schedule === 'daily' ? date : note.date;
export const reminderSeen = (note, date) => note.seenDates.includes(reminderDay(note, date));
export function pendingReminders(notes, date) { return notes.filter(note => (note.schedule === 'daily' || note.date === date) && !reminderSeen(note, date)); }
export function markReminder(notes, id, date, seen) {
  return notes.map(note => {
    if (note.id !== id) return note;
    const day = reminderDay(note, date);
    return { ...note, seenDates: seen ? [...new Set([...note.seenDates, day])] : note.seenDates.filter(value => value !== day) };
  });
}

export function localReminderDay(now = new Date()) { return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
export function dueReminders(notes, now = new Date()) {
  const today = localReminderDay(now);
  return notes.filter(note => {
    const day = reminderDay(note, today);
    return note.notifyOnStartup && validReminderTime(note.time) && !reminderSeen(note, today) && !(note.notifiedDates || []).includes(day) && new Date(`${day}T${note.time}:00`).getTime() <= now.getTime();
  });
}
export function consumeReminder(notes, id, today) {
  return notes.flatMap(note => note.id !== id ? [note] : note.singleUse ? [] : [{ ...note, notifiedDates: [...new Set([...(note.notifiedDates || []), reminderDay(note, today)])] }]);
}
export function reminderAgenda(notes, date, period = 'day') {
  const start = new Date(`${date}T12:00:00`);
  if (period === 'week') start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  if (period === 'month') start.setDate(1);
  const end = new Date(start);
  if (period === 'week') end.setDate(end.getDate() + 6);
  if (period === 'month') { end.setMonth(end.getMonth() + 1); end.setDate(0); }
  const rows = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const day = localReminderDay(cursor);
    const items = notes.filter(note => note.schedule === 'daily' || note.date === day).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.title.localeCompare(b.title, 'pt-BR'));
    rows.push({ day, notes: items });
  }
  return rows;
}

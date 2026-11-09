function localDay(now = new Date()) { return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
function eligibleReminders(notes, today) {
  return (Array.isArray(notes) ? notes : []).filter(note => !note?.time && note?.notifyOnStartup === true && (note.schedule === 'daily' || (note.schedule === 'date' && note.date === today)) && Array.isArray(note.seenDates) && !note.seenDates.includes(today));
}
class ReminderNotifications {
  constructor({ Notification, open, available = true, now = () => new Date() }) { this.Notification = Notification; this.open = open; this.available = available; this.now = now; this.checked = false; this.current = null; }
  alarm(note) {
    if (!note || typeof note.title !== 'string' || note.title.length > 120 || !this.available || !this.Notification.isSupported()) return { shown: false };
    try {
      const notification = new this.Notification({ title: `Organon · ${note.title}`, body: String(note.description || '').slice(0, 300) || 'Chegou o horário do seu lembrete.', silent: true });
      notification.on('click', () => this.open());
      notification.on('failed', () => { this.current = null; });
      this.current = notification; notification.show();
      return { shown: true };
    } catch { return { shown: false }; }
  }
  startup(notes) {
    if (this.checked) return { shown: false, reason: 'already-checked' };
    this.checked = true;
    const count = eligibleReminders(notes, localDay(this.now())).length;
    if (!count || !this.available || !this.Notification.isSupported()) return { shown: false, count };
    try {
      const notification = new this.Notification({ title: 'Organon · Lembretes', body: `Você tem ${count} ${count === 1 ? 'nota pendente' : 'notas pendentes'} para hoje. Clique para abrir.`, silent: true });
      this.current = notification;
      notification.on('click', () => this.open());
      notification.on('failed', () => { this.current = null; });
      notification.on('close', () => { this.current = null; });
      notification.show(); return { shown: true, count };
    } catch { return { shown: false, count, reason: 'notification-unavailable' }; }
  }
}
function openRemindersWindow(win) {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus(); win.webContents.send('reminders:open');
}
module.exports = { ReminderNotifications, eligibleReminders, localDay, openRemindersWindow };

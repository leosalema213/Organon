import { notificationSoundNotes } from './notification-sounds.js';
let context;
let playing = [];
export function unlockReminderAudio() {
  try { context ||= new AudioContext(); if (context.state === 'suspended') context.resume().catch(() => {}); } catch { /* The visual alarm remains available without audio. */ }
}
export function playReminderSound(sound = 'chime') {
  for (const oscillator of playing) { try { oscillator.stop(); } catch {} }
  playing = [];
  if (sound === 'silent') return;
  unlockReminderAudio();
  if (!context) return;
  notificationSoundNotes(sound).forEach(note => {
    const oscillator = context.createOscillator(), gain = context.createGain();
    const at = context.currentTime + note.at;
    oscillator.type = note.type; oscillator.frequency.value = note.frequency;
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(note.volume, at + note.attack); gain.gain.exponentialRampToValueAtTime(0.001, at + note.fade);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); playing = playing.filter(item => item !== oscillator); };
    playing.push(oscillator); oscillator.start(at); oscillator.stop(at + note.duration);
  });
}

let context;
export function unlockReminderAudio() {
  try { context ||= new AudioContext(); if (context.state === 'suspended') context.resume().catch(() => {}); } catch { /* The visual alarm remains available without audio. */ }
}
export function playReminderSound(sound = 'chime') {
  if (sound === 'silent') return;
  unlockReminderAudio();
  if (!context) return;
  const frequencies = sound === 'double' ? [740, 740] : sound === 'rise' ? [523, 659, 784, 1047] : [880, 660, 880];
  frequencies.forEach((frequency, index) => {
    const oscillator = context.createOscillator(), gain = context.createGain();
    const at = context.currentTime + index * 0.3;
    oscillator.type = 'sine'; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(0.18, at + 0.015); gain.gain.exponentialRampToValueAtTime(0.001, at + 0.5);
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(at); oscillator.stop(at + 0.55);
  });
}

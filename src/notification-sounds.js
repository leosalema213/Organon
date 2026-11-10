// Shared by completion notices, note alarms, preferences and backup validation.
export const notificationSounds = [
  ['completion', 'Conclusão clássica'], ['chime', 'Sino suave'], ['double', 'Dois toques'], ['rise', 'Melodia'],
  ['bell-short', 'Campainha curta'], ['soft-short', 'Toque breve'], ['alert-short', 'Alerta curto'],
  ['bell-long', 'Campainha longa'], ['pulse-long', 'Alerta pulsante longo'], ['alarm-long', 'Alarme longo'],
  ['silent', 'Sem som'],
];
export const isNotificationSound = id => notificationSounds.some(([value]) => value === id);

export function notificationSoundNotes(sound) {
  if (sound === 'silent') return [];
  const patterns = {
    completion: { frequencies: [660, 880, 660, 880], step: 0.34, fade: 0.27, duration: 0.3, volume: 0.22, attack: 0.02 },
    chime: { frequencies: [880, 660, 880] },
    double: { frequencies: [740, 740] },
    rise: { frequencies: [523, 659, 784, 1047] },
    'bell-short': { frequencies: [1047, 784, 1047], step: 0.18, fade: 0.2, duration: 0.25 },
    'soft-short': { frequencies: [440, 554], step: 0.18, fade: 0.25, duration: 0.3, volume: 0.14 },
    'alert-short': { frequencies: [880, 1047, 880, 1047], step: 0.17, fade: 0.14, duration: 0.16, type: 'triangle' },
    'bell-long': { frequencies: Array.from({ length: 12 }, (_, i) => i % 2 ? 784 : 1047), step: 0.5, fade: 0.4, duration: 0.45 },
    'pulse-long': { frequencies: Array.from({ length: 20 }, (_, i) => i % 2 ? 880 : 660), step: 0.4, fade: 0.25, duration: 0.3, type: 'triangle' },
    'alarm-long': { frequencies: Array.from({ length: 24 }, (_, i) => i % 2 ? 1000 : 750), step: 0.4, fade: 0.3, duration: 0.35, type: 'triangle' },
  };
  const { frequencies, step = 0.3, fade = 0.5, duration = 0.55, volume = 0.18, attack = 0.015, type = 'sine' } = patterns[sound] || patterns.chime;
  return frequencies.map((frequency, index) => ({ frequency, at: index * step, fade, duration, volume, attack, type }));
}

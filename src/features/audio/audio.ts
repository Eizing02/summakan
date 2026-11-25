import type { Preferences } from '../settings/settings';

const notes = {
  ui_hover: [520], ui_click: [493, 740], tile_grab: [392, 587], tile_drop: [330, 493],
  tile_return: [440, 294], scale_imbalance: [247], scale_balance: [392, 523, 659],
  magic_cancel: [659, 587, 523], equation_simplify: [523, 784],
  hint_open: [440, 659], quest_complete: [523, 659, 784], victory: [523, 659, 784, 1047],
};

let context: AudioContext | undefined;
let master: GainNode | undefined;
let musicGain: GainNode | undefined;
let effectsGain: GainNode | undefined;
let audioTimer: number | undefined;
let musicIndex = 0;
let musicEnabled = false;

export function setAudio(preferences: Preferences, allowed: boolean) {
  musicEnabled = allowed && !preferences.mute && preferences.master > 0 && preferences.music > 0;
  if (!context || !master || !musicGain || !effectsGain) return;
  master.gain.setTargetAtTime(allowed && !preferences.mute ? preferences.master : 0, context.currentTime, .03);
  effectsGain.gain.setTargetAtTime(preferences.sfx, context.currentTime, .03);
  musicGain.gain.setTargetAtTime(preferences.music, context.currentTime, .08);
}

export function unlockAudio(preferences: Preferences, allowed: boolean) {
  try {
    if (!context) {
      context = new AudioContext();
      master = context.createGain();
      musicGain = context.createGain();
      effectsGain = context.createGain();
      musicGain.connect(master);
      effectsGain.connect(master);
      master.connect(context.destination);
    }
    if (context.state === 'suspended') void context.resume().catch(() => {});
    setAudio(preferences, allowed);
    if (audioTimer === undefined) {
      audioTimer = window.setInterval(() => {
        if (!musicEnabled || !musicGain || document.hidden) return;
        const chords = [[130.81, 196, 261.63], [110, 164.81, 220], [87.31, 130.81, 174.61], [98, 146.83, 196]];
        chords[musicIndex++ % chords.length].forEach((frequency, index) => tone(frequency, index * .42, 3.4, musicGain!, .13, 'sine', .65));
      }, 3850);
    }
  } catch { /* The visual state remains usable if audio is unavailable. */ }
}

function tone(frequency: number, offset: number, duration: number, output: GainNode, volume: number, type: OscillatorType, attack: number) {
  if (!context || context.state !== 'running') return;
  const start = context.currentTime + offset;
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  envelope.gain.setValueAtTime(.0001, start);
  envelope.gain.exponentialRampToValueAtTime(volume, start + attack);
  envelope.gain.exponentialRampToValueAtTime(.0001, start + duration);
  oscillator.connect(envelope).connect(output);
  oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  oscillator.start(start);
  oscillator.stop(start + duration + .02);
}

export function sound(effect: keyof typeof notes) {
  if (!effectsGain || !master || master.gain.value < .002 || effectsGain.gain.value < .002) return;
  const length = effect === 'ui_hover' ? .08 : .24;
  notes[effect].forEach((frequency, index) => tone(frequency, index * .073, length, effectsGain!, effect === 'ui_hover' ? .035 : .22, 'triangle', .019));
}

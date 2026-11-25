import type { Preferences } from '../settings/settings';
import { musicTempo, scoreStep, type MusicScene } from './soundtrack';

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
let musicEnabled = false;
let scene: MusicScene = 'waiting';
let sceneGain: GainNode | undefined;
let scorePosition = 0;
let nextBeat = 0;

export function setMusicScene(next: MusicScene) {
  if (scene === next) return;
  scene = next;
  nextBeat = 0;
  scorePosition = 0;
  if (sceneGain && context) {
    const previous = sceneGain;
    previous.gain.setTargetAtTime(0, context.currentTime, .075);
    window.setTimeout(() => previous.disconnect(), 350);
    sceneGain = undefined;
  }
}

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
      audioTimer = window.setInterval(scheduleMusic, 80);
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

function drum(output: GainNode, offset: number, low: boolean, strength: number) {
  if (!context) return;
  const start = context.currentTime + offset;
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  const duration = low ? .21 : .12;
  oscillator.type = low ? 'sine' : 'triangle';
  oscillator.frequency.setValueAtTime(low ? 154 : 465, start);
  oscillator.frequency.exponentialRampToValueAtTime(low ? 69 : 255, start + duration);
  envelope.gain.setValueAtTime(.0001, start);
  envelope.gain.exponentialRampToValueAtTime(.28 * strength, start + .009);
  envelope.gain.exponentialRampToValueAtTime(.0001, start + duration);
  oscillator.connect(envelope).connect(output);
  oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  oscillator.start(start);
  oscillator.stop(start + duration);
}

function scheduleMusic() {
  if (!context || !musicGain || context.state !== 'running' || !musicEnabled || document.hidden) {
    nextBeat = 0;
    return;
  }
  if (!sceneGain) {
    sceneGain = context.createGain();
    sceneGain.connect(musicGain);
    sceneGain.gain.setValueAtTime(.001, context.currentTime);
    sceneGain.gain.setTargetAtTime(1, context.currentTime, .09);
  }
  const output = sceneGain;
  const now = context.currentTime;
  if (nextBeat < now) nextBeat = now + .02;
  const tick = 30 / musicTempo[scene];
  const frequency = (note: number) => 440 * 2 ** ((note - 69) / 12);
  while (nextBeat < now + .16) {
    const offset = nextBeat - now;
    scoreStep(scene, scorePosition++, {
      string(note, beats, strength) {
        const base = frequency(note);
        tone(base, offset, tick * beats, output, .16 * strength, 'triangle', .008);
        tone(base * 2.005, offset, tick * beats * .56, output, .046 * strength, 'sine', .012);
      },
      sustained(note, beats, strength) {
        tone(frequency(note), offset, tick * beats, output, .15 * strength, 'sine', .085);
      },
      drum(low, strength) { drum(output, offset, low, strength); },
    });
    nextBeat += tick;
  }
}

export function sound(effect: keyof typeof notes) {
  if (!effectsGain || !master || master.gain.value < .002 || effectsGain.gain.value < .002) return;
  const length = effect === 'ui_hover' ? .08 : .24;
  notes[effect].forEach((frequency, index) => tone(frequency, index * .073, length, effectsGain!, effect === 'ui_hover' ? .035 : .22, 'triangle', .019));
}

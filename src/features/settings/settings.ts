import { defaultCalibration, type Calibration } from '../../core/input/gesture-machine';
import type { Quality } from '../../scene/types';

export interface Preferences {
  quality: Quality;
  reduced: boolean;
  master: number;
  music: number;
  sfx: number;
  mute: boolean;
  tilt: number;
  settle: number;
  delegate: 'GPU' | 'CPU';
  calibration: Calibration;
}

export interface LessonOptions {
  hints: boolean;
  elapsed: boolean;
  sound: boolean;
  difference: boolean;
  poe: boolean;
  challengeLimit: boolean;
  maxRounds: number;
  challengeTimer: number;
}

export const defaultLesson: LessonOptions = {
  hints: true, elapsed: false, sound: true, difference: false, poe: false,
  challengeLimit: true, maxRounds: 4, challengeTimer: 0,
};

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal<T>(key: string, value: T) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private storage can be unavailable. */ }
}

export function initialPreferences(): Preferences {
  const saved = readLocal<Partial<Preferences>>('balance-quest-preferences', {});
  return {
    quality: 'auto', reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, master: .6,
    music: .14, sfx: .65, mute: false, tilt: 5, settle: 760, delegate: 'GPU',
    ...saved, calibration: { ...defaultCalibration, ...saved.calibration },
  };
}

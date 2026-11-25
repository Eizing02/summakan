import { measureHand, PinchMachine, type GestureState as PinchState } from './pinch-machine';

export interface Point { x: number; y: number }
export interface Landmark extends Point { z?: number }
export interface ObservedHand { landmarks: Landmark[]; handedness: 'Left' | 'Right'; confidence: number }
export type HandChoice = 'Auto' | 'Left' | 'Right';
export interface HandRange { left: number; right: number; top: number; bottom: number }
export interface Calibration { hand: HandChoice; cursorGain: number; pinch: number; reach: number; centerX: number; centerY: number; range?: HandRange }
export const defaultCalibration: Calibration = { hand: 'Auto', cursorGain: .85, pinch: 0.30, reach: 0.65, centerX: 0.5, centerY: 0.5 };
export type GestureState = 'NO_HAND' | 'HAND_DETECTED' | 'POINTING' | 'HOVERING' | 'PINCH_START' | 'GRABBING' | 'DRAGGING' | 'DROP_PENDING' | 'RELEASED' | 'TRACKING_LOST';
export interface GestureFrame {
  point: Point | null;
  state: GestureState;
  event?: 'grab' | 'drop' | 'cancel';
  hand?: ObservedHand;
  aspect?: number;
}
export interface GameHandInput {
  canGrab: (point: Point) => boolean;
  handleFrame: (frame: GestureFrame) => void;
}
const clamp = (n: number) => Math.min(1, Math.max(0, n));

function distance(a: Point, b: Point, aspect = 1) {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

export function pinchRatio(landmarks: Landmark[], aspect: number) {
  return measureHand({ landmarks, aspect, score: 1, hand: null })?.gap ?? NaN;
}

export function validHandRange(range: HandRange) {
  return [range.left, range.right, range.top, range.bottom].every(value => Number.isFinite(value) && value >= 0 && value <= 1) &&
    range.right - range.left >= .12 && range.bottom - range.top >= .12;
}

export function cursorPoint(raw: Point, calibration: Calibration): Point {
  const { reach, centerX, centerY, cursorGain, range } = calibration;
  const bounds = range && validHandRange(range) ? range : {
    left: centerX - reach / 2, right: centerX + reach / 2,
    top: centerY - reach / 2, bottom: centerY + reach / 2,
  };
  function axis(value: number, start: number, end: number) {
    // A small margin lets the cursor reach the edge while the hand is still in view.
    const inset = range && bounds === range ? (end - start) * .035 : 0;
    const centered = 2 * clamp((value - start - inset) / Math.max(.001, end - start - 2 * inset)) - 1;
    const gain = Math.max(.65, Math.min(1.65, cursorGain));
    return .5 + .5 * centered * gain / (1 + (gain - 1) * Math.abs(centered));
  }
  return { x: axis(1 - raw.x, bounds.left, bounds.right), y: axis(raw.y, bounds.top, bounds.bottom) };
}

const states: Record<PinchState, GestureState> = {
  NO_HAND: 'NO_HAND', IDLE: 'POINTING', HOVER: 'HOVERING', PINCH_CANDIDATE: 'PINCH_START',
  GRABBING: 'GRABBING', DRAGGING: 'DRAGGING', RELEASE_PENDING: 'DROP_PENDING', COOLDOWN: 'POINTING',
};

export class GestureMachine {
  private timestamp = -Infinity;
  private lastSeen = -Infinity;
  private owner: ObservedHand | null = null;
  private pinch = new PinchMachine({
    close: .30, open: .45, cutoff: 1.8, beta: 3.2, derivative: 1, mirror: false, hand: 'auto', grace: 400,
  });

  frame(hands: ObservedHand[], timestamp: number, aspect: number, calibration: Calibration, hit: (point: Point) => boolean = () => false): GestureFrame | null {
    if (!Number.isFinite(timestamp) || timestamp <= this.timestamp) return null;
    this.timestamp = timestamp;
    const valid = hands.filter(hand => hand.landmarks.length === 21 && hand.landmarks.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)) &&
      hand.confidence >= .42 && (calibration.hand === 'Auto' || hand.handedness === calibration.hand));
    const owner = this.owner;
    let hand: ObservedHand | undefined;
    if (owner && timestamp - this.lastSeen < 850) {
      const wrist = owner.landmarks[0];
      const radius = Math.max(.13, distance(wrist, owner.landmarks[9], aspect) * 1.75);
      hand = valid.filter(candidate => candidate.handedness === owner.handedness)
        .map(candidate => ({ candidate, gap: distance(wrist, candidate.landmarks[0], aspect) }))
        .sort((a, b) => a.gap - b.gap).find(item => item.gap < radius)?.candidate;
    } else {
      this.owner = null;
      hand = valid.reduce<ObservedHand | undefined>((best, candidate) => !best || candidate.confidence > best.confidence ? candidate : best, undefined);
    }
    const pose = hand ? { landmarks: hand.landmarks, hand: hand.handedness, score: hand.confidence, aspect } : null;
    const map = (raw: Point) => cursorPoint(raw, calibration);
    this.pinch.setThreshold(calibration.pinch, calibration.pinch + .15);
    const result = this.pinch.update(pose, timestamp, point => hit(map(point)));
    if (hand && result.gap !== null) {
      this.owner = hand;
      this.lastSeen = timestamp;
    }
    if (!hand || result.gap === null || result.event === 'cancel') {
      return { point: null, state: owner || hand ? 'TRACKING_LOST' : 'NO_HAND', event: result.event === 'cancel' ? 'cancel' : undefined };
    }
    return {
      point: result.point && map(result.point),
      state: result.event === 'release' ? 'RELEASED' : states[result.state],
      event: result.event === 'release' ? 'drop' : result.event,
      hand,
      aspect,
    };
  }
}

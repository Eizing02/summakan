export interface Point { x: number; y: number }
export interface Landmark extends Point { z?: number }
export interface ObservedHand { landmarks: Landmark[]; handedness: 'Left' | 'Right'; confidence: number }
export type HandChoice = 'Auto' | 'Left' | 'Right';
export interface HandRange { left: number; right: number; top: number; bottom: number }
export interface Calibration { hand: HandChoice; cursorGain: number; pinch: number; reach: number; centerX: number; centerY: number; range?: HandRange }
export const defaultCalibration: Calibration = { hand: 'Auto', cursorGain: .85, pinch: 0.28, reach: 0.65, centerX: 0.5, centerY: 0.5 };
export type GestureState = 'NO_HAND' | 'HAND_DETECTED' | 'POINTING' | 'HOVERING' | 'PINCH_START' | 'GRABBING' | 'DRAGGING' | 'DROP_PENDING' | 'RELEASED' | 'TRACKING_LOST';
export interface GestureFrame {
  point: Point | null;
  state: GestureState;
  event?: 'grab' | 'drop' | 'cancel';
  hand?: ObservedHand;
  aspect?: number;
}
const clamp = (n: number) => Math.min(1, Math.max(0, n));

function distance(a: Point, b: Point, aspect = 1) {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

export function pinchRatio(landmarks: Landmark[], aspect: number) {
  const palmScale = (distance(landmarks[0], landmarks[9], aspect) + distance(landmarks[5], landmarks[17], aspect)) / 2;
  return distance(landmarks[4], landmarks[8], aspect) / Math.max(palmScale, 0.005);
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

class AimFilter {
  private previous: Point | null = null;
  private filtered: Point | null = null;
  private speed = 0;

  sample(raw: Point, delta: number, aspect: number): Point {
    if (!this.previous || !this.filtered) {
      this.previous = this.filtered = raw;
      return raw;
    }
    const instantaneous = distance(raw, this.previous, aspect) * 1000 / Math.max(1, delta);
    this.previous = raw;
    this.speed += (instantaneous - this.speed) * (1 - Math.exp(-delta / 110));
    const gap = distance(raw, this.filtered, aspect);
    const deadband = .004;
    if (gap <= deadband) return this.filtered;
    const response = 22 + 128 / (1 + 3.8 * this.speed);
    const weight = (1 - Math.exp(-delta / response)) * (1 - deadband / gap);
    this.filtered = {
      x: this.filtered.x + (raw.x - this.filtered.x) * weight,
      y: this.filtered.y + (raw.y - this.filtered.y) * weight,
    };
    return this.filtered;
  }
}

export class GestureMachine {
  private timestamp = -Infinity;
  private lastSeen = -Infinity;
  private owner: ObservedHand | null = null;
  private aim = new AimFilter();
  private gripBlend = 0;
  private armed = false;
  private pinched = false;
  private lost = false;
  private candidateAt: number | null = null;
  private releaseAt: number | null = null;

  frame(hands: ObservedHand[], timestamp: number, aspect: number, calibration: Calibration, hover = false): GestureFrame | null {
    if (!Number.isFinite(timestamp) || timestamp <= this.timestamp) return null;
    const delta = Math.min(timestamp - this.timestamp, 100);
    this.timestamp = timestamp;
    const valid = hands.filter(hand => hand.landmarks.length === 21 && hand.landmarks.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)) && hand.confidence >= 0.55 &&
      (calibration.hand === 'Auto' || hand.handedness === calibration.hand));
    let hand: ObservedHand | undefined;
    const owner = this.owner;
    if (owner) {
      const previousWrist = owner.landmarks[0];
      const radius = Math.max(0.13, distance(previousWrist, owner.landmarks[9], aspect) * 1.75);
      hand = valid.filter(candidate => candidate.handedness === owner.handedness)
        .map(candidate => ({ candidate, gap: distance(previousWrist, candidate.landmarks[0], aspect) }))
        .sort((a, b) => a.gap - b.gap).find(item => item.gap < radius)?.candidate;
    } else {
      hand = valid.reduce<ObservedHand | undefined>((best, candidate) => !best || candidate.confidence > best.confidence ? candidate : best, undefined);
    }

    if (!hand) {
      const elapsed = timestamp - this.lastSeen;
      this.lost = Boolean(owner);
      this.candidateAt = null;
      this.releaseAt = null;
      if (elapsed >= 260) {
        const held = this.pinched;
        this.pinched = false;
        this.armed = false;
        this.aim = new AimFilter();
        this.gripBlend = 0;
        if (elapsed >= 850) this.owner = null;
        return { point: null, state: owner ? 'TRACKING_LOST' : 'NO_HAND', event: held ? 'cancel' : undefined };
      }
      return { point: null, state: 'TRACKING_LOST' };
    }

    const index = hand.landmarks[8], thumb = hand.landmarks[4];
    const ratio = pinchRatio(hand.landmarks, aspect);
    const release = calibration.pinch + 0.10;
    const blendTarget = this.pinched && ratio < release ? .45 : 0;
    this.gripBlend += (blendTarget - this.gripBlend) * (1 - Math.exp(-delta / 90));
    const raw = { x: index.x + (thumb.x - index.x) * this.gripBlend, y: index.y + (thumb.y - index.y) * this.gripBlend };
    const point = cursorPoint(this.aim.sample(raw, delta, aspect), calibration);
    this.owner = hand;
    this.lastSeen = timestamp;
    const frame = (state: GestureState, event?: GestureFrame['event']): GestureFrame => ({ point, state, event, hand, aspect });

    if (this.lost && this.pinched && ratio >= release) {
      this.lost = false;
      this.pinched = false;
      this.armed = true;
      return frame('TRACKING_LOST', 'cancel');
    }
    this.lost = false;
    if (!this.armed) {
      if (ratio >= release) this.armed = true;
      return frame('HAND_DETECTED');
    }

    if (this.pinched) {
      if (ratio < release) {
        this.releaseAt = null;
        return frame('DRAGGING');
      }
      this.releaseAt ??= timestamp;
      if (timestamp - this.releaseAt < 38) return frame('DROP_PENDING');
      this.pinched = false;
      this.releaseAt = null;
      return frame('RELEASED', 'drop');
    }

    if (ratio <= calibration.pinch) {
      this.candidateAt ??= timestamp;
      if (timestamp - this.candidateAt < 35) return frame('PINCH_START');
      this.candidateAt = null;
      this.pinched = true;
      return frame('GRABBING', 'grab');
    }
    this.candidateAt = null;
    return frame(hover ? 'HOVERING' : 'POINTING');
  }
}

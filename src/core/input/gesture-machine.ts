export interface Point { x: number; y: number }
export interface Landmark extends Point { z?: number }
export interface ObservedHand { landmarks: Landmark[]; handedness: 'Left' | 'Right'; confidence: number }
export type HandChoice = 'Auto' | 'Left' | 'Right';
export interface Calibration { hand: HandChoice; cursorGain: number; pinch: number; reach: number; centerX: number; centerY: number }
export const defaultCalibration: Calibration = { hand: 'Auto', cursorGain: 1, pinch: 0.28, reach: 0.65, centerX: 0.5, centerY: 0.5 };
export type GestureState = 'NO_HAND' | 'HAND_DETECTED' | 'POINTING' | 'HOVERING' | 'PINCH_START' | 'GRABBING' | 'DRAGGING' | 'DROP_PENDING' | 'RELEASED' | 'TRACKING_LOST';
export interface GestureFrame {
  point: Point | null;
  state: GestureState;
  event?: 'grab' | 'drop' | 'cancel';
  hand?: ObservedHand;
}
const clamp = (n: number) => Math.min(1, Math.max(0, n));

function distance(a: Point, b: Point, aspect = 1) {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

export function pinchRatio(landmarks: Landmark[], aspect: number) {
  const palmScale = (distance(landmarks[0], landmarks[9], aspect) + distance(landmarks[5], landmarks[17], aspect)) / 2;
  return distance(landmarks[4], landmarks[8], aspect) / Math.max(palmScale, 0.005);
}

export function cursorPoint(raw: Point, calibration: Calibration): Point {
  const gain = calibration.cursorGain / calibration.reach;
  return { x: clamp(0.5 + (1 - raw.x - calibration.centerX) * gain), y: clamp(0.5 + (raw.y - calibration.centerY) * gain) };
}

export class GestureMachine {
  private timestamp = -Infinity;
  private lastSeen = -Infinity;
  private owner: ObservedHand | null = null;
  private point: Point | null = null;
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
        this.point = null;
        if (elapsed >= 850) this.owner = null;
        return { point: null, state: owner ? 'TRACKING_LOST' : 'NO_HAND', event: held ? 'cancel' : undefined };
      }
      return { point: null, state: 'TRACKING_LOST' };
    }

    const fresh = !this.point;
    const raw = cursorPoint(hand.landmarks[8], calibration);
    const previous = this.point ?? raw;
    const speed = distance(raw, previous) / Math.max(1, delta) * 1000;
    const alpha = 1 - Math.exp(-delta / (48 / (1 + Math.min(speed, 8))));
    this.point = { x: previous.x + (raw.x - previous.x) * alpha, y: previous.y + (raw.y - previous.y) * alpha };
    this.owner = hand;
    this.lastSeen = timestamp;
    const ratio = pinchRatio(hand.landmarks, aspect);
    const release = calibration.pinch + 0.10;
    const frame = (state: GestureState, event?: GestureFrame['event']): GestureFrame => ({ point: this.point, state, event, hand });

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
    return frame(fresh ? 'HAND_DETECTED' : hover ? 'HOVERING' : 'POINTING');
  }
}

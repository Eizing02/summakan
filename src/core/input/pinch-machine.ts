// Adapted from Eizing02/Thai-kum-prasom at a633d80, tuned for direct thumb-index pinch interaction.
import type { Point } from './gesture-machine';

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export class OneEuro {
  private previous?: { value: number; raw: number; speed: number; time: number }
  constructor(private minCutoff: number, private beta: number, private dCutoff = 1) {}
  reset() { this.previous = undefined }
  update(raw: number, time: number) {
    const last = this.previous
    if (!Number.isFinite(raw) || !Number.isFinite(time)) return last?.value ?? 0
    if (!last) {
      this.previous = { value: raw, raw, speed: 0, time }
      return raw
    }
    if (time <= last.time) return last.value
    const dt = Math.min(.3, (time - last.time) / 1000)
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt))
    const speed = last.speed + alpha(this.dCutoff) * ((raw - last.raw) / dt - last.speed)
    const value = last.value + alpha(this.minCutoff + this.beta * Math.abs(speed)) * (raw - last.value)
    this.previous = { value, raw, speed, time }
    return value
  }
}

export type HandPose = {
  landmarks: Point[]; hand: 'Left' | 'Right' | null; score: number; aspect: number;
}
export type GestureState = 'NO_HAND' | 'IDLE' | 'HOVER' | 'PINCH_CANDIDATE' | 'GRABBING' | 'DRAGGING' | 'RELEASE_PENDING' | 'COOLDOWN'
export type Gesture = { point: Point | null; state: GestureState; event?: 'grab' | 'release' | 'cancel'; gap: number | null }
interface GestureSettings {
  close: number;
  open: number;
  cutoff: number;
  beta: number;
  derivative: number;
  mirror: boolean;
  hand: 'auto' | 'Left' | 'Right';
  grace: number;
  holdGrace?: number;
}

export function handCoordinates(point: Point, mirror: boolean) {
  return { x: clamp(mirror ? 1 - point.x : point.x, .015, .985), y: clamp(point.y, .015, .985) }
}

export function pinchAnchor(landmarks: readonly Point[]): Point {
  const thumb = landmarks[4], index = landmarks[8];
  return { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };
}

export function measureHand(pose: HandPose) {
  const points = pose.landmarks
  if (points.length !== 21) return null
  const distance = (a: Point, b: Point) => Math.hypot((a.x - b.x) * pose.aspect, a.y - b.y)
  const scale = Math.max(distance(points[5], points[17]), distance(points[0], points[9]) * .85)
  if (!Number.isFinite(scale) || scale < .018) return null
  const index = points[8], thumb = points[4]
  const gap = distance(thumb, index) / scale
  if (!Number.isFinite(gap)) return null
  return { gap, anchor: pinchAnchor(points) }
}

export class PinchMachine {
  state: GestureState = 'NO_HAND'
  private point: Point | null = null
  private last = -Infinity
  private seen = -Infinity
  private pendingSince = 0
  private cooldownUntil = 0
  private count = 0
  private armed = false
  private pendingGrab: Point | null = null
  private pendingRelease: { point: Point; uncertain: boolean } | null = null
  private missing = false
  private x: OneEuro
  private y: OneEuro
  private gap: OneEuro

  constructor(private config: GestureSettings) {
    this.x = new OneEuro(config.cutoff, config.beta, config.derivative)
    this.y = new OneEuro(config.cutoff, config.beta, config.derivative)
    this.gap = new OneEuro(5.5, 1.8, config.derivative)
  }
  setThreshold(close: number, open: number) {
    this.config.close = close;
    this.config.open = open;
  }

  get isHolding() { return this.holding }
  private get holding() { return ['GRABBING', 'DRAGGING', 'RELEASE_PENDING'].includes(this.state) }
  private get activeGrace() { return this.holding ? (this.config.holdGrace ?? this.config.grace) : this.config.grace }
  private clearPose() {
    this.point = null
    this.x.reset()
    this.y.reset()
    this.gap.reset()
    this.pendingGrab = null
    this.pendingRelease = null
  }
  private startRelease(point: Point, time: number, uncertain: boolean) {
    this.state = 'RELEASE_PENDING'
    this.pendingRelease = { point, uncertain }
    this.pendingSince = time
    this.count = 1
  }
  cancel() {
    this.state = 'NO_HAND'
    this.clearPose()
    this.armed = false
    this.seen = -Infinity
    this.missing = false
  }
  update(pose: HandPose | null, time: number, hit: (point: Point) => boolean): Gesture {
    if (time <= this.last) return { point: this.point, state: this.state, gap: null }
    this.last = time
    const raw = pose && pose.score >= .42 && (this.config.hand === 'auto' || this.config.hand === pose.hand) ? measureHand(pose) : null
    const grace = this.activeGrace
    if (!raw) {
      if (time - this.seen < grace) {
        this.missing = true
        if (this.state === 'PINCH_CANDIDATE') {
          this.state = 'IDLE'
          this.pendingGrab = null
        }
        if (this.state === 'RELEASE_PENDING') {
          this.state = 'DRAGGING'
          this.pendingRelease = null
        }
        return { point: this.point, state: this.state, gap: null }
      }
      const event = this.holding ? 'cancel' : undefined
      this.cancel()
      return { point: null, state: this.state, gap: null, event }
    }
    const recovered = this.missing
    if (recovered && this.holding && time - this.seen >= grace) {
      this.cancel()
      return { point: null, state: this.state, gap: null, event: 'cancel' }
    }
    this.missing = false
    this.seen = time
    const gap = this.gap.update(raw.gap, time)
    const aim = handCoordinates(raw.anchor, this.config.mirror)
    const point = { x: this.x.update(aim.x, time), y: this.y.update(aim.y, time) }
    this.point = point
    if (recovered && this.holding && raw.gap > this.config.open) {
      this.startRelease(point, time, true)
      return { point, state: this.state, gap }
    }
    const hovering = !this.holding && hit(point)
    let event: Gesture['event']
    if (this.state === 'COOLDOWN' && time < this.cooldownUntil) return { point, state: this.state, gap }
    switch (this.state) {
      case 'GRABBING':
      case 'DRAGGING':
        if (raw.gap > this.config.open) this.startRelease(point, time, false)
        else this.state = 'DRAGGING'
        break
      case 'RELEASE_PENDING': {
        const release = this.pendingRelease!
        if (raw.gap <= this.config.open) {
          this.state = 'DRAGGING'
          this.pendingRelease = null
          break
        }
        // Keep the position at the onset of the opening while subsequent frames confirm it.
        this.point = release.point
        if (++this.count < 2 || time - this.pendingSince < 65) break
        if (release.uncertain) {
          this.cancel()
          return { point: null, state: this.state, gap, event: 'cancel' }
        }
        if (gap <= this.config.open) break
        this.state = 'COOLDOWN'
        this.pendingRelease = null
        this.cooldownUntil = time + 120
        this.armed = false
        event = 'release'
        break
      }
      case 'PINCH_CANDIDATE': {
        const origin = this.pendingGrab ?? point
        const stillOnTarget = hovering || hit(origin)
        if (!stillOnTarget || (raw.gap >= this.config.close && gap >= this.config.close)) {
          if (!stillOnTarget && raw.gap < this.config.close) this.armed = false
          this.pendingGrab = null
          this.state = hovering ? 'HOVER' : 'IDLE'
          break
        }
        // Hold the pinch onset point steady while thumb and index finish closing.
        this.point = origin
        if (++this.count >= 2 && (time - this.pendingSince >= 35 || raw.gap < this.config.close * .72)) {
          this.state = 'GRABBING'
          this.pendingGrab = null
          event = 'grab'
        }
        break
      }
      default:
        if (gap >= this.config.open || raw.gap >= this.config.open) this.armed = true
        if (this.armed && hovering && (raw.gap < this.config.close || gap < this.config.close)) {
          if (raw.gap < this.config.close * .62 && gap < this.config.close) {
            this.state = 'GRABBING'
            this.pendingGrab = null
            event = 'grab'
          } else {
            this.state = 'PINCH_CANDIDATE'
            this.pendingGrab = point
            this.pendingSince = time
            this.count = 1
          }
        } else {
          if (!hovering && raw.gap < this.config.close) this.armed = false
          this.state = hovering ? 'HOVER' : 'IDLE'
        }
    }
    return { point: this.point, state: this.state, event, gap }
  }
}

import { MAX_ANGLE } from './balance-engine';

export class BalanceSpring {
  angle = 0;
  velocity = 0;
  private remaining = 0;

  update(target: number, delta: number, reducedMotion = false) {
    if (reducedMotion) {
      this.angle = target;
      this.velocity = 0;
      this.remaining = 0;
      return this.angle;
    }
    const timestep = 1 / 120;
    this.remaining += Math.max(0, Math.min(delta, 0.05));
    while (this.remaining >= timestep) {
      const acceleration = 100 * (target - this.angle) - 15 * this.velocity;
      this.velocity += acceleration * timestep;
      this.angle += this.velocity * timestep;
      if (Math.abs(this.angle) > MAX_ANGLE) {
        this.angle = Math.sign(this.angle) * MAX_ANGLE;
        this.velocity = 0;
      }
      this.remaining -= timestep;
    }
    if (Math.abs(this.angle - target) < 0.00001 && Math.abs(this.velocity) < 0.0001) {
      this.angle = target;
      this.velocity = 0;
    }
    return this.angle;
  }
}

export function endpoints(angle: number, span: number) {
  return { left: -span * Math.sin(angle), right: span * Math.sin(angle), panRotation: angle - angle };
}

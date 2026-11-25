function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export class Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;

  constructor(n: bigint | number, d: bigint | number = 1n) {
    let numerator = BigInt(n);
    let denominator = BigInt(d);
    if (denominator === 0n) throw new Error('ตัวส่วนต้องไม่เป็นศูนย์');
    if (denominator < 0n) {
      numerator = -numerator;
      denominator = -denominator;
    }
    const common = gcd(numerator, denominator);
    this.numerator = numerator / common;
    this.denominator = denominator / common;
  }

  add(r: Rational) {
    return new Rational(this.numerator * r.denominator + r.numerator * this.denominator, this.denominator * r.denominator);
  }
  subtract(r: Rational) { return this.add(r.negate()); }
  multiply(r: Rational) { return new Rational(this.numerator * r.numerator, this.denominator * r.denominator); }
  divide(r: Rational) { return new Rational(this.numerator * r.denominator, this.denominator * r.numerator); }
  negate() { return new Rational(-this.numerator, this.denominator); }
  abs() { return this.numerator < 0n ? this.negate() : this; }
  equals(r: Rational) { return this.numerator === r.numerator && this.denominator === r.denominator; }
  get isZero() { return this.numerator === 0n; }

  toNumber() {
    // Retain the leading 16 digits on both sides so even large BigInts can drive the renderer.
    const numerator = this.abs().numerator.toString();
    const denominator = this.denominator.toString();
    const a = numerator.slice(0, 16);
    const b = denominator.slice(0, 16);
    const magnitude = (Number(a) / Number(b)) * 10 ** (numerator.length - a.length - denominator.length + b.length);
    return this.numerator < 0n ? -magnitude : magnitude;
  }

  toString() { return this.denominator === 1n ? String(this.numerator) : this.numerator + '/' + this.denominator; }
  toTex() {
    const sign = this.numerator < 0n ? '-' : '';
    return this.denominator === 1n ? String(this.numerator) : sign + '\\frac{' + this.abs().numerator + '}{' + this.denominator + '}';
  }
}

export const ZERO = new Rational(0);
export const ONE = new Rational(1);

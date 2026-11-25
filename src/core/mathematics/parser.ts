import { addExpression, linear, multiplyExpression, type LinearExpression } from './linear-expression';
import { solveEquation } from './equation-engine';
import { ONE, Rational, ZERO } from './rational';

const thaiDigits = '๐๑๒๓๔๕๖๗๘๙';

export function parseEquation(source: string) {
  if (source.length > 160) throw new Error('สมการยาวเกิน 160 อักขระ');
  const normalized = source.toLowerCase()
    .replace(/[๐-๙]/g, digit => String(thaiDigits.indexOf(digit)))
    .replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/');
  const tokens = normalized.match(/\d+|[x+*/()=\-]|\S/g) ?? [];
  let position = 0;
  const peek = () => tokens[position];

  function atom(): LinearExpression {
    const token = tokens[position++];
    if (token === '+') return atom();
    if (token === '-') return multiplyExpression(atom(), ONE.negate());
    if (token === 'x') return linear(ONE);
    if (token === '(') {
      const value = sum();
      if (tokens[position++] !== ')') throw new Error('ต้องปิดวงเล็บให้ครบ');
      return value;
    }
    if (!token || !/^\d{1,12}$/.test(token)) throw new Error('ใช้จำนวนเต็ม x และเครื่องหมาย + − × ÷ หรือวงเล็บ');
    return linear(ZERO, new Rational(BigInt(token)));
  }

  function product() {
    let left = atom();
    while (peek() === '*' || peek() === '/' || peek() === '(' || peek() === 'x') {
      const divide = peek() === '/';
      if (divide || peek() === '*') position += 1;
      const right = atom();
      if (divide) {
        if (!right.coefficient.isZero) throw new Error('ตัวหารต้องเป็นค่าคงตัว');
        if (right.constant.isZero) throw new Error('หารด้วย 0 ไม่ได้');
        left = multiplyExpression(left, ONE.divide(right.constant));
      } else {
        if (!left.coefficient.isZero && !right.coefficient.isZero) throw new Error('สมการต้องเป็นเชิงเส้น');
        left = right.coefficient.isZero ? multiplyExpression(left, right.constant) : multiplyExpression(right, left.constant);
      }
    }
    return left;
  }

  function sum() {
    let left = product();
    while (peek() === '+' || peek() === '-') {
      const subtract = tokens[position++] === '-';
      const right = product();
      left = addExpression(left, subtract ? multiplyExpression(right, ONE.negate()) : right);
    }
    return left;
  }

  const left = sum();
  if (tokens[position++] !== '=') throw new Error('ต้องมีเครื่องหมาย = คั่นระหว่างสองฝั่ง');
  const right = sum();
  if (position !== tokens.length) throw new Error('สมการมีอักขระหรือเครื่องหมายเกิน');
  const equation = { left, right };
  return { equation, solution: solveEquation(equation) };
}

export function parseAnswer(source: string): Rational {
  const converted = source.trim().replace(/[๐-๙]/g, digit => String(thaiDigits.indexOf(digit))).replace(/−/g, '-');
  if (!/^[+-]?\d{1,80}(\s*\/\s*[+-]?\d{1,80})?$/.test(converted)) {
    throw new Error('พิมพ์จำนวนเต็มหรือเศษส่วน เช่น −5 หรือ 2/3');
  }
  const [n, d = '1'] = converted.split('/');
  return new Rational(BigInt(n.trim()), BigInt(d.trim()));
}

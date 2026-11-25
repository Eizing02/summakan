import { addExpression, linear, multiplyExpression, type LinearExpression } from './linear-expression';
import { ONE, Rational, ZERO } from './rational';

export const operators = ['+', '−', '×', '÷'] as const;
export type Operator = typeof operators[number];
export interface Operation { operator: Operator; value: Rational }
export interface AffineTransform { a: Rational; b: Rational }

export const operatorTex: Record<Operator, string> = { '+': '+', '−': '-', '×': '\\times', '÷': '\\div' };

export function validateOperation({ operator, value }: Operation) {
  if ((operator === '×' || operator === '÷') && value.isZero) {
    throw new Error(operator === '×' ? 'การคูณด้วย 0 ไม่รักษาชุดคำตอบของสมการ' : 'หารด้วย 0 ไม่ได้');
  }
}

export function composeOperations(operations: readonly Operation[]): AffineTransform {
  let a = ONE;
  let b = ZERO;
  for (const operation of operations) {
    validateOperation(operation);
    const { operator, value } = operation;
    switch (operator) {
      case '+': b = b.add(value); break;
      case '−': b = b.subtract(value); break;
      case '×': a = a.multiply(value); b = b.multiply(value); break;
      case '÷': a = a.divide(value); b = b.divide(value); break;
    }
  }
  return { a, b };
}

export function sameTransform(left: AffineTransform, right: AffineTransform) {
  return left.a.equals(right.a) && left.b.equals(right.b);
}

export function applyTransform(transform: AffineTransform, expression: LinearExpression) {
  return addExpression(multiplyExpression(expression, transform.a), linear(ZERO, transform.b));
}

export function applyToValue({ a, b }: AffineTransform, value: Rational) {
  return a.multiply(value).add(b);
}

export function visualExpression(base: string, operations: readonly Operation[], tex = false): string {
  let result = base;
  for (const { operator, value } of operations) {
    const scale = operator === '×' || operator === '÷';
    const leftBracket = tex ? '\\left(' : '(';
    const rightBracket = tex ? '\\right)' : ')';
    if (scale) result = leftBracket + result + rightBracket;
    const operand = tex ? value.toTex() : value.toString();
    result += ' ' + (tex ? operatorTex[operator] : operator) + ' ' +
      (value.numerator < 0n ? leftBracket + operand + rightBracket : operand);
  }
  return result;
}

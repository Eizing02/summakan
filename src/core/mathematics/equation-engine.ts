import { applyTransform, composeOperations, sameTransform, type Operation } from './affine-transform';
import { evaluateExpression, expressionsEqual, type Equation } from './linear-expression';
import { ONE, type Rational } from './rational';

export function solveEquation({ left, right }: Equation): Rational {
  const difference = left.coefficient.subtract(right.coefficient);
  const constant = right.constant.subtract(left.constant);
  if (difference.isZero) {
    throw new Error(constant.isZero ? 'สมการเป็นจริงสำหรับ x ทุกค่า' : 'สมการนี้ไม่มีคำตอบ');
  }
  return constant.divide(difference);
}

export function isolatedValue({ left, right }: Equation): Rational | null {
  if (left.coefficient.equals(ONE) && left.constant.isZero && right.coefficient.isZero) return right.constant;
  if (right.coefficient.equals(ONE) && right.constant.isZero && left.coefficient.isZero) return left.constant;
  return null;
}

export function verifySolution(equation: Equation, candidate: Rational) {
  const left = evaluateExpression(equation.left, candidate);
  const right = evaluateExpression(equation.right, candidate);
  return { left, right, valid: left.equals(right) };
}

export function simplifyBalanced(equation: Equation, pending: Record<'left' | 'right', readonly Operation[]>) {
  const leftTransform = composeOperations(pending.left);
  const rightTransform = composeOperations(pending.right);
  if (!pending.left.length || !pending.right.length || !sameTransform(leftTransform, rightTransform)) return null;
  const next = { left: applyTransform(leftTransform, equation.left), right: applyTransform(rightTransform, equation.right) };
  if (!solveEquation(next).equals(solveEquation(equation))) throw new Error('เงื่อนไขชุดคำตอบเปลี่ยนแปลง');
  const changed = !expressionsEqual(next.left, equation.left) || !expressionsEqual(next.right, equation.right);
  return { next, changed, transform: leftTransform };
}

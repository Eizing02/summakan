import { applyToValue, composeOperations, sameTransform, type Operation } from '../mathematics/affine-transform';
import { solveEquation } from '../mathematics/equation-engine';
import { evaluateExpression, type Equation, type Side } from '../mathematics/linear-expression';

export const MAX_ANGLE = 25 * Math.PI / 180;

export function balanceReference(equation: Equation) {
  if (equation.right.coefficient.isZero) return equation.right.constant;
  if (equation.left.coefficient.isZero) return equation.left.constant;
  return evaluateExpression(equation.left, solveEquation(equation));
}

export function assessBalance(equation: Equation, pending: Record<Side, readonly Operation[]>) {
  const reference = balanceReference(equation);
  const left = composeOperations(pending.left);
  const right = composeOperations(pending.right);
  const difference = applyToValue(left, reference).subtract(applyToValue(right, reference));
  return { difference, visual: difference.isZero, mathematical: sameTransform(left, right) };
}

export function angleForDifference(difference: number, sensitivity = 5) {
  // Positive Z lowers the left endpoint in the front-facing camera.
  return MAX_ANGLE * Math.tanh(difference / Math.max(0.1, sensitivity));
}

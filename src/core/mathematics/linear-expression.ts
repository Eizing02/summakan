import { ONE, Rational, ZERO } from './rational';

export interface LinearExpression {
  coefficient: Rational;
  constant: Rational;
}

export interface Equation { left: LinearExpression; right: LinearExpression }
export type Side = keyof Equation;

export function linear(a: Rational = ZERO, b: Rational = ZERO): LinearExpression {
  return { coefficient: a, constant: b };
}

export function addExpression(a: LinearExpression, b: LinearExpression) {
  return linear(a.coefficient.add(b.coefficient), a.constant.add(b.constant));
}

export function multiplyExpression(expression: LinearExpression, n: Rational) {
  return linear(expression.coefficient.multiply(n), expression.constant.multiply(n));
}

export function evaluateExpression(expression: LinearExpression, value: Rational) {
  return expression.coefficient.multiply(value).add(expression.constant);
}

export function expressionText(expression: LinearExpression, tex = false): string {
  const { coefficient, constant } = expression;
  const number = (value: Rational) => tex ? value.toTex() : value.toString();
  if (coefficient.isZero) return number(constant);
  const factor = coefficient.abs().equals(ONE) ? '' : number(coefficient.abs());
  const variable = (coefficient.numerator < 0n ? '-' : '') + factor + 'x';
  if (constant.isZero) return variable;
  return variable + (constant.numerator < 0n ? ' - ' : ' + ') + number(constant.abs());
}

export function equationText(equation: Equation, tex = false): string {
  return expressionText(equation.left, tex) + ' = ' + expressionText(equation.right, tex);
}

export function expressionsEqual(a: LinearExpression, b: LinearExpression) {
  return a.coefficient.equals(b.coefficient) && a.constant.equals(b.constant);
}

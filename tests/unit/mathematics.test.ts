import { describe, expect, it } from 'vitest';
import { assessBalance } from '../../src/core/balance/balance-engine';
import { composeOperations, sameTransform, visualExpression, type Operation, type Operator } from '../../src/core/mathematics/affine-transform';
import { simplifyBalanced, verifySolution } from '../../src/core/mathematics/equation-engine';
import { equationText } from '../../src/core/mathematics/linear-expression';
import { parseEquation } from '../../src/core/mathematics/parser';
import { Rational } from '../../src/core/mathematics/rational';
import { makeQuestion, questionBank, randomQuestion } from '../../src/features/questions/questions';

const op = (operator: Operator, value: number): Operation => ({ operator, value: new Rational(value) });
const solveRound = (source: string, left: Operation[], right: Operation[]) => simplifyBalanced(parseEquation(source).equation, { left, right });

describe('exact arithmetic and the equality properties', () => {
  it('adds, subtracts, multiplies and divides exact integers and fractions', () => {
    expect(new Rational(2).add(new Rational(3)).toString()).toBe('5');
    expect(new Rational(2).subtract(new Rational(5)).toString()).toBe('-3');
    expect(new Rational(-2).multiply(new Rational(-3)).toString()).toBe('6');
    expect(new Rational(2).divide(new Rational(3)).toString()).toBe('2/3');
    expect(new Rational(123456789123456789n, -3n).toString()).toBe('-41152263041152263');
    expect(new Rational(10n ** 400n, 3n * 10n ** 399n).toNumber()).toBeCloseTo(10 / 3);
  });
  it.each([
    ['01', 'x − 3 = 5', [op('+', 3)], [op('+', 1), op('+', 1), op('+', 1)], 'x = 8'],
    ['02', '2x + 3 = 9', [op('−', 3)], [op('−', 1), op('−', 2)], '2x = 6'],
    ['03', '2x = 6', [op('÷', 2)], [op('÷', 2)], 'x = 3'],
    ['04', '6x = 24', [op('÷', 6)], [op('÷', 2), op('÷', 3)], 'x = 4'],
    ['05', 'x / 6 = 4', [op('×', 6)], [op('×', 2), op('×', 3)], 'x = 24'],
    ['11', '3x = 2', [op('÷', 3)], [op('÷', 3)], 'x = 2/3'],
    ['12', '−3x + 5 = 20', [op('−', 5)], [op('−', 5)], '-3x = 15'],
    ['13a', '−3x = 15', [op('÷', 3)], [op('÷', 3)], '-x = 5'],
    ['13b', '−3x = 15', [op('×', 2), op('÷', 6)], [op('×', 2), op('÷', 6)], '-x = 5'],
    ['13c', '−x = 5', [op('×', -1)], [op('÷', -1)], 'x = -5'],
  ])('case %s simplifies only the chosen operation', (_, source, left, right, expected) => {
    expect(equationText(solveRound(source, left, right)!.next)).toBe(expected);
  });
  it('cases 06 and 07 compare both affine parameters exactly', () => {
    const equivalent = (a: Operation[], b: Operation[]) => sameTransform(composeOperations(a), composeOperations(b));
    expect(equivalent([op('+', 5)], [op('+', 8), op('−', 3)])).toBe(true);
    expect(equivalent([op('×', 2), op('+', 4)], [op('+', 2), op('×', 2)])).toBe(true);
    expect(equivalent([op('×', 6)], [op('×', 2), op('×', 2)])).toBe(false);
  });
  it('cases 08–10 reject imbalance and zero multiplication or division', () => {
    expect(solveRound('x − 3 = 5', [op('+', 3)], [op('+', 2)])).toBeNull();
    expect(() => solveRound('x = 2', [op('÷', 0)], [])).toThrow();
    expect(() => solveRound('x = 2', [op('×', 0)], [op('×', 0)])).toThrow();
  });
  it('preserves original operation order, verifies solutions and treats identities as no progress', () => {
    expect(visualExpression('x - 3', [op('+', 3), op('×', 2)])).toBe('(x - 3 + 3) × 2');
    expect(verifySolution(parseEquation('3x=2').equation, new Rational(2, 3)).valid).toBe(true);
    expect(solveRound('-x = 5', [op('+', 0)], [op('+', 0)])?.changed).toBe(false);
  });
  it('distinguishes visual balance from equivalence at a crossing point', () => {
    const { equation } = parseEquation('x + 1 = 2');
    const result = assessBalance(equation, { left: [op('×', 2)], right: [op('+', 2)] });
    expect(result.visual).toBe(true);
    expect(result.mathematical).toBe(false);
  });
  it('parses exact linear expressions and rejects invalid/non-unique questions', () => {
    expect(parseEquation('๒(x + ๓) = 4x − 8').solution.toString()).toBe('7');
    expect(parseEquation('3(x + 2) = 18').solution.toString()).toBe('4');
    for (const invalid of ['x= x + 1', '2x = x+x', 'x / 0 = 1', 'x*x=2', 'x=alert(1)', 'x=2=3']) {
      expect(() => parseEquation(invalid)).toThrow();
    }
    expect(() => makeQuestion('5x+3=2x+15', 6, 'unsupported')).toThrow();
    expect(() => makeQuestion('11x=2', 6, 'unsupported')).toThrow();
    expect(makeQuestion('6 = 2x', 3, 'right').expectedSolution.toString()).toBe('3');
  });
  it('ships 360 distinct validated questions and selects the shared bank without repeats', () => {
    expect(questionBank).toHaveLength(360);
    const signatures = new Set(questionBank.map(question => equationText(question.equation)));
    expect(signatures.size).toBe(360);
    for (let level = 1; level <= 6; level += 1) {
      const used = new Set<string>();
      for (let i = 0; i < 60; i++) {
        const question = randomQuestion(level, used, () => 0)!;
        expect(question.level).toBe(level);
        expect(verifySolution(question.equation, question.expectedSolution).valid).toBe(true);
        used.add(equationText(question.equation));
      }
      expect(used.size).toBe(60);
      expect(randomQuestion(level, used)).toBeNull();
    }
  });
});

import { operatorTex, type Operation } from '../../core/mathematics/affine-transform';
import { expressionText, linear, type LinearExpression } from '../../core/mathematics/linear-expression';
import { ZERO, type Rational } from '../../core/mathematics/rational';

interface Part { tex: string; additive?: Rational; cancellation?: 'first' | 'second' }

export function expressionParts(base: LinearExpression, operations: readonly Operation[]): Part[] {
  let lastScale = -1;
  let scaleCount = 0;
  operations.forEach(({ operator }, index) => {
    if (operator === '×' || operator === '÷') { lastScale = index; scaleCount += 1; }
  });
  const open = '('.repeat(scaleCount);
  const parts: Part[] = [];
  if (base.coefficient.isZero) {
    parts.push({ tex: open + base.constant.toTex(), additive: lastScale === -1 ? base.constant : undefined });
  } else {
    parts.push({ tex: open + expressionText(linear(base.coefficient, ZERO), true) });
    if (!base.constant.isZero) {
      parts.push({
        tex: (base.constant.numerator < 0n ? '-' : '+') + '\\,' + base.constant.abs().toTex(),
        additive: lastScale === -1 ? base.constant : undefined,
      });
    }
  }
  operations.forEach(({ operator, value }, index) => {
    const scale = operator === '×' || operator === '÷';
    parts.push({
      tex: (scale ? ')' : '') + operatorTex[operator] + '\\,' + (value.numerator < 0n ? '(' + value.toTex() + ')' : value.toTex()),
      additive: index > lastScale ? operator === '−' ? value.negate() : value : undefined,
    });
  });
  for (let i = 0; i < parts.length; i += 1) {
    const term = parts[i];
    if (!term.additive || term.additive.isZero || term.cancellation) continue;
    const opposite = term.additive.negate();
    const partner = parts.slice(i + 1).find(other => other.additive?.equals(opposite) && !other.cancellation);
    if (partner) {
      term.cancellation = 'first';
      partner.cancellation = 'second';
    }
  }
  return parts;
}

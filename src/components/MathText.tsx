import katex from 'katex';
import { useMemo } from 'react';

// TeX is generated from validated expressions. KaTeX keeps the visual and MathML forms together.
export function MathText({ tex, className }: { tex: string; className?: string }) {
  const html = useMemo(() => katex.renderToString(tex, { throwOnError: false, trust: false, output: 'htmlAndMathml' }), [tex]);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }}/>;
}

export function originalTex(source: string, substitution?: string) {
  const thai = '๐๑๒๓๔๕๖๗๘๙';
  return source.toLowerCase().replace(/[๐-๙]/g, char => String(thai.indexOf(char)))
    .replace(/[^0-9x+−×÷=()/\- *]/g, '').replace(/−/g, '-')
    .replace(/[×*]/g, '\\times ').replace(/[÷/]/g, '\\div ')
    .replace(/x/g, substitution === undefined ? 'x' : '\\left(' + substitution + '\\right)');
}

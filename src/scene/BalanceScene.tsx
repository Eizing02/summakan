import { Component, lazy, Suspense, useEffect, useRef, type ReactNode } from 'react';
import { BalanceSpring } from '../core/balance/spring-physics';
import type { SceneProps } from './types';

const ThreeScene = lazy(() => import('./ThreeScene'));

function VectorScale({ target, reduced, anchors, mood }: SceneProps) {
  const svg = useRef<SVGSVGElement>(null);
  const beam = useRef<SVGGElement>(null);
  const left = useRef<SVGGElement>(null);
  const right = useRef<SVGGElement>(null);
  const values = useRef({ target, reduced, anchors });
  values.current = { target, reduced, anchors };
  useEffect(() => {
    const spring = new BalanceSpring();
    let frame = 0;
    let previous = performance.now();
    const animate = (time: number) => {
      const value = values.current;
      const angle = spring.update(value.target, (time - previous) / 1000, value.reduced);
      previous = time;
      const degrees = angle * 180 / Math.PI;
      beam.current?.setAttribute('transform', `rotate(${-degrees} 500 152)`);
      left.current?.setAttribute('transform', `rotate(${degrees} 240 152)`);
      right.current?.setAttribute('transform', `rotate(${degrees} 760 152)`);
      const matrix = svg.current?.getScreenCTM();
      const rect = svg.current?.parentElement?.getBoundingClientRect();
      if (matrix && rect && value.anchors) {
        for (const side of ['left', 'right'] as const) {
          const offset = (side === 'left' ? -1 : 1) * 260;
          const point = new DOMPoint(500 + offset * Math.cos(angle), 152 - offset * Math.sin(angle) + 134).matrixTransform(matrix);
          const node = value.anchors[side].current;
          if (node) {
            node.style.setProperty('--anchor-x', (point.x - rect.left) + 'px');
            node.style.setProperty('--anchor-y', (point.y - rect.top) + 'px');
            node.dataset.angle = angle.toFixed(3);
          }
        }
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);
  const crystals = { idle: '#78ccff', uneven: '#ffa379', even: '#70e6b5', waiting: '#ebbe66', victory: '#ffed9e' };
  return <svg className="vector-scale" ref={svg} viewBox="50 0 900 382" aria-hidden="true">
    <defs>
      <linearGradient id="scale-gold" x2="0" y2="1"><stop stopColor="#ffe6a0"/><stop offset=".44" stopColor="#bb782c"/><stop offset=".72" stopColor="#f5c35e"/><stop offset="1" stopColor="#73441c"/></linearGradient>
      <radialGradient id="scale-floor"><stop stopColor="#5d6d91" stopOpacity=".45"/><stop offset="1" stopColor="#25324a" stopOpacity="0"/></radialGradient>
    </defs>
    <ellipse cx="500" cy="341" rx="370" ry="49" fill="url(#scale-floor)" />
    <g stroke="#a97e47" strokeOpacity=".35" fill="none"><ellipse cx="500" cy="339" rx="313" ry="36"/><ellipse cx="500" cy="339" rx="294" ry="30"/></g>
    <g fill="url(#scale-gold)" stroke="#f6d38a" strokeWidth="2">
      <path d="M414 330q0-22 35-29h102q35 7 35 29q0 17-86 20q-86-3-86-20Z"/>
      <ellipse cx="500" cy="314" rx="70" ry="12" fill="#342740"/>
      <path d="M461 306q21-12 25-29l3-111h22l3 111q4 17 25 29Z"/>
      <path d="M478 193l22-13l22 13l-7 12h-30Z"/>
      <path d="M475 159q25-41 50 0l-12 13h-26Z"/>
    </g>
    <g ref={beam}>
      <path d="M228 148Q365 116 500 145Q635 116 772 148L772 157Q645 141 500 162Q351 141 228 157Z" fill="url(#scale-gold)" stroke="#f2d38f" strokeWidth="2"/>
      {([['left', 240, left], ['right', 760, right]] as const).map(([side, x, ref]) => <g key={side} ref={ref}>
        <circle cx={x} cy="152" r="9" fill="#523855" stroke="#ffda87" strokeWidth="3"/>
        <path d={`M${x} 158l-96 134m96-134 96 134m-96-134v140`} stroke="#b9955f" strokeWidth="2" fill="none"/>
        <path d={`M${x-105} 286q6 37 105 43q99-6 105-43Z`} fill="url(#scale-gold)" stroke="#ffdb8e" strokeWidth="2"/>
        <ellipse cx={x} cy="286" rx="105" ry="17" fill="#533f46" stroke="#ffdb8e" strokeWidth="3"/>
      </g>)}
    </g>
    <circle cx="500" cy="152" r="19" fill="#2b2b42" stroke="#f9cd74" strokeWidth="4"/>
    <path d="M500 106l15 22-15 23-15-23Z" fill={crystals[mood]} stroke="#e7f8ff" strokeWidth="1.5"/>
    <path d="M500 106v45l15-23Z" fill="#fff" opacity=".34"/>
  </svg>;
}

class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

let webgl: boolean | undefined;
function supportsWebGL() {
  if (webgl !== undefined) return webgl;
  try {
    const context = document.createElement('canvas').getContext('webgl2');
    webgl = Boolean(context);
    context?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { webgl = false; }
  return webgl;
}

export default function BalanceScene(props: SceneProps) {
  return <div className="scale-surface">
    {props.quality === '2d' || !supportsWebGL() ? <VectorScale {...props} /> :
      <SceneBoundary fallback={<VectorScale {...props} />}>
        <Suspense fallback={<VectorScale {...props} />}><ThreeScene {...props} /></Suspense>
      </SceneBoundary>}
  </div>;
}

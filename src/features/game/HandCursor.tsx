import { useEffect, useImperativeHandle, useRef, type RefObject } from 'react';
import type { GestureFrame, Landmark, Point } from '../../core/input/gesture-machine';

const fingers = [[0, 1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
const palm = [0, 1, 2, 5, 9, 13, 17];

export interface HandCursorDisplay {
  show: (frame: GestureFrame, point: Point, holding: boolean, hovering: boolean) => void;
  fade: () => void;
  hide: () => void;
}

function fitHand(landmarks: Landmark[], aspect: number) {
  const points = landmarks.map(point => ({ x: (1 - point.x) * aspect, y: point.y }));
  const left = Math.min(...points.map(point => point.x));
  const right = Math.max(...points.map(point => point.x));
  const top = Math.min(...points.map(point => point.y));
  const bottom = Math.max(...points.map(point => point.y));
  const scale = 47 / Math.max(right - left, bottom - top, .05);
  const centerX = (left + right) / 2, centerY = (top + bottom) / 2;
  return points.map(point => ({ x: 32 + (point.x - centerX) * scale, y: 32 + (point.y - centerY) * scale }));
}

function pathThrough(points: Point[], landmarkIds: number[]) {
  const path = landmarkIds.map(id => points[id].x.toFixed(1) + ' ' + points[id].y.toFixed(1));
  return 'M' + path.join('L');
}

export function HandCursor({ display, reduced }: { display: RefObject<HandCursorDisplay | null>; reduced: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const skeleton = useRef<SVGPathElement>(null);
  const outline = useRef<SVGPathElement>(null);
  const palmShape = useRef<SVGPathElement>(null);
  const animation = useRef(0);
  const target = useRef<Point[]>([]);
  const current = useRef<Point[]>([]);
  const previousTime = useRef(0);

  function draw(pose: Point[]) {
    const fingerPath = fingers.map(chain => pathThrough(pose, chain)).join(' ');
    outline.current?.setAttribute('d', fingerPath);
    palmShape.current?.setAttribute('d', pathThrough(pose, palm) + 'Z');
    skeleton.current?.setAttribute('d', fingerPath);
  }

  function animate(now: number) {
    animation.current = 0;
    const weight = 1 - Math.exp(-Math.max(0, now - previousTime.current) / 36);
    previousTime.current = now;
    let largestChange = 0;
    current.current = current.current.map((point, i) => {
      const destination = target.current[i];
      largestChange = Math.max(largestChange, Math.abs(destination.x - point.x), Math.abs(destination.y - point.y));
      return { x: point.x + (destination.x - point.x) * weight, y: point.y + (destination.y - point.y) * weight };
    });
    if (largestChange > .16) animation.current = requestAnimationFrame(animate);
    else current.current = target.current;
    draw(current.current);
  }

  useImperativeHandle(display, () => ({
    show(frame, point, holding, hovering) {
      const element = root.current;
      if (!element || !frame.hand) return;
      element.style.setProperty('--cursor-x', point.x + 'px');
      element.style.setProperty('--cursor-y', point.y + 'px');
      element.dataset.mode = holding ? 'holding' : frame.state === 'PINCH_START' ? 'pinching' : hovering ? 'target' : 'aim';
      element.dataset.pose = frame.state;
      element.dataset.edgeX = point.x > window.innerWidth - 70 ? 'true' : 'false';
      element.dataset.edgeY = point.y > window.innerHeight - 70 ? 'true' : 'false';
      target.current = fitHand(frame.hand.landmarks, frame.aspect ?? 1);
      if (reduced || !current.current.length) {
        cancelAnimationFrame(animation.current);
        animation.current = 0;
        current.current = target.current;
        draw(current.current);
      } else if (!animation.current) {
        previousTime.current = performance.now();
        animation.current = requestAnimationFrame(animate);
      }
    },
    fade() {
      if (root.current && root.current.dataset.mode !== 'hidden') root.current.dataset.mode = 'lost';
    },
    hide() {
      if (root.current) root.current.dataset.mode = 'hidden';
      cancelAnimationFrame(animation.current);
      animation.current = 0;
      current.current = [];
    },
  }), [reduced]);

  useEffect(() => () => cancelAnimationFrame(animation.current), []);

  return <div ref={root} className="hand-cursor" data-mode="hidden" aria-hidden="true">
    <span className="hand-cursor-aim"><i/></span>
    <svg className="hand-cursor-shape" viewBox="0 0 64 64" focusable="false">
      <path ref={palmShape} className="hand-cursor-palm"/>
      <path ref={outline} className="hand-cursor-fingers"/>
      <path ref={skeleton} className="hand-cursor-bones"/>
    </svg>
  </div>;
}

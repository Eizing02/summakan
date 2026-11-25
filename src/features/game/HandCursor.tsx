import { useEffect, useImperativeHandle, useRef, type RefObject } from 'react';
import type { GestureFrame, Landmark, Point } from '../../core/input/gesture-machine';

const fingers = [[0, 1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
const palm = [0, 1, 2, 5, 9, 13, 17];

export interface HandCursorDisplay {
  show: (frame: GestureFrame, point: Point, holding: boolean, hovering: boolean) => void;
  fade: (immediate?: boolean) => void;
  hide: () => void;
}

interface CursorTransition { from: Point; to: Point; started: number; duration: number }

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

export function HandCursor({ display, reduced, onMove }: {
  display: RefObject<HandCursorDisplay | null>; reduced: boolean; onMove: (point: Point) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const shape = useRef<SVGSVGElement>(null);
  const skeleton = useRef<SVGPathElement>(null);
  const outline = useRef<SVGPathElement>(null);
  const palmShape = useRef<SVGPathElement>(null);
  const animation = useRef(0);
  const lostTimer = useRef(0);
  const visiblePoint = useRef<Point | null>(null);
  const transition = useRef<CursorTransition | null>(null);
  const lastSample = useRef(0);
  const sampleInterval = useRef(65);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const target = useRef<Point[]>([]);
  const current = useRef<Point[]>([]);
  const previousTime = useRef(0);

  function draw(pose: Point[]) {
    const fingerPath = fingers.map(chain => pathThrough(pose, chain)).join(' ');
    outline.current?.setAttribute('d', fingerPath);
    palmShape.current?.setAttribute('d', pathThrough(pose, palm) + 'Z');
    skeleton.current?.setAttribute('d', fingerPath);
  }

  function drawPoint(point: Point) {
    const element = root.current;
    if (!element) return;
    visiblePoint.current = point;
    element.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
    // Keep the hand drawing in view as the cursor approaches either edge.
    const x = Math.min(7, window.innerWidth - point.x - 66);
    const y = Math.min(5, window.innerHeight - point.y - 66);
    if (shape.current) shape.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    onMoveRef.current(point);
  }

  function animate(now: number) {
    animation.current = 0;
    const movement = transition.current;
    if (movement) {
      const progress = Math.min(1, Math.max(0, (now - movement.started) / movement.duration));
      const eased = 1 - (1 - progress) ** 2;
      drawPoint({
        x: movement.from.x + (movement.to.x - movement.from.x) * eased,
        y: movement.from.y + (movement.to.y - movement.from.y) * eased,
      });
      if (progress >= 1) transition.current = null;
    }
    if (!reduced && current.current !== target.current) {
      const weight = 1 - Math.exp(-Math.max(0, now - previousTime.current) / 36);
      let largestChange = 0;
      current.current = current.current.map((point, i) => {
        const destination = target.current[i];
        largestChange = Math.max(largestChange, Math.abs(destination.x - point.x), Math.abs(destination.y - point.y));
        return { x: point.x + (destination.x - point.x) * weight, y: point.y + (destination.y - point.y) * weight };
      });
      if (largestChange <= .16) current.current = target.current;
      draw(current.current);
    }
    previousTime.current = now;
    if (transition.current || (!reduced && current.current !== target.current)) animation.current = requestAnimationFrame(animate);
  }

  function freeze() {
    cancelAnimationFrame(animation.current);
    animation.current = 0;
    transition.current = null;
    target.current = current.current;
  }

  useImperativeHandle(display, () => ({
    show(frame, point, holding, hovering) {
      const element = root.current;
      if (!element || !frame.hand) return;
      window.clearTimeout(lostTimer.current);
      lostTimer.current = 0;
      const now = performance.now();
      const elapsed = now - lastSample.current;
      if (lastSample.current && elapsed >= 20 && elapsed <= 125) {
        sampleInterval.current += (elapsed - sampleInterval.current) * .24;
      }
      lastSample.current = now;
      const reappeared = !visiblePoint.current || element.dataset.mode === 'lost' || element.dataset.mode === 'hidden';
      const atReleaseStart = frame.state === 'DROP_PENDING' && element.dataset.pose !== 'DROP_PENDING';
      const exact = reappeared || Boolean(frame.event) || atReleaseStart;
      const mode = holding ? 'holding' : frame.state === 'PINCH_START' ? 'pinching' : hovering ? 'target' : 'aim';
      if (element.dataset.mode !== mode) element.dataset.mode = mode;
      if (element.dataset.pose !== frame.state) element.dataset.pose = frame.state;
      const shown = visiblePoint.current;
      const previousTarget = transition.current?.to ?? shown;
      if (exact || !shown) {
        transition.current = null;
        drawPoint(point);
      } else if (previousTarget && Math.hypot(point.x - previousTarget.x, point.y - previousTarget.y) >= .35) {
        transition.current = { from: shown, to: point, started: now, duration: Math.min(68, Math.max(28, sampleInterval.current * .75)) };
      }
      target.current = fitHand(frame.hand.landmarks, frame.aspect ?? 1);
      if (reduced || reappeared || !current.current.length) {
        current.current = target.current;
        draw(current.current);
      }
      if (!animation.current && (transition.current || current.current !== target.current)) {
        previousTime.current = now;
        animation.current = requestAnimationFrame(animate);
      }
    },
    fade(immediate = false) {
      freeze();
      const element = root.current;
      if (!element || element.dataset.mode === 'hidden' || element.dataset.mode === 'lost') return;
      if (immediate) {
        window.clearTimeout(lostTimer.current);
        lostTimer.current = 0;
        element.dataset.mode = 'lost';
      } else if (!lostTimer.current) {
        lostTimer.current = window.setTimeout(() => {
          lostTimer.current = 0;
          if (root.current) root.current.dataset.mode = 'lost';
        }, 145);
      }
    },
    hide() {
      if (root.current) root.current.dataset.mode = 'hidden';
      window.clearTimeout(lostTimer.current);
      lostTimer.current = 0;
      freeze();
      visiblePoint.current = null;
      current.current = [];
      lastSample.current = 0;
    },
  }), [reduced]);

  useEffect(() => () => {
    cancelAnimationFrame(animation.current);
    window.clearTimeout(lostTimer.current);
  }, []);

  return <div ref={root} className="hand-cursor" data-mode="hidden" aria-hidden="true">
    <span className="hand-cursor-aim"><i/></span>
    <svg className="hand-cursor-shape" ref={shape} viewBox="0 0 64 64" focusable="false">
      <path ref={palmShape} className="hand-cursor-palm"/>
      <path ref={outline} className="hand-cursor-fingers"/>
      <path ref={skeleton} className="hand-cursor-bones"/>
    </svg>
  </div>;
}

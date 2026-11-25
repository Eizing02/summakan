import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { Point, GestureFrame } from '../../core/input/gesture-machine';
import type { Side } from '../../core/mathematics/linear-expression';
import { sound } from '../audio/audio';
import { acceptsTile, canEdit, type GameAction, type Session, type Tile } from './session';
import type { HandCursorDisplay } from './HandCursor';

export type ObjectSource = { tile: Tile; side?: Side; index?: number | 'draft' };
type Held = { source: ObjectSource; origin: Point; point: Point; pointer: number | null; moved: boolean; hand: boolean; over?: Side; releaseSide?: Side };
type Ghost = { tile: Tile; returning: boolean };
type DropTarget = { side?: Side; inventory: boolean };

function tileSource(item: HTMLElement | null): ObjectSource | undefined {
  if (!item?.dataset.tile) return;
  const side = item.dataset.fromSide as Side | undefined;
  const key = item.dataset.fromIndex;
  return { tile: item.dataset.tile as Tile, side, index: key === 'draft' ? key : key === undefined ? undefined : Number(key) };
}

function distanceToTile(point: Point, tile: HTMLElement) {
  const bounds = tile.getBoundingClientRect();
  return Math.hypot(Math.max(bounds.left - point.x, 0, point.x - bounds.right), Math.max(bounds.top - point.y, 0, point.y - bounds.bottom));
}

function handTile(element: Element | null, point: Point) {
  const direct = element?.closest<HTMLElement>('[data-tile]:not(:disabled)');
  if (direct) return direct;
  const inventory = element?.closest('[data-return-inventory]');
  let nearest: HTMLElement | null = null;
  let distance = 12;
  for (const tile of inventory?.querySelectorAll<HTMLElement>('.inventory-tile:not(:disabled)') ?? []) {
    const candidate = distanceToTile(point, tile);
    if (candidate < distance) { nearest = tile; distance = candidate; }
  }
  return nearest;
}

function handPosition(surface: HTMLElement, point: Point): Point | null {
  const field = surface.querySelector('.playfield')?.getBoundingClientRect();
  if (!field) return null;
  const left = Math.max(12, field.left + 12);
  const right = Math.min(window.innerWidth - 12, field.right - 12);
  const top = Math.max(12, field.top + 8);
  const bottom = Math.min(window.innerHeight - 12, field.bottom - 8);
  if (right < left || bottom < top) return null;
  return { x: left + point.x * (right - left), y: top + point.y * (bottom - top) };
}

function dropTarget(element: Element | null): DropTarget {
  const target = element?.closest<HTMLElement>('[data-drop-region], [data-drop-side], [data-pan-side], [data-return-inventory]');
  return { side: (target?.dataset.dropRegion ?? target?.dataset.dropSide ?? target?.dataset.panSide) as Side | undefined,
    inventory: target?.hasAttribute('data-return-inventory') ?? false };
}

export function canPlaceTile(state: Session, side: Side, tile: Tile) {
  const operator = state.drafts[side]?.operator;
  return acceptsTile(state, side, tile) && !(tile === '0' && (operator === '×' || operator === '÷'));
}

export function useDrag(
  state: Session, dispatch: (action: GameAction) => void, enabled: boolean,
  surface: RefObject<HTMLElement | null>,
) {
  const held = useRef<Held | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const cursor = useRef<HandCursorDisplay>(null);
  const hover = useRef<HTMLElement | null>(null);
  const pinchTile = useRef<HTMLElement | null | undefined>(undefined);
  const returnTimer = useRef<number | undefined>(undefined);
  const pulseTimer = useRef<number | undefined>(undefined);
  const [drawing, setDrawing] = useState<Ghost | null>(null);
  const [selection, setSelection] = useState<ObjectSource | null>(null);
  const [overSide, setOverSide] = useState<Side>();
  const [impact, setImpact] = useState<Side | null>(null);
  const context = useRef({ state, dispatch, enabled });
  context.current = { state, dispatch, enabled };

  function moveGhost(point: Point) {
    const node = ghost.current;
    if (!node || !surface.current) return;
    const width = node.offsetWidth, height = node.offsetHeight;
    const maxX = Math.max(6, document.documentElement.clientWidth - width - 6);
    const maxY = Math.max(6, window.innerHeight - height - 6);
    const protectedAreas = Array.from(surface.current.querySelectorAll('.equation-plaque, .pan-math, .drop-slot'),
      element => element.getBoundingClientRect());
    const candidates = [
      { x: point.x + 18, y: point.y - height - 10 }, { x: point.x - width - 18, y: point.y - height - 10 },
      { x: point.x + 23, y: point.y - height / 2 }, { x: point.x - width - 23, y: point.y - height / 2 },
      { x: point.x + 17, y: point.y + 16 }, { x: point.x - width - 17, y: point.y + 16 },
    ].map(({ x, y }) => ({ x: Math.min(maxX, Math.max(6, x)), y: Math.min(maxY, Math.max(6, y)) }));
    const clear = candidates.find(({ x, y }) => protectedAreas.every(rect =>
      x + width + 6 <= rect.left || x - 6 >= rect.right || y + height + 6 <= rect.top || y - 6 >= rect.bottom));
    const position = clear ?? candidates[0];
    node.dataset.clear = String(Boolean(clear));
    node.style.setProperty('--ghost-x', position.x + 'px');
    node.style.setProperty('--ghost-y', position.y + 'px');
  }
  useLayoutEffect(() => {
    if (!drawing) return;
    if (held.current) moveGhost(held.current.point);
  }, [drawing]);

  function start(source: ObjectSource, point: Point, pointer: number | null, hand: boolean) {
    const current = context.current;
    if (!current.enabled || !canEdit(current.state) || held.current) return;
    window.clearTimeout(returnTimer.current);
    held.current = { source, origin: point, point, pointer, moved: false, hand };
    setSelection(source);
    setDrawing({ tile: source.tile, returning: false });
    current.dispatch({ type: 'hold', held: true });
    sound('tile_grab');
  }

  function finish(target: DropTarget, lost = false) {
    const item = held.current;
    if (!item) return;
    held.current = null;
    setSelection(null);
    setOverSide(undefined);
    const send = context.current.dispatch;
    const side = target.side;
    const op = item.source;
    const flyBack = () => {
      setDrawing({ tile: op.tile, returning: true });
      requestAnimationFrame(() => { if (!held.current) moveGhost(item.origin); });
      returnTimer.current = window.setTimeout(() => setDrawing(null), 220);
      sound('tile_return');
    };
    if (!lost && side && !op.side) {
      send({ type: 'drop', side, tile: op.tile });
      if (!canPlaceTile(context.current.state, side, op.tile)) {
        flyBack();
        return;
      }
      setDrawing(null);
      setImpact(side);
      window.clearTimeout(pulseTimer.current);
      pulseTimer.current = window.setTimeout(() => setImpact(null), 320);
      sound('tile_drop');
    } else if (!lost && target.inventory && op.side && op.index !== undefined) {
      send({ type: 'remove', side: op.side, index: op.index });
      setDrawing(null);
      sound('tile_return');
    } else {
      send(lost ? { type: 'tracking-loss' } : { type: 'hold', held: false });
      flyBack();
    }
  }

  function update(point: Point, target: DropTarget) {
    const item = held.current;
    if (!item) return;
    item.point = point;
    if (!item.moved && Math.hypot(point.x - item.origin.x, point.y - item.origin.y) > 6) item.moved = true;
    if (!item.source.side && item.over !== target.side) {
      item.over = target.side;
      setOverSide(target.side);
    }
    moveGhost(point);
  }

  useEffect(() => {
    if (!enabled) {
      if (held.current) finish({ inventory: false });
      hover.current?.classList.remove('hand-hover');
      hover.current = null;
      pinchTile.current = undefined;
      cursor.current?.hide();
    }
  }, [enabled]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const item = held.current;
      if (!item || item.hand || item.pointer !== event.pointerId) return;
      update({ x: event.clientX, y: event.clientY }, dropTarget(document.elementFromPoint(event.clientX, event.clientY)));
    };
    const release = (event: PointerEvent) => {
      const item = held.current;
      if (!item || item.hand || item.pointer !== event.pointerId) return;
      const point = { x: event.clientX, y: event.clientY };
      const target = dropTarget(document.elementFromPoint(point.x, point.y));
      if (!item.moved && !target.side && !item.source.side && target.inventory) {
        item.pointer = null;
        return;
      }
      if (!item.moved && item.source.side && !target.inventory) {
        item.pointer = null;
        return;
      }
      finish(target);
    };
    const cancel = (event: PointerEvent) => {
      if (held.current?.pointer === event.pointerId) finish({ inventory: false });
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && held.current) finish({ inventory: false });
    };
    const blur = () => {
      const item = held.current;
      if (item && !item.hand && item.pointer !== null) finish({ inventory: false });
    };
    const resize = () => { if (held.current) moveGhost(held.current.point); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('lostpointercapture', cancel);
    window.addEventListener('blur', blur);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('blur', blur);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', resize);
      window.clearTimeout(returnTimer.current);
      window.clearTimeout(pulseTimer.current);
    };
  }, []);

  function pointerDown(event: ReactPointerEvent, source: ObjectSource) {
    if (event.button !== 0 || !event.isPrimary || held.current?.hand) return;
    if (held.current && held.current.pointer === null) {
      const current = held.current.source;
      finish({ inventory: false });
      if (current.tile === source.tile && current.side === source.side && current.index === source.index) return;
    }
    if (held.current) return;
    start(source, { x: event.clientX, y: event.clientY }, event.pointerId, false);
    if (held.current) event.currentTarget.setPointerCapture(event.pointerId);
  }

  function keyboardPick(source: ObjectSource, element: HTMLElement) {
    if (held.current) { finish({ inventory: false }); return; }
    const rect = element.getBoundingClientRect();
    start(source, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, null, false);
  }

  function aimedTile(position: Point, hit: Element | null) {
    if (held.current) return null;
    const previous = hover.current;
    if (previous?.isConnected && previous.matches('[data-tile]:not(:disabled)') && distanceToTile(position, previous) <= 5) return previous;
    return handTile(hit, position);
  }

  function canHandGrab(point: Point) {
    const position = enabled && surface.current && handPosition(surface.current, point);
    return Boolean(position && aimedTile(position, document.elementFromPoint(position.x, position.y)));
  }

  function handFrame(frame: GestureFrame) {
    if (!surface.current || !enabled) return;
    const position = frame.point && handPosition(surface.current, frame.point);
    if (frame.event === 'cancel' && held.current?.hand) {
      finish({ inventory: false }, frame.state === 'TRACKING_LOST');
    }
    const hit = position ? document.elementFromPoint(position.x, position.y) : null;
    const tile = position ? aimedTile(position, hit) : null;
    const element = tile ?? hit?.closest<HTMLElement>('[data-drop-side]') ?? null;
    if (hover.current !== element) {
      hover.current?.classList.remove('hand-hover');
      element?.classList.add('hand-hover');
      hover.current = element;
      if (element?.hasAttribute('data-tile')) sound('ui_hover');
    }
    if (frame.state === 'PINCH_START' && pinchTile.current === undefined) pinchTile.current = tile;
    else if (frame.state !== 'PINCH_START' && frame.event !== 'grab') pinchTile.current = undefined;
    if (!position || frame.state === 'TRACKING_LOST') { cursor.current?.fade(); return; }
    if (frame.event === 'grab') {
      const aimed = pinchTile.current;
      const source = aimed && aimed.isConnected && aimed.matches('[data-tile]:not(:disabled)') && distanceToTile(position, aimed) <= 15
        ? tileSource(aimed) : undefined;
      pinchTile.current = undefined;
      if (source) start(source, position, null, true);
    }
    const item = held.current;
    if (item?.hand) {
      let target = dropTarget(hit);
      if (frame.state === 'DRAGGING') item.releaseSide = undefined;
      if (frame.state === 'DROP_PENDING' && !item.source.side && target.side && canPlaceTile(state, target.side, item.source.tile)) {
        item.releaseSide ??= target.side;
      }
      if (item.releaseSide) target = { side: item.releaseSide, inventory: false };
      update(position, target);
      if (frame.event === 'drop') finish(target);
    }
    cursor.current?.show(frame, position, Boolean(held.current?.hand), Boolean(element));
  }

  return { drawing, ghost, cursor, selection, overSide, impact, pointerDown, keyboardPick, finish, handFrame, canHandGrab };
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { angleForDifference, assessBalance, MAX_ANGLE } from '../../src/core/balance/balance-engine';
import { BalanceSpring, endpoints } from '../../src/core/balance/spring-physics';
import { scheduleSimplification } from '../../src/core/balance/simplification-controller';
import { equationText, type Side } from '../../src/core/mathematics/linear-expression';
import { parseEquation } from '../../src/core/mathematics/parser';
import { activeMilliseconds, gameReducer, newSession, type GameAction, type Session, type Tile } from '../../src/features/game/session';
import { expressionParts } from '../../src/features/game/expression-parts';

const create = (source = 'x-3=5') => newSession(parseEquation(source).equation, source);
const drop = (state: Session, side: Side, tile: Tile) => gameReducer(gameReducer(state, { type: 'hold', held: true }), { type: 'drop', side, tile });
const operate = (state: Session, side: Side, ...tiles: Tile[]) => tiles.reduce((next, tile) => drop(next, side, tile), state);
const difference = (state: Session) => assessBalance(state.base, state.pending).difference.toNumber();

afterEach(() => vi.useRealTimers());

describe('spring and game transactions', () => {
  it('lowers the heavier side, settles to level, clamps, and retains velocity across retargeting', () => {
    expect(endpoints(angleForDifference(3), 4).left).toBeLessThan(0);
    expect(endpoints(angleForDifference(-3), 4).right).toBeLessThan(0);
    expect(endpoints(angleForDifference(3), 4).panRotation).toBe(0);
    expect(angleForDifference(2)).toBeLessThan(angleForDifference(3));
    expect(angleForDifference(Infinity)).toBe(MAX_ANGLE);
    const spring = new BalanceSpring();
    for (let i = 0; i < 90; i += 1) expect(Math.abs(spring.update(MAX_ANGLE, 1 / 60))).toBeLessThanOrEqual(MAX_ANGLE);
    const before = spring.angle;
    expect(Math.abs(spring.update(-MAX_ANGLE, 1 / 120) - before)).toBeLessThan(0.02);
    for (let i = 0; i < 120; i += 1) spring.update(0, 1 / 60);
    expect(spring.angle).toBe(0);
  });
  it('tilts on each drop, protects draft and stale commits, then verifies the original equation', () => {
    let state = create();
    state = operate(state, 'left', '+', '3');
    expect(difference(state)).toBe(3);
    for (const expected of [2, 1, 0]) {
      state = drop(state, 'right', '+');
      expect(state.phase).not.toBe('BALANCE_PENDING');
      state = drop(state, 'right', '1');
      expect(difference(state)).toBe(expected);
    }
    expect(equationText(state.base)).toBe('x - 3 = 5');
    const revision = state.revision;
    state = gameReducer(state, { type: 'hold', held: true });
    expect(gameReducer(state, { type: 'begin', revision })).toBe(state);
    state = gameReducer(state, { type: 'hold', held: false });
    state = gameReducer(state, { type: 'begin', revision: state.revision });
    expect(drop(state, 'left', '+')).toBe(state);
    state = gameReducer(state, { type: 'commit', revision: state.revision });
    expect(equationText(state.base)).toBe('x = 8');
    expect(state.history[0].right).toBe('5 + 1 + 1 + 1');
    expect(gameReducer(state, { type: 'verify', value: '7', now: 10 }).phase).toBe('SOLVED');
    expect(gameReducer(state, { type: 'verify', value: '8', now: 10 }).phase).toBe('RESULT');
  });
  it('clears a canceled settling timer and commits each animation only once', () => {
    vi.useFakeTimers();
    let session = operate(operate(create(), 'left', '+', '3'), 'right', '+', '3');
    let cancel: (() => void) | undefined;
    function dispatch(action: GameAction) {
      cancel?.();
      session = gameReducer(session, action);
      cancel = scheduleSimplification(session, 700, false, dispatch);
    }
    cancel = scheduleSimplification(session, 700, false, dispatch);
    vi.advanceTimersByTime(600);
    dispatch({ type: 'hold', held: true });
    vi.advanceTimersByTime(1000);
    expect(session.history).toHaveLength(0);
    dispatch({ type: 'hold', held: false });
    vi.advanceTimersByTime(701);
    expect(session.animation).toBe('highlight');
    vi.advanceTimersByTime(860);
    expect(session.history).toHaveLength(1);
  });
  it('rejects invalid operations without base mutations and supports undo, removal and a signed multiplier', () => {
    let session = operate(create(), 'left', '÷', '0');
    expect(session.pending.left).toHaveLength(0);
    expect(session.mathErrors).toBe(1);
    session = gameReducer(session, { type: 'undo' });
    expect(session.drafts.left).toBeNull();
    session = operate(session, 'left', '+', '3');
    expect(difference(session)).toBe(3);
    session = gameReducer(session, { type: 'remove', side: 'left', index: 0 });
    expect(difference(session)).toBe(0);
    session = gameReducer(session, { type: 'undo' });
    expect(difference(session)).toBe(3);
    let signed = operate(operate(create('-x=5'), 'left', '×', '−', '1'), 'right', '÷', '−', '1');
    signed = gameReducer(signed, { type: 'begin', revision: signed.revision });
    signed = gameReducer(signed, { type: 'commit', revision: signed.revision });
    expect(equationText(signed.base)).toBe('x = -5');
  });
  it('prevents drops during pause and excludes pause time from the assessment clock', () => {
    const session = newSession(parseEquation('x-3=5').equation, 'x-3=5', 10);
    const paused = gameReducer(session, { type: 'pause', now: 210 });
    expect(activeMilliseconds(paused, 1100)).toBe(200);
    expect(drop(paused, 'left', '+')).toBe(paused);
    const resumed = gameReducer(paused, { type: 'resume', now: 1210 });
    expect(activeMilliseconds(resumed, 1410)).toBe(400);
  });
  it('marks exact opposite visual terms and keeps multiplication around the entire prior expression', () => {
    let session = operate(create(), 'left', '+', '3');
    expect(expressionParts(session.base.left, session.pending.left).map(part => part.cancellation)).toEqual([undefined, 'first', 'second']);
    session = operate(session, 'left', '×', '2');
    const scaled = expressionParts(session.base.left, session.pending.left);
    expect(scaled[0].tex).toBe('(x');
    expect(scaled.at(-1)?.tex).toBe(')\\times\\,2');
  });
});

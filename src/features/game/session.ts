import { assessBalance } from '../../core/balance/balance-engine';
import { operators, validateOperation, visualExpression, type Operation, type Operator } from '../../core/mathematics/affine-transform';
import { isolatedValue, simplifyBalanced, verifySolution } from '../../core/mathematics/equation-engine';
import { equationText, expressionText, type Equation, type Side } from '../../core/mathematics/linear-expression';
import { ONE, Rational } from '../../core/mathematics/rational';

export type Tile = Operator | `${0|1|2|3|4|5|6|7|8|9}`;
export const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
export type Draft = { operator: Operator; negative: boolean };
export type Round = { base: Equation; pending: Record<Side, Operation[]>; drafts: Record<Side, Draft | null> };
export type Phase = 'READY' | 'PLAYING' | 'IMBALANCED' | 'BALANCE_PENDING' | 'SIMPLIFYING' | 'NEXT_STEP' | 'SOLVED' | 'RESULT' | 'PAUSED';
export type Animation = 'highlight' | 'cancel' | 'combine';
export interface HistoryEntry {
  before: string;
  left: string;
  right: string;
  after: string;
  changed: boolean;
}
interface UndoEntry { round: Round; history: HistoryEntry[] }
export interface Session extends Round {
  original: Equation;
  source: string;
  history: HistoryEntry[];
  undo: UndoEntry[];
  held: boolean;
  phase: Phase;
  animation: Animation | null;
  revision: number;
  message: string;
  hints: number;
  undos: number;
  mathErrors: number;
  trackingLosses: number;
  journal: string[];
  started: number;
  ended: number | null;
  pausedAt: number | null;
  pausedMs: number;
  verification: ReturnType<typeof verifySolution> | null;
  balancedAt: number | null;
  solvedAt: number | null;
}

function emptyRound(base: Equation): Round {
  return { base, pending: { left: [], right: [] }, drafts: { left: null, right: null } };
}

export function newSession(equation: Equation, source: string, now = Date.now()): Session {
  return verifyIsolated({
    ...emptyRound(equation), original: equation, source, history: [], undo: [], held: false,
    phase: 'READY', animation: null, revision: 0,
    message: '', hints: 0, undos: 0, mathErrors: 0, trackingLosses: 0, journal: [],
    started: now, ended: null, pausedAt: null, pausedMs: 0, verification: null, balancedAt: null, solvedAt: null,
  }, now, now);
}

export function canEdit(state: Session) {
  return !(['SIMPLIFYING', 'SOLVED', 'RESULT', 'PAUSED'] as Phase[]).includes(state.phase);
}

export function maySettle(state: Session) {
  return !state.held && !state.drafts.left && !state.drafts.right &&
    state.pending.left.length > 0 && state.pending.right.length > 0 &&
    assessBalance(state.base, state.pending).mathematical;
}

function refresh(state: Session, message = '', at = state.started): Session {
  if (isolatedValue(state.base)) return { ...state, phase: 'SOLVED', message };
  const balance = assessBalance(state.base, state.pending);
  const hasWork = state.pending.left.length || state.pending.right.length || state.drafts.left || state.drafts.right;
  const phase = maySettle(state) ? 'BALANCE_PENDING' : !balance.mathematical ? 'IMBALANCED' : hasWork || state.held ? 'PLAYING' : 'READY';
  return { ...state, phase, message, balancedAt: phase === 'BALANCE_PENDING' ? at : null };
}

function save(state: Session, round: Partial<Round>, at: number, event?: string) {
  const undo = { round: { base: state.base, pending: state.pending, drafts: state.drafts }, history: state.history };
  return refresh({ ...state, ...round, held: false, undo: [...state.undo, undo], revision: state.revision + 1,
    journal: event ? [...state.journal, event] : state.journal }, '', at);
}

function verifyIsolated(state: Session, now: number, solvedAt: number): Session {
  const answer = isolatedValue(state.base);
  if (answer === null) return state;
  const verification = verifySolution(state.original, answer);
  if (verification.valid) return { ...state, verification, ended: now, solvedAt, phase: 'RESULT', message: '' };
  return { ...state, verification, phase: 'SOLVED', message: 'ตรวจคำตอบแล้วผลสองฝั่งไม่เท่ากัน ให้ย้อนกลับหนึ่งขั้น' };
}

function commitRound(state: Session, now: number, finalOnly = false): Session {
  if (!maySettle(state)) return state;
  const result = simplifyBalanced(state.base, state.pending);
  if (!result || (finalOnly && isolatedValue(result.next) === null)) return state;
  const history = [...state.history, {
    before: equationText(state.base),
    left: visualExpression(expressionText(state.base.left), state.pending.left),
    right: visualExpression(expressionText(state.base.right), state.pending.right),
    after: equationText(result.next), changed: result.changed,
  }];
  return verifyIsolated({
    ...state, ...emptyRound(result.next), history, animation: null, revision: state.revision + 1,
    message: roundFeedback(state.base, result.next, result.changed), phase: 'NEXT_STEP', balancedAt: null,
  }, now, state.balancedAt ?? now);
}

function roundFeedback(before: Equation, after: Equation, changed: boolean) {
  if (!changed) return 'การดำเนินการรอบนี้ไม่เปลี่ยนสมการ';
  const variable = (equation: Equation) => equation.left.coefficient.isZero ? equation.right : equation.left;
  const old = variable(before);
  const next = variable(after);
  const smaller = (a: Rational, b: Rational) => a.abs().numerator * b.denominator < b.abs().numerator * a.denominator;
  const improved = smaller(next.constant, old.constant) ||
    smaller(next.coefficient.subtract(ONE), old.coefficient.subtract(ONE));
  return improved ? 'จัดรูปแล้ว สมการมีคำตอบชุดเดิม' : 'สมการยังคงสมมูลกัน ลองสังเกตว่า x เข้าใกล้การอยู่เพียงลำพังหรือไม่';
}

export function activeMilliseconds(state: Session, now = Date.now()) {
  return Math.max(0, (state.ended ?? state.pausedAt ?? now) - state.started - state.pausedMs);
}

export function acceptsTile(state: Session, side: Side, tile: Tile) {
  if (!canEdit(state)) return false;
  const draft = state.drafts[side];
  if (!draft) return (operators as readonly string[]).includes(tile);
  return /^\d$/.test(tile) || (tile === '−' && !draft.negative);
}

export type GameAction = (
  | { type: 'hold'; held: boolean }
  | { type: 'drop'; side: Side; tile: Tile }
  | { type: 'remove'; side: Side; index: number | 'draft' }
  | { type: 'undo' }
  | { type: 'begin' | 'advance' | 'commit'; revision: number }
  | { type: 'hint' }
  | { type: 'tracking-loss' }
  | { type: 'pause' | 'resume'; now: number }
  | { type: 'deadline'; deadline: number }
) & { now?: number };

export function gameReducer(state: Session, action: GameAction): Session {
  const now = action.now ?? state.started;
  switch (action.type) {
    case 'hold':
      if (!canEdit(state) || state.held === action.held) return state;
      return refresh({ ...state, held: action.held, revision: state.revision + 1 }, state.message, now);
    case 'drop': {
      if (!canEdit(state) || !state.held) return state;
      const { side, tile } = action;
      const draft = state.drafts[side];
      if (!acceptsTile(state, side, tile)) {
        const message = draft ? 'ใส่ตัวเลขต่อท้ายเครื่องหมาย หรือใช้ − เพื่อใส่จำนวนลบ' : 'วางเครื่องหมายก่อนวางตัวเลข';
        return refresh({ ...state, held: false, revision: state.revision + 1, mathErrors: state.mathErrors + 1 }, message, now);
      }
      if (!draft) return save(state, { drafts: { ...state.drafts, [side]: { operator: tile as Operator, negative: false } } }, now);
      if (tile === '−') return save(state, { drafts: { ...state.drafts, [side]: { ...draft, negative: true } } }, now);
      const operation = { operator: draft.operator, value: new Rational(Number(tile) * (draft.negative ? -1 : 1)) };
      try {
        validateOperation(operation);
      } catch (error) {
        return refresh({ ...state, held: false, revision: state.revision + 1, mathErrors: state.mathErrors + 1 }, (error as Error).message, now);
      }
      return save(state, {
        pending: { ...state.pending, [side]: [...state.pending[side], operation] },
        drafts: { ...state.drafts, [side]: null },
      }, now, [side === 'left' ? 'ซ้าย' : 'ขวา', operation.operator, operation.value.toString()].join(' '));
    }
    case 'remove': {
      if (!canEdit(state)) return state;
      const { side, index } = action;
      if (index === 'draft') return state.drafts[side] ? save(state, { drafts: { ...state.drafts, [side]: null } }, now) : state;
      if (!state.pending[side][index]) return state;
      const operation = state.pending[side][index];
      return save(state, { pending: { ...state.pending, [side]: state.pending[side].filter((_, current) => current !== index) } }, now,
        ['นำออก', side === 'left' ? 'ซ้าย' : 'ขวา', operation.operator, operation.value.toString()].join(' '));
    }
    case 'undo': {
      if ((!canEdit(state) && state.phase !== 'SOLVED') || state.held || state.undo.length === 0) return state;
      const previous = state.undo.at(-1)!;
      return refresh({
        ...state, ...previous.round, history: previous.history, undo: state.undo.slice(0, -1),
        undos: state.undos + 1, revision: state.revision + 1, verification: null, journal: [...state.journal, 'ย้อนกลับ'],
      }, 'ย้อนกลับหนึ่งการกระทำ', now);
    }
    case 'begin':
      if (state.phase !== 'BALANCE_PENDING' || state.revision !== action.revision || !maySettle(state)) return state;
      return { ...state, phase: 'SIMPLIFYING', animation: 'highlight' };
    case 'advance':
      if (state.phase !== 'SIMPLIFYING' || state.revision !== action.revision) return state;
      return { ...state, animation: state.animation === 'highlight' ? 'cancel' : 'combine' };
    case 'commit': {
      if (state.phase !== 'SIMPLIFYING' || state.revision !== action.revision) return state;
      return commitRound(state, now);
    }
    case 'deadline':
      return (state.phase === 'BALANCE_PENDING' || state.phase === 'SIMPLIFYING') &&
        state.balancedAt !== null && state.balancedAt < action.deadline ? commitRound(state, action.deadline, true) : state;
    case 'hint': return { ...state, hints: state.hints + 1 };
    case 'tracking-loss':
      if (!canEdit(state) || !state.held) return state;
      return refresh({ ...state, held: false, trackingLosses: state.trackingLosses + 1, revision: state.revision + 1 }, 'มือหลุดจากกรอบ วัตถุกลับเข้าคลัง', now);
    case 'pause':
      if (!canEdit(state)) return state;
      return { ...state, phase: 'PAUSED', held: false, revision: state.revision + 1, pausedAt: action.now };
    case 'resume':
      return state.phase === 'PAUSED' ? refresh({ ...state, revision: state.revision + 1, pausedAt: null,
        pausedMs: state.pausedMs + Math.max(0, action.now - (state.pausedAt ?? action.now)) }, '', now) : state;
  }
}

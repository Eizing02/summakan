import { maySettle, type GameAction, type Session } from '../../features/game/session';

export function scheduleSimplification(
  session: Session, settleMs: number, reducedMotion: boolean,
  dispatch: (action: GameAction) => void,
) {
  const { revision, phase, animation } = session;
  if (phase === 'BALANCE_PENDING' && maySettle(session)) {
    const timeout = setTimeout(() => dispatch({ type: 'begin', revision }), settleMs);
    return () => clearTimeout(timeout);
  }
  if (phase === 'SIMPLIFYING') {
    const duration = animation === 'highlight' ? 260 : animation === 'cancel' ? 380 : 220;
    const timeout = setTimeout(() => dispatch({ type: animation === 'combine' ? 'commit' : 'advance', revision }), reducedMotion ? 35 : duration);
    return () => clearTimeout(timeout);
  }
}

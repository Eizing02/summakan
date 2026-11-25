import { describe, expect, it } from 'vitest';
import { cameraError } from '../../src/core/input/hand-tracker';
import { cursorPoint, defaultCalibration, GestureMachine, pinchRatio, validHandRange, type ObservedHand } from '../../src/core/input/gesture-machine';

function hand(pinched: boolean, handedness: ObservedHand['handedness'] = 'Right', offset = 0, confidence = .92): ObservedHand {
  const landmarks = Array.from({ length: 21 }, () => ({ x: .50 + offset, y: .52 }));
  landmarks[0] = { x: .50 + offset, y: .69 };
  landmarks[5] = { x: .45 + offset, y: .56 };
  landmarks[9] = { x: .50 + offset, y: .53 };
  landmarks[17] = { x: .55 + offset, y: .56 };
  landmarks[8] = { x: .45 + offset, y: .42 };
  landmarks[4] = { x: .46 + offset, y: pinched ? .423 : .55 };
  return { landmarks, confidence, handedness };
}

describe('21-point hand input', () => {
  it('mirrors horizontal motion and scales coordinates during calibration', () => {
    const settings = { ...defaultCalibration, reach: 1, cursorGain: 1 };
    expect(cursorPoint({ x: .6, y: .4 }, settings).x).toBeCloseTo(.4);
    expect(cursorPoint({ x: .4, y: .6 }, settings)).toEqual({ x: .6, y: .6 });
    expect(cursorPoint({ x: .4, y: .6 }, { ...settings, centerX: .6, centerY: .6 })).toEqual({ x: .5, y: .5 });
    const sample = hand(true).landmarks;
    expect(pinchRatio(sample, 4 / 3)).toBeCloseTo(pinchRatio(sample.map(({ x, y }) => ({ x: x / 2, y: y / 2 })), 4 / 3));
  });
  it('maps the four comfortable reaches to all screen edges even at reduced sensitivity', () => {
    const range = { left: .24, right: .61, top: .35, bottom: .58 };
    const config = { ...defaultCalibration, cursorGain: .65, range };
    expect(validHandRange(range)).toBe(true);
    expect(validHandRange({ ...range, bottom: .4 })).toBe(false);
    expect(cursorPoint({ x: .76, y: .35 }, config)).toEqual({ x: 0, y: 0 });
    expect(cursorPoint({ x: .39, y: .58 }, config)).toEqual({ x: 1, y: 1 });
    expect(cursorPoint({ x: .575, y: .465 }, config).y).toBeCloseTo(.5);
  });
  it('holds steady over tiny jitter and follows deliberate movement including while pinching', () => {
    const machine = new GestureMachine();
    const start = machine.frame([hand(false)], 0, 1, defaultCalibration)?.point?.x;
    for (let i = 1; i <= 10; i++) {
      expect(machine.frame([hand(false, 'Right', i % 2 ? -.002 : .002)], i * 40, 1, defaultCalibration)?.point?.x).toBe(start);
    }
    machine.frame([hand(true)], 440, 1, defaultCalibration);
    expect(machine.frame([hand(true)], 480, 1, defaultCalibration)?.event).toBe('grab');
    let frame;
    for (let i = 1; i <= 8; i++) {
      frame = machine.frame([hand(true, 'Right', Math.min(i, 3) * .06)], 480 + i * 40, 1, defaultCalibration);
    }
    expect(frame?.state).toBe('DRAGGING');
    expect(frame?.point?.x).toBeCloseTo(cursorPoint({ x: .63, y: .42 }, defaultCalibration).x, 1);
  });
  it('arms only after release, debounces a grab and release, and rejects duplicate or stale frames', () => {
    const machine = new GestureMachine();
    const update = (time: number, pinch: boolean) => machine.frame([hand(pinch)], time, 4 / 3, defaultCalibration);
    expect(update(0, true)?.event).toBeUndefined();
    expect(update(40, true)?.event).toBeUndefined();
    update(80, false);
    expect(update(120, true)?.state).toBe('PINCH_START');
    expect(update(155, true)?.event).toBe('grab');
    expect(update(155, true)).toBeNull();
    expect(update(150, false)).toBeNull();
    expect(update(190, true)?.state).toBe('DRAGGING');
    expect(update(230, false)?.state).toBe('DROP_PENDING');
    expect(update(270, false)?.event).toBe('drop');
    expect(update(310, false)?.event).toBeUndefined();
  });
  it('cancels if the hand disappears and never commits on unobserved release', () => {
    const machine = new GestureMachine();
    const next = (time: number, hands: ObservedHand[]) => machine.frame(hands, time, 1, defaultCalibration);
    next(0, [hand(false)]);
    next(40, [hand(true)]);
    expect(next(80, [hand(true)])?.event).toBe('grab');
    expect(next(115, [])?.event).toBeUndefined();
    expect(next(155, [hand(false)])?.event).toBe('cancel');
    next(195, [hand(true)]);
    expect(next(235, [hand(true)])?.event).toBe('grab');
    expect(next(515, [])?.event).toBe('cancel');
    expect(next(565, [])?.event).toBeUndefined();
  });
  it('respects the chosen hand and stays locked despite a higher-confidence bystander', () => {
    const machine = new GestureMachine();
    const config = { ...defaultCalibration, hand: 'Left' as const };
    const left = hand(false, 'Left', 0, .8);
    const visitor = hand(true, 'Left', -.40, .99);
    expect(machine.frame([hand(false)], 1, 1, config)?.hand).toBeUndefined();
    expect(machine.frame([left, hand(false)], 41, 1, config)?.hand).toBe(left);
    expect(machine.frame([visitor, left], 81, 1, config)?.hand).toBe(left);
    expect(machine.frame([visitor], 121, 1, config)?.state).toBe('TRACKING_LOST');
  });
  it('exposes Thai messages for browser camera errors', () => {
    expect(cameraError({ name: 'NotAllowedError' }).help).toBe('browser');
    expect(cameraError({ name: 'NotSupportedError' }).help).toBe('browser');
    expect(cameraError({ name: 'NotFoundError' }).message).toContain('ไม่พบกล้อง');
    expect(cameraError({ name: 'NotReadableError' }).message).toContain('แอปอื่น');
  });
});

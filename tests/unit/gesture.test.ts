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

const hit = () => true;
function poseFrames(machine: GestureMachine, pinched: boolean, start: number, count: number, offset = 0) {
  return Array.from({ length: count }, (_, i) => machine.frame([hand(pinched, 'Right', offset)], start + 40 * i, 1, defaultCalibration, hit));
}
const events = (frames: ReturnType<typeof poseFrames>) => frames.flatMap(frame => frame?.event ? [frame.event] : []);
function hold(machine: GestureMachine) {
  poseFrames(machine, false, 0, 5);
  return poseFrames(machine, true, 200, 12);
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
  it('attenuates jitter and follows deliberate movement even while pinching', () => {
    const machine = new GestureMachine();
    const start = machine.frame([hand(false)], 0, 1, defaultCalibration)?.point?.x ?? 0;
    for (let i = 1; i <= 10; i++) {
      const point = machine.frame([hand(false, 'Right', i % 2 ? -.002 : .002)], i * 40, 1, defaultCalibration)?.point;
      expect(Math.abs(point!.x - start)).toBeLessThan(.002);
    }
    const held = poseFrames(machine, true, 440, 9);
    expect(events(held)).toEqual(['grab']);
    let frame;
    for (let i = 1; i <= 8; i++) {
      frame = machine.frame([hand(true, 'Right', Math.min(i, 3) * .06)], 760 + i * 40, 1, defaultCalibration);
    }
    expect(frame?.state).toBe('DRAGGING');
    expect(frame?.point?.x).toBeCloseTo(cursorPoint({ x: .63, y: .42 }, defaultCalibration).x, 1);
  });
  it('arms only after release and emits one grab and one drop', () => {
    const machine = new GestureMachine();
    expect(events(poseFrames(machine, true, 0, 7))).toEqual([]);
    poseFrames(machine, false, 300, 9);
    expect(events(poseFrames(machine, true, 680, 12))).toEqual(['grab']);
    expect(machine.frame([hand(true)], 1120, 1, defaultCalibration)).toBeNull();
    expect(machine.frame([hand(false)], 1100, 1, defaultCalibration)).toBeNull();
    expect(events(poseFrames(machine, false, 1160, 12))).toEqual(['drop']);
  });
  it('keeps the drop point from the first open pose even as the hand moves', () => {
    const machine = new GestureMachine();
    expect(events(hold(machine))).toEqual(['grab']);
    const start = machine.frame([hand(false)], 680, 1, defaultCalibration);
    expect(start?.state).toBe('DROP_PENDING');
    const later = poseFrames(machine, false, 720, 5, .1);
    expect(later.find(frame => frame?.event === 'drop')?.point).toEqual(start?.point);
    expect(events(later)).toEqual(['drop']);
  });
  it('keeps holding across fast-swipe gaps up to holdGrace, and cancels after sustained loss or occluded opening', () => {
    for (const recovery of [false, true]) {
      const machine = new GestureMachine();
      hold(machine);
      expect(machine.frame([], 690, 1, defaultCalibration)?.event).toBeUndefined();
      // A 500ms fast-swipe occlusion while holding must not drop the tile prematurely.
      expect(machine.frame([], 1140, 1, defaultCalibration)?.event).toBeUndefined();
      const steps = recovery ? poseFrames(machine, false, 1180, 6) :
        [machine.frame([], 1420, 1, defaultCalibration)];
      expect(events(steps)).toEqual(['cancel']);
      expect(machine.frame([], 1500, 1, defaultCalibration)?.event).toBeUndefined();
    }
  });
  it('grabs promptly when thumb and index close together and stays steady on pinch onset', () => {
    const machine = new GestureMachine();
    poseFrames(machine, false, 0, 4);
    const hitTile = (point: { x: number; y: number }) => Math.abs(point.x - .5) < .3 && Math.abs(point.y - .5) < .3;
    const first = machine.frame([hand(true, 'Right', 0)], 160, 1, defaultCalibration, hitTile);
    const second = machine.frame([hand(true, 'Right', 0)], 200, 1, defaultCalibration, hitTile);
    const grabbed = [first, second].find(frame => frame?.event === 'grab');
    expect(grabbed).toBeDefined();
    expect(grabbed?.state).toBe('GRABBING');
  });
  it('keeps holding through a brief detection gap and a brief opening', () => {
    const machine = new GestureMachine();
    hold(machine);
    expect(machine.frame([], 750, 1, defaultCalibration)?.event).toBeUndefined();
    expect(machine.frame([hand(false)], 780, 1, defaultCalibration)?.state).toBe('DROP_PENDING');
    expect(machine.frame([hand(true)], 820, 1, defaultCalibration)).toMatchObject({ state: 'DRAGGING', event: undefined });
    expect(events(poseFrames(machine, false, 860, 8))).toEqual(['drop']);
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

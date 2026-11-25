import { useEffect, useRef, useState, type RefObject } from 'react';
import { Camera, Check, Crosshair, Hand, Mouse, X } from 'lucide-react';
import { HandTracker, type CameraHelp } from '../../core/input/hand-tracker';
import { GestureMachine, pinchAnchor, validHandRange, type Calibration, type GameHandInput, type HandRange, type Point } from '../../core/input/gesture-machine';
import type { Preferences } from '../settings/settings';

const connections = [[0,1,2,3,4], [0,5,6,7,8], [5,9,10,11,12], [9,13,14,15,16], [13,17,18,19,20], [0,17]];
const reachSteps = [
  { edge: 'left', label: 'ซ้าย', x: 5, y: 23, width: 10, height: 54 },
  { edge: 'right', label: 'ขวา', x: 85, y: 23, width: 10, height: 54 },
  { edge: 'top', label: 'บน', x: 23, y: 5, width: 54, height: 10 },
  { edge: 'bottom', label: 'ล่าง', x: 23, y: 85, width: 54, height: 10 },
] as const;

export interface CameraControl {
  close: () => void;
  stop: () => void;
}

interface CameraPanelProps {
  open: boolean;
  required: boolean;
  control: RefObject<CameraControl | null>;
  preferences: Preferences;
  onCalibration: (settings: Calibration) => void;
  onClose: () => void;
  onUse: () => void;
  onStatus: (status: string, running: boolean) => void;
  gameFrame: RefObject<GameHandInput | null>;
}

export function CameraPanel({ open, required, control, preferences, onCalibration, onClose, onUse, onStatus, gameFrame }: CameraPanelProps) {
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<SVGSVGElement>(null);
  const statusLine = useRef<HTMLParagraphElement>(null);
  const focusButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const tracker = useRef(new HandTracker());
  const machine = useRef(new GestureMachine());
  const [status, setStatus] = useState('กล้องยังปิดอยู่');
  const [help, setHelp] = useState<CameraHelp>();
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [capture, setCapture] = useState<Partial<HandRange> | null>(null);
  const [note, setNote] = useState('');
  const [practice, setPractice] = useState<'ready' | 'grabbed' | 'done' | null>(null);
  const samples = useRef<{ point: Point; at: number }[]>([]);
  const settings = useRef({ open, calibration: preferences.calibration, capture, practice });
  settings.current = { open, calibration: preferences.calibration, capture, practice };
  const step = capture && reachSteps.find(item => capture[item.edge] === undefined);
  const lastUpdate = useRef(0);

  useEffect(() => {
    const node = dialog.current;
    if (!open) { node?.close(); return; }
    node?.showModal();
    focusButton.current?.focus();
    return () => node?.close();
  }, [open]);

  function stop() {
    tracker.current.stop();
    machine.current = new GestureMachine();
    samples.current = [];
    setCapture(null);
    setPractice(null);
    setNote('');
    gameFrame.current?.handleFrame({ point: null, event: 'cancel', state: 'NO_HAND' });
    setRunning(false);
    setLoading(false);
    setStatus('กล้องยังปิดอยู่');
    setHelp(undefined);
    onStatus('กล้องปิด', false);
  }
  control.current = { close: onClose, stop };

  useEffect(() => {
    const camera = tracker.current;
    return () => { camera.stop(); control.current = null; };
  }, [control]);

  function onFrame(hands: Parameters<GestureMachine['frame']>[0], timestamp: number, aspect: number, reset = false) {
    const current = settings.current;
    if (reset) {
      machine.current = new GestureMachine();
      if (current.practice === 'grabbed') setPractice('ready');
      gameFrame.current?.handleFrame({ point: null, event: 'cancel', state: 'TRACKING_LOST' });
    }
    const frame = machine.current.frame(hands, timestamp, aspect, current.calibration, point =>
      current.open
        ? current.practice === 'ready' && Math.hypot(point.x - .5, point.y - .5) < .18
        : gameFrame.current?.canGrab(point) ?? false);
    if (!frame) return;
    if (!settings.current.open) {
      gameFrame.current?.handleFrame(frame);
      if (timestamp - lastUpdate.current >= 280) {
        lastUpdate.current = timestamp;
        onStatus(frame.hand ? 'พบมือ · ' + Math.round(frame.hand.confidence * 100) + '%' : 'กำลังมองหามือ', true);
      }
      return;
    }
    const landmarks = frame.hand?.landmarks;
    const anchor = landmarks && pinchAnchor(landmarks);
    const tip = anchor && { x: 1 - anchor.x, y: anchor.y };
    if (settings.current.capture && tip) {
      samples.current.push({ point: tip, at: performance.now() });
      if (samples.current.length > 5) samples.current.shift();
    } else samples.current = [];
    overlay.current?.querySelectorAll<SVGPolylineElement>('polyline').forEach((line, index) => {
      line.setAttribute('points', landmarks ? connections[index].map(i => `${(1 - landmarks[i].x) * 100},${landmarks[i].y * 100}`).join(' ') : '');
    });
    const thumbDot = overlay.current?.querySelector('[data-tip="thumb"]');
    const indexDot = overlay.current?.querySelector('[data-tip="index"]');
    if (landmarks && thumbDot && indexDot) {
      thumbDot.setAttribute('cx', String((1 - landmarks[4].x) * 100));
      thumbDot.setAttribute('cy', String(landmarks[4].y * 100));
      thumbDot.setAttribute('visibility', 'visible');
      indexDot.setAttribute('cx', String((1 - landmarks[8].x) * 100));
      indexDot.setAttribute('cy', String(landmarks[8].y * 100));
      indexDot.setAttribute('visibility', 'visible');
    } else {
      thumbDot?.setAttribute('visibility', 'hidden');
      indexDot?.setAttribute('visibility', 'hidden');
    }
    const marker = overlay.current?.querySelector('[data-tracking-cursor]');
    const markerPoint = settings.current.practice ? frame.point : tip;
    if (marker && markerPoint) {
      marker.setAttribute('cx', String(markerPoint.x * 100));
      marker.setAttribute('cy', String(markerPoint.y * 100));
      marker.setAttribute('visibility', 'visible');
      marker.setAttribute('fill', frame.state === 'DRAGGING' || frame.state === 'GRABBING' ? '#ffd36c' : '#82e4ff');
    } else marker?.setAttribute('visibility', 'hidden');
    if (statusLine.current && timestamp - lastUpdate.current >= 180) {
      lastUpdate.current = timestamp;
      statusLine.current.textContent = frame.hand
        ? `พบมือ${frame.hand.handedness === 'Left' ? 'ซ้าย' : 'ขวา'} · ความมั่นใจ ${Math.round(frame.hand.confidence * 100)}%`
        : 'ยังไม่พบมือ ลองวางมือกลางภาพ';
    }
    if (settings.current.practice && frame.point) {
      const { x, y } = frame.point;
      if (settings.current.practice === 'ready' && frame.event === 'grab' && Math.hypot(x - .5, y - .5) < .18) setPractice('grabbed');
      if (settings.current.practice === 'grabbed' && frame.event === 'drop') setPractice('done');
    }
    if (settings.current.practice === 'grabbed' && frame.event === 'cancel') setPractice('ready');
  }

  function enable() {
    if (!video.current) return;
    setLoading(true);
    machine.current = new GestureMachine();
    void tracker.current.start(video.current, onFrame, (message, active, cameraHelp) => {
      setStatus(message);
      setHelp(cameraHelp);
      setRunning(active);
      setLoading(!active && message.startsWith('กำลัง'));
      onStatus(message, active);
      if (!active) {
        machine.current = new GestureMachine();
        setPractice(value => value === 'grabbed' ? 'ready' : value);
        gameFrame.current?.handleFrame({ point: null, event: 'cancel', state: 'TRACKING_LOST' });
      }
    }, preferences.delegate);
  }

  function beginCalibration() {
    samples.current = [];
    setPractice(null);
    setNote('');
    setCapture({});
  }

  function recordReach() {
    if (!step || !capture) return;
    const axis = step.edge === 'left' || step.edge === 'right' ? 'x' : 'y';
    const now = performance.now();
    const readings = samples.current.filter(sample => now - sample.at < 1000).map(sample => sample.point[axis]).sort((a, b) => a - b);
    const value = readings[Math.floor(readings.length / 2)];
    if (value === undefined) {
      setNote('ยังไม่พบมือ ค้างนิ้วชี้ในภาพแล้วลองบันทึกอีกครั้ง');
      return;
    }
    samples.current = [];
    setNote('');
    const next = { ...capture, [step.edge]: Math.max(0, Math.min(1, value)) };
    const { left, right, top, bottom } = next;
    if (left === undefined || right === undefined || top === undefined || bottom === undefined) {
      setCapture(next);
      return;
    }
    const range = { left, right, top, bottom };
    if (!validHandRange(range)) {
      setNote('ช่วงที่บันทึกแคบเกินไป ลองขยับมือให้กว้างขึ้นโดยยังอยู่ในกรอบภาพ');
      setCapture({});
      return;
    }
    onCalibration({ ...preferences.calibration, range });
    setCapture(null);
    setPractice('ready');
  }

  const { calibration } = preferences;
  const close = () => { if (loading) stop(); onClose(); };
  const chooseMouse = () => { stop(); onClose(); };
  return <dialog ref={dialog} className="dialog dialog-wide camera-dialog" aria-label="ตั้งค่ากล้อง"
    onCancel={event => { event.preventDefault(); close(); }}>
    <header className="dialog-header"><h2><Camera size={24}/> ตั้งค่ากล้อง</h2><button type="button" className="icon-button" aria-label="ปิด" onClick={close}><X size={21}/></button></header>
    <div className="dialog-body">
      <p>{required ? 'ก่อนเล่นครั้งแรก ให้เปิดกล้องแล้วกดใช้กล้องเพื่อเข้าเกม ภาพจะประมวลผลบนอุปกรณ์นี้' :
        'อนุญาตให้ใช้กล้องเพื่อขยับมือแล้วแตะนิ้วโป้งกับนิ้วชี้เพื่อหยิบวัตถุ ภาพจะประมวลผลบนอุปกรณ์นี้'}</p>
      <div className="camera-grid">
        <div className="camera-column">
          <div className="camera-preview">
            <video ref={video} muted playsInline autoPlay aria-hidden="true" />
            {!running && <div className="camera-empty" role="status"><Camera size={38}/><span>{status}</span></div>}
            <svg ref={overlay} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {connections.map((_, i) => <polyline key={i} fill="none" stroke="#8af6cc" strokeWidth=".6"/>)}
              {running && step && <rect x={step.x} y={step.y} width={step.width} height={step.height} rx="2" stroke="#e8bc68" strokeWidth="1" fill="#e8bc6833" data-calibration-target="true"/>}
              {running && practice && <circle cx="50" cy="50" r="11" stroke={practice === 'done' ? '#8af6cc' : '#e8bc68'} strokeWidth="1" fill="none" data-calibration-target="true"/>}
              <circle data-tip="thumb" cx="50" cy="50" r="2.2" stroke="#181b39" strokeWidth=".6" fill="#ffe46d" visibility="hidden"/>
              <circle data-tip="index" cx="50" cy="50" r="2.2" stroke="#181b39" strokeWidth=".6" fill="#ffe46d" visibility="hidden"/>
              <circle data-tracking-cursor="true" cx="50" cy="50" r="1.8" stroke="#0f1b2d" strokeWidth=".55" fill="#82e4ff" visibility="hidden"/>
            </svg>
          </div>
          {running && <p><span>{status}</span><br/><span ref={statusLine}>ยกมือให้อยู่ในกรอบกล้อง</span></p>}
        </div>
        <div className="camera-options">
          <label>มือที่ใช้<select value={calibration.hand} onChange={event => {
            machine.current = new GestureMachine();
            samples.current = [];
            setCapture(null);
            setPractice(null);
            setNote('');
            onCalibration({ ...calibration, hand: event.target.value as Calibration['hand'], range: undefined });
          }}>
            <option value="Auto">เลือกอัตโนมัติ</option><option value="Left">ซ้าย</option><option value="Right">ขวา</option>
          </select></label>
          <label>ความไวเคอร์เซอร์<input type="range" min=".65" max="1.65" step=".05" value={calibration.cursorGain} onChange={event => onCalibration({ ...calibration, cursorGain: +event.target.value })}/></label>
          <label>ความไวการหนีบ<input type="range" min=".12" max=".48" step=".01" value={calibration.pinch} onChange={event => onCalibration({ ...calibration, pinch: +event.target.value })}/></label>
          {!calibration.range && <label>ขนาดพื้นที่การเคลื่อนไหว<input type="range" min=".32" max="1" step=".02" value={calibration.reach} onChange={event => onCalibration({ ...calibration, reach: +event.target.value })}/></label>}
          {running && !step && <button type="button" className="secondary" onClick={beginCalibration}><Crosshair size={18}/> {calibration.range ? 'ปรับเทียบใหม่' : 'เริ่มปรับเทียบ'}</button>}
          {running && !step && calibration.range && <button type="button" className="mini-button" onClick={() => {
            setPractice(null);
            onCalibration({ ...calibration, range: undefined });
          }}>ใช้ช่วงมือค่าเริ่มต้น</button>}
        </div>
      </div>
      {help === 'browser' && <p className="learning-note">ถ้าเปิดเกมจากหน้าพรีวิวในแอป ให้คัดลอก {location.origin + location.pathname} ไปเปิดใน Chrome หรือ Edge โดยตรง แล้วเลือก <strong>ตั้งค่ากล้อง → เปิดกล้อง → อนุญาต</strong> หากเคยกดบล็อก ให้เปลี่ยนสิทธิ์กล้องจากไอคอนข้างแถบที่อยู่แล้วโหลดหน้าใหม่</p>}
      {help === 'secure-origin' && <p className="learning-note">บนเครื่องที่รันเกม ให้เปิดจากเซิร์ฟเวอร์ในเครื่องผ่าน <code>http://127.0.0.1</code> หากเปิดจากเครื่องอื่น ให้ใช้ที่อยู่เว็บ HTTPS</p>}
      {running && step && <div className="calibration-step">
        <p aria-live="polite"><Hand size={19}/> ขยับนิ้วชี้ไปทาง{step.label}เท่าที่สบายและยังเห็นมือในภาพ ค้างไว้แล้วกดบันทึก</p>
        <button type="button" className="secondary" onClick={recordReach}>บันทึกขอบ{step.label}</button>
      </div>}
      {running && note && <p className="learning-note" role="status">{note}</p>}
      {running && practice && <p className="learning-note" role="status">
        <Check size={18}/> บันทึกช่วงมือแล้ว {practice === 'done' ? '· ทดลองหยิบและปล่อยสำเร็จ' : practice === 'grabbed' ? '· ลองคลายนิ้วเพื่อปล่อย' : '· ลองเลื่อนเป้าไปที่วงกลางแล้วหนีบและคลายนิ้ว'}
      </p>}
      <div className="button-row">
        {running ? <button type="button" className="primary" onClick={onUse}><Check size={18}/> ใช้กล้อง</button> : <button type="button" className="primary" ref={focusButton} disabled={loading} onClick={enable}><Camera size={18}/> เปิดกล้อง</button>}
        {!required && <button type="button" className="secondary" onClick={chooseMouse}><Mouse size={18}/> ใช้เมาส์</button>}
      </div>
    </div>
  </dialog>;
}

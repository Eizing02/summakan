import { useEffect, useRef, useState, type RefObject } from 'react';
import { Camera, Check, Crosshair, Hand, Mouse, X } from 'lucide-react';
import { HandTracker, type CameraHelp } from '../../core/input/hand-tracker';
import { GestureMachine, type Calibration, type GestureFrame } from '../../core/input/gesture-machine';
import type { Preferences } from '../settings/settings';

const connections = [[0,1,2,3,4], [0,5,6,7,8], [5,9,10,11,12], [9,13,14,15,16], [13,17,18,19,20], [0,17]];
export interface CameraControl {
  close: () => void;
  stop: () => void;
}

interface CameraPanelProps {
  open: boolean;
  control: RefObject<CameraControl | null>;
  preferences: Preferences;
  onCalibration: (settings: Calibration) => void;
  onClose: () => void;
  onStatus: (status: string, running: boolean) => void;
  gameFrame: RefObject<((frame: GestureFrame) => boolean) | null>;
}

export function CameraPanel({ open, control, preferences, onCalibration, onClose, onStatus, gameFrame }: CameraPanelProps) {
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<SVGSVGElement>(null);
  const statusLine = useRef<HTMLParagraphElement>(null);
  const focusButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const tracker = useRef(new HandTracker());
  const machine = useRef(new GestureMachine());
  const last = useRef<GestureFrame | null>(null);
  const hovering = useRef(false);
  const settings = useRef({ open, calibration: preferences.calibration });
  settings.current = { open, calibration: preferences.calibration };
  const [status, setStatus] = useState('กล้องยังปิดอยู่');
  const [help, setHelp] = useState<CameraHelp>();
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [drilling, setDrilling] = useState(false);
  const drill = useRef({ active: false, corners: 0, grabbed: false, dropped: false });
  const [progress, setProgress] = useState({ corners: 0, grabbed: false, dropped: false });
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
    last.current = null;
    gameFrame.current?.({ point: null, event: 'cancel', state: 'NO_HAND' });
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

  function onFrame(hands: Parameters<GestureMachine['frame']>[0], timestamp: number, aspect: number) {
    const frame = machine.current.frame(hands, timestamp, aspect, settings.current.calibration, hovering.current);
    if (!frame) return;
    last.current = frame;
    if (!settings.current.open) {
      hovering.current = gameFrame.current?.(frame) ?? false;
      if (timestamp - lastUpdate.current >= 280) {
        lastUpdate.current = timestamp;
        onStatus(frame.hand ? 'พบมือ · ' + Math.round(frame.hand.confidence * 100) + '%' : 'กำลังมองหามือ', true);
      }
      return;
    }
    const landmarks = frame.hand?.landmarks;
    overlay.current?.querySelectorAll<SVGPolylineElement>('polyline').forEach((line, index) => {
      line.setAttribute('points', landmarks ? connections[index].map(i => `${(1 - landmarks[i].x) * 100},${landmarks[i].y * 100}`).join(' ') : '');
    });
    const marker = overlay.current?.querySelector('[data-tracking-cursor]');
    if (marker && frame.point) {
      marker.setAttribute('cx', String(frame.point.x * 100));
      marker.setAttribute('cy', String(frame.point.y * 100));
      marker.setAttribute('visibility', 'visible');
      marker.setAttribute('fill', frame.state === 'DRAGGING' || frame.state === 'GRABBING' ? '#fde09a' : '#82e4ff');
    } else marker?.setAttribute('visibility', 'hidden');
    if (statusLine.current && timestamp - lastUpdate.current >= 180) {
      lastUpdate.current = timestamp;
      statusLine.current.textContent = frame.hand
        ? `พบมือ${frame.hand.handedness === 'Left' ? 'ซ้าย' : 'ขวา'} · ความมั่นใจ ${Math.round(frame.hand.confidence * 100)}%`
        : 'ยังไม่พบมือ ลองวางมือกลางภาพ';
    }
    const current = drill.current;
    if (current.active && frame.point) {
      const { x, y } = frame.point;
      const previous = current.corners + Number(current.grabbed) * 16 + Number(current.dropped) * 32;
      if ((x < .21 || x > .79) && (y < .21 || y > .79)) current.corners |= 1 << (Number(x > .5) + 2 * Number(y > .5));
      if (frame.event === 'grab' && Math.hypot(x - .5, y - .5) < .21) current.grabbed = true;
      if (frame.event === 'drop' && current.grabbed) current.dropped = true;
      if (previous !== current.corners + Number(current.grabbed) * 16 + Number(current.dropped) * 32) setProgress({ ...current });
    }
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
      if (!active) gameFrame.current?.({ point: null, event: 'cancel', state: 'TRACKING_LOST' });
    }, preferences.delegate);
  }

  function beginCalibration() {
    const tip = last.current?.hand?.landmarks[8];
    if (tip) onCalibration({ ...preferences.calibration, centerX: 1 - tip.x, centerY: tip.y });
    drill.current = { active: true, corners: 0, grabbed: false, dropped: false };
    setProgress({ ...drill.current });
    setDrilling(true);
  }

  const { calibration } = preferences;
  const close = () => { if (loading) stop(); onClose(); };
  const chooseMouse = () => { stop(); onClose(); };
  return <dialog ref={dialog} className="dialog dialog-wide camera-dialog" aria-label="ตั้งค่ากล้อง"
    onCancel={event => { event.preventDefault(); close(); }}>
    <header className="dialog-header"><h2><Camera size={24}/> ตั้งค่ากล้อง</h2><button type="button" className="icon-button" aria-label="ปิด" onClick={close}><X size={21}/></button></header>
    <div className="dialog-body">
      <p>อนุญาตให้ใช้กล้องเพื่อใช้นิ้วชี้เลื่อนเคอร์เซอร์และหนีบนิ้วเพื่อหยิบวัตถุ ภาพจะประมวลผลบนอุปกรณ์นี้</p>
      <div className="camera-grid">
        <div className="camera-column">
          <div className="camera-preview">
            <video ref={video} muted playsInline autoPlay aria-hidden="true" />
            {!running && <div className="camera-empty" role="status"><Camera size={38}/><span>{status}</span></div>}
            <svg ref={overlay} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {connections.map((_, i) => <polyline key={i} fill="none" stroke="#8af6cc" strokeWidth=".6"/>)}
              {drilling && [0, 1, 2, 3].map(i => <rect key={i} x={i % 2 ? 81 : 7} y={i >= 2 ? 81 : 7} width="12" height="12" rx="2" stroke={progress.corners & (1 << i) ? '#8af6cc' : '#e8bc68'} strokeWidth="1.3" fill="none" />)}
              {drilling && <circle cx="50" cy="50" r="10" stroke="#e8bc68" strokeWidth="1" fill="none" data-calibration-target="true"/>}
              <circle data-tracking-cursor="true" cx="50" cy="50" r="2" stroke="#0f1b2d" strokeWidth=".6" fill="#82e4ff" visibility="hidden"/>
            </svg>
          </div>
          {running && <p><span>{status}</span><br/><span ref={statusLine}>ยกมือให้อยู่ในกรอบกล้อง</span></p>}
        </div>
        <div className="camera-options">
          <label>มือที่ใช้<select value={calibration.hand} onChange={event => {
            machine.current = new GestureMachine();
            onCalibration({ ...calibration, hand: event.target.value as Calibration['hand'] });
          }}>
            <option value="Auto">เลือกอัตโนมัติ</option><option value="Left">ซ้าย</option><option value="Right">ขวา</option>
          </select></label>
          <label>ความไวเคอร์เซอร์<input type="range" min=".65" max="1.65" step=".05" value={calibration.cursorGain} onChange={event => onCalibration({ ...calibration, cursorGain: +event.target.value })}/></label>
          <label>ความไวการหนีบ<input type="range" min=".12" max=".48" step=".01" value={calibration.pinch} onChange={event => onCalibration({ ...calibration, pinch: +event.target.value })}/></label>
          <label>ขนาดพื้นที่การเคลื่อนไหว<input type="range" min=".32" max="1" step=".02" value={calibration.reach} onChange={event => onCalibration({ ...calibration, reach: +event.target.value })}/></label>
          {running && <button type="button" className="secondary" onClick={beginCalibration}><Crosshair size={18}/> เริ่มปรับเทียบ</button>}
        </div>
      </div>
      {help === 'browser' && <p className="learning-note">ถ้าเปิดเกมจากหน้าพรีวิวในแอป ให้คัดลอก {location.origin + location.pathname} ไปเปิดใน Chrome หรือ Edge โดยตรง แล้วเลือก <strong>ตั้งค่ากล้อง → เปิดกล้อง → อนุญาต</strong> หากเคยกดบล็อก ให้เปลี่ยนสิทธิ์กล้องจากไอคอนข้างแถบที่อยู่แล้วโหลดหน้าใหม่</p>}
      {help === 'secure-origin' && <p className="learning-note">บนเครื่องที่รันเกม ให้เปิดจากเซิร์ฟเวอร์ในเครื่องผ่าน <code>http://127.0.0.1</code> หากเปิดจากเครื่องอื่น ให้ใช้ที่อยู่เว็บ HTTPS</p>}
      {drilling && <p className="learning-note"><Hand size={19}/> ชี้ไปที่มุมทั้งสี่ แล้วหนีบตรงวงกลางและคลายนิ้ว {progress.corners === 15 && progress.dropped && <><Check size={18}/> ปรับเทียบเสร็จแล้ว</>}</p>}
      <div className="button-row">
        {running ? <button type="button" className="primary" onClick={onClose}><Check size={18}/> ใช้กล้อง</button> : <button type="button" className="primary" ref={focusButton} disabled={loading} onClick={enable}><Camera size={18}/> เปิดกล้อง</button>}
        <button type="button" className="secondary" onClick={chooseMouse}><Mouse size={18}/> ใช้เมาส์</button>
      </div>
    </div>
  </dialog>;
}

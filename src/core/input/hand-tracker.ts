import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { ObservedHand } from './gesture-machine';

type Delegate = 'GPU' | 'CPU';
type DetectorFrame = (hands: ObservedHand[], timestamp: number, aspect: number) => void;
export type CameraHelp = 'browser' | 'secure-origin';
type CameraStatus = (message: string, running: boolean, help?: CameraHelp) => void;

const runtime = () => new URL(import.meta.env.BASE_URL + 'mediapipe/', document.baseURI);
function handsFrom(result: HandLandmarkerResult): ObservedHand[] {
  return result.landmarks.map((landmarks, index) => {
    const category = result.handedness[index]?.[0];
    return { landmarks, handedness: category?.categoryName === 'Left' ? 'Left' : 'Right', confidence: category?.score ?? 0 };
  });
}

async function mainThreadDetector(preferred: Delegate) {
  const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
  const files = await FilesetResolver.forVisionTasks(new URL('wasm', runtime()).href);
  const create = (delegate: Delegate) => HandLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: new URL('hand_landmarker.task', runtime()).href, delegate },
    runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.55, minTrackingConfidence: 0.55,
  });
  try {
    return { detector: await create(preferred), delegate: preferred };
  } catch (error) {
    if (preferred === 'CPU') throw error;
    return { detector: await create('CPU'), delegate: 'CPU' as const };
  }
}

function workerDetector(worker: Worker, preference: Delegate) {
  return new Promise<Delegate>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('เริ่ม Worker เกินเวลาที่กำหนด')), 12000);
    const finish = () => {
      clearTimeout(timeout);
      worker.onmessage = null;
      worker.onerror = null;
    };
    worker.onmessage = ({ data }) => {
      finish();
      if (data.type === 'ready') resolve(data.delegate);
      else reject(new Error(data.message ?? 'Worker ไม่พร้อม'));
    };
    worker.onerror = () => {
      finish();
      reject(new Error('เปิด Worker ไม่สำเร็จ'));
    };
    worker.postMessage({ type: 'init', preference });
  });
}

export function cameraError(error: unknown): { message: string; help?: CameraHelp } {
  const name = (error as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return { message: 'เบราว์เซอร์ยังไม่อนุญาตให้ใช้กล้อง', help: 'browser' };
  if (name === 'NotSupportedError') return { message: 'ตัวเปิดหน้านี้ไม่รองรับการใช้กล้อง', help: 'browser' };
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return { message: 'ไม่พบกล้อง เชื่อมต่อกล้องแล้วลองอีกครั้ง' };
  if (name === 'NotReadableError' || name === 'TrackStartError') return { message: 'เปิดกล้องไม่ได้ ลองปิดแอปอื่นที่กำลังใช้กล้อง' };
  return { message: 'เริ่มระบบกล้องไม่ได้ ลองเปิดกล้องอีกครั้งหรือใช้เมาส์' };
}

export class HandTracker {
  private stream?: MediaStream;
  private worker?: Worker;
  private closeDetector?: () => void;
  private request = 0;
  private generation = 0;
  private video?: HTMLVideoElement;
  private busy = false;
  private handlingFrame = false;
  private hidden?: () => void;

  async start(video: HTMLVideoElement, onFrame: DetectorFrame, onStatus: CameraStatus, preference: Delegate = 'GPU') {
    this.stop();
    const generation = this.generation;
    this.video = video;
    const active = () => generation === this.generation;
    const fail = (message: string, help?: CameraHelp) => {
      if (!active()) return;
      this.stop();
      onStatus(message, false, help);
    };
    try {
      if (!window.isSecureContext || location.protocol === 'file:') {
        fail('กล้องต้องเปิดจาก HTTPS หรือเซิร์ฟเวอร์ในเครื่อง', 'secure-origin');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        fail('ตัวเปิดหน้านี้ไม่รองรับการใช้กล้อง', 'browser');
        return;
      }
      onStatus('กำลังขออนุญาตใช้กล้อง…', false);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: 'user' }, audio: false,
      });
      if (!active()) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      this.stream = stream;
      stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => fail('กล้องถูกตัดการเชื่อมต่อ ใช้เมาส์หรือเปิดกล้องอีกครั้ง'), { once: true }));
      video.srcObject = stream;
      await video.play();
      if (!active()) return;
      onStatus('กำลังโหลดระบบตรวจจับมือ…', false);
      const aspect = () => video.videoWidth / Math.max(1, video.videoHeight);
      let delegate: Delegate;
      let run: (timestamp: number) => void;
      let viaWorker = false;
      let worker: Worker | undefined;
      let workerDelegate: Delegate | undefined;

      if (typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function' && typeof Worker !== 'undefined') {
        try {
          worker = new Worker(new URL('hand-worker.js', runtime()));
          this.worker = worker;
          workerDelegate = await workerDetector(worker, preference);
          if (!active()) return;
        } catch (error) {
          console.info('MediaPipe Worker unavailable', error);
          worker?.terminate();
          worker = undefined;
          if (active()) this.worker = undefined;
        }
      }
      if (!active()) return;

      if (worker && workerDelegate) {
        delegate = workerDelegate;
        this.attachWorker(worker, onFrame, aspect, fail);
        viaWorker = true;
        const runningWorker = worker;
        run = timestamp => {
          this.busy = true;
          void createImageBitmap(video).then(bitmap => {
            if (!active()) { bitmap.close(); return; }
            runningWorker.postMessage({ type: 'frame', bitmap, timestamp }, [bitmap]);
          }).catch(() => {
            if (active()) {
              this.busy = false;
              onFrame([], performance.now(), aspect());
            }
          });
        };
      } else {
        const { detector, delegate: actual } = await mainThreadDetector(preference);
        if (!active()) { detector.close(); return; }
        this.closeDetector = () => detector.close();
        delegate = actual;
        run = timestamp => onFrame(handsFrom(detector.detectForVideo(video, timestamp)), timestamp, aspect());
      }
      const fallback = preference === 'GPU' && delegate === 'CPU' ? 'เปิด GPU ไม่สำเร็จ ใช้ CPU แทน' : 'เปิดกล้องแล้ว · ' + delegate;
      onStatus(fallback + (viaWorker ? ' · Worker' : ''), true);
      let lastCapture = -Infinity;
      let lastVideo = -1;
      let lastFrame = performance.now();
      this.hidden = () => {
        if (document.hidden) onFrame([], performance.now() + 300, aspect());
      };
      document.addEventListener('visibilitychange', this.hidden);
      const loop = (timestamp: number) => {
        if (!active()) return;
        if (video.readyState >= 2 && video.currentTime !== lastVideo && timestamp - lastCapture >= 39 && !this.busy) {
          lastCapture = timestamp;
          lastVideo = video.currentTime;
          lastFrame = timestamp;
          this.handlingFrame = true;
          try { run(timestamp); } catch { fail('การตรวจจับมือขัดข้อง ลองเปิดกล้องอีกครั้ง'); }
          finally { this.handlingFrame = false; }
        // A frame still running on a slow device is different from an empty tracking result.
        } else if (timestamp - lastFrame > (this.busy ? 2200 : 350)) {
          onFrame([], timestamp, aspect());
          lastFrame = timestamp;
        }
        if (active()) this.request = requestAnimationFrame(loop);
      };
      this.request = requestAnimationFrame(loop);
    } catch (error) {
      console.warn('Balance Quest camera setup failed', error);
      const { message, help } = cameraError(error);
      fail(message, help);
    }
  }

  private attachWorker(
    worker: Worker, onFrame: DetectorFrame, aspect: () => number, fail: (message: string) => void,
  ) {
    worker.onmessage = ({ data }) => {
      this.busy = false;
      if (data.type === 'frame') onFrame(handsFrom(data.result), performance.now(), aspect());
      if (data.type === 'error') fail('การตรวจจับมือขัดข้อง ลองเปิดกล้องอีกครั้ง');
    };
    worker.onerror = () => fail('ระบบประมวลผลมือหยุดทำงาน ลองเปิดกล้องอีกครั้ง');
  }

  stop() {
    this.generation += 1;
    cancelAnimationFrame(this.request);
    if (this.hidden) document.removeEventListener('visibilitychange', this.hidden);
    this.hidden = undefined;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
    }
    this.worker = undefined;
    const close = this.closeDetector;
    this.closeDetector = undefined;
    if (this.handlingFrame && close) queueMicrotask(close);
    else close?.();
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.video = undefined;
    this.busy = false;
  }
}

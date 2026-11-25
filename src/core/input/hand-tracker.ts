import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { ObservedHand } from './gesture-machine';

type Delegate = 'GPU' | 'CPU';
type DetectorFrame = (hands: ObservedHand[], timestamp: number, aspect: number, reset?: boolean) => void;
export type CameraHelp = 'browser' | 'secure-origin';
type CameraStatus = (message: string, running: boolean, help?: CameraHelp) => void;

const runtime = () => new URL(import.meta.env.BASE_URL + 'mediapipe/', document.baseURI);
// Capture limits and video-frame scheduling follow Thai-kum-prasom (a633d80).
const captureProfiles = {
  low: { hz: 16, width: 384 },
  medium: { hz: 24, width: 480 },
  high: { hz: 30, width: 640 },
};

function frameHeight(video: HTMLVideoElement, width: number) {
  return Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
}

function resizeWithCanvas(context: CanvasRenderingContext2D, video: HTMLVideoElement, width: number) {
  const canvas = context.canvas;
  const height = frameHeight(video, width);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  context.drawImage(video, 0, 0, width, height);
  return canvas;
}
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
    runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: .53, minHandPresenceConfidence: .5, minTrackingConfidence: .5,
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
    // A cold start needs to fetch the model and compile WASM before the Worker can respond.
    const timeout = window.setTimeout(() => {
      finish();
      reject(new Error('เริ่ม Worker เกินเวลาที่กำหนด'));
    }, 25000);
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
  private cancelFrames?: () => void;
  private generation = 0;
  private video?: HTMLVideoElement;
  private busy = false;
  private handlingFrame = false;
  private hidden?: () => void;

  async start(video: HTMLVideoElement, onFrame: DetectorFrame, onStatus: CameraStatus, preference: Delegate = 'CPU') {
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
      let delegate: Delegate = preference;
      let run: (timestamp: number, width: number) => void;
      let viaWorker = false;
      let lastDelivered = -Infinity;
      let lastArrival = performance.now();
      let stalled = false;
      let recovered = false;
      let recovering = false;
      const receive: DetectorFrame = (hands, time, ratio) => {
        if (!active() || time <= lastDelivered || document.hidden) return;
        lastDelivered = time;
        lastArrival = performance.now();
        stalled = false;
        onFrame(hands, time, ratio);
      };
      const webKit = /iPhone|iPad|iPod/.test(navigator.userAgent) || navigator.vendor === 'Apple Computer, Inc.';
      let canvas: CanvasRenderingContext2D | null | undefined;
      const canvasForCapture = () => canvas ??= document.createElement('canvas').getContext('2d', { alpha: false });
      const reportReady = () => {
        const label = preference === 'GPU' && delegate === 'CPU' ? 'เปิด GPU ไม่สำเร็จ ใช้ CPU แทน' : 'เปิดกล้องแล้ว · ' + delegate;
        onStatus(label + (viaWorker ? ' · Worker' : ''), true);
      };

      async function grabFrame(width: number) {
        if (!webKit) {
          try {
            return await createImageBitmap(video, { resizeWidth: width, resizeHeight: frameHeight(video, width), resizeQuality: 'low' });
          } catch { /* Use a canvas when direct bitmap conversion is unavailable. */ }
        }
        const context = canvasForCapture();
        return createImageBitmap(context ? resizeWithCanvas(context, video, width) : video);
      }

      const startWorker = async (wanted: Delegate) => {
        if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function' || typeof Worker === 'undefined') return false;
        let worker: Worker | undefined;
        try {
          const detectorWorker = new Worker(new URL('hand-worker.js', runtime()));
          worker = this.worker = detectorWorker;
          delegate = await workerDetector(detectorWorker, wanted);
          if (!active()) return false;
          this.attachWorker(detectorWorker, receive, aspect, recover);
          viaWorker = true;
          run = (timestamp, width) => {
            this.busy = true;
            void grabFrame(width).then(bitmap => {
              if (!active() || this.worker !== detectorWorker) { bitmap.close(); return; }
              try { detectorWorker.postMessage({ type: 'frame', bitmap, timestamp }, [bitmap]); }
              catch (error) { bitmap.close(); throw error; }
            }).catch(() => {
              if (active() && this.worker === detectorWorker) void recover();
            });
          };
          return true;
        } catch (error) {
          console.info('MediaPipe Worker unavailable', error);
          worker?.terminate();
          if (active() && this.worker === worker) this.worker = undefined;
          return false;
        }
      };

      const startMain = async (wanted: Delegate) => {
        const { detector, delegate: actual } = await mainThreadDetector(wanted);
        if (!active()) { detector.close(); return; }
        this.closeDetector = () => detector.close();
        delegate = actual;
        viaWorker = false;
        run = (timestamp, width) => {
          const context = canvasForCapture();
          const result = detector.detectForVideo(context ? resizeWithCanvas(context, video, width) : video, timestamp);
          receive(handsFrom(result), timestamp, aspect());
        };
      };

      const recover = async () => {
        if (!active() || recovering) return;
        if (!viaWorker && (delegate === 'CPU' || recovered)) {
          fail('การตรวจจับมือขัดข้อง ลองเปิดกล้องอีกครั้ง');
          return;
        }
        recovering = true;
        const retryWorker = !recovered && viaWorker && delegate === 'GPU';
        recovered = true;
        this.worker?.terminate();
        this.worker = undefined;
        this.closeDetector?.();
        this.closeDetector = undefined;
        onStatus('กำลังสลับไปใช้ CPU…', false);
        try {
          const retryStarted = retryWorker && await startWorker('CPU');
          if (!retryStarted && active()) await startMain('CPU');
          if (active()) { lastArrival = performance.now(); reportReady(); }
        } catch {
          fail('การตรวจจับมือขัดข้อง ลองเปิดกล้องอีกครั้ง');
        } finally {
          if (active()) {
            this.busy = false;
            recovering = false;
          }
        }
      };

      if (!await startWorker(preference)) {
        if (!active()) return;
        await startMain(preference);
      }
      if (!active()) return;
      reportReady();
      let lastCapture = -Infinity;
      let lastVideo = -1;
      let lastCameraFrame = lastArrival = performance.now();
      let request = 0;
      let videoFrames = typeof video.requestVideoFrameCallback === 'function';
      const cancelRequest = () => {
        if (videoFrames) video.cancelVideoFrameCallback(request);
        else cancelAnimationFrame(request);
      };
      this.hidden = () => {
        if (document.hidden) {
          lastDelivered = performance.now();
          onFrame([], lastDelivered, aspect(), true);
        } else {
          lastArrival = lastCameraFrame = performance.now();
        }
      };
      document.addEventListener('visibilitychange', this.hidden);
      const schedule = () => {
        request = videoFrames
          ? video.requestVideoFrameCallback((time, info) => loop(time, info.mediaTime))
          : requestAnimationFrame(time => loop(time, video.currentTime));
      };
      const loop = (timestamp: number, mediaTime: number) => {
        if (!active()) return;
        schedule();
        if (document.hidden || !video.videoWidth || video.readyState < 2 || mediaTime === lastVideo) return;
        lastVideo = mediaTime;
        lastCameraFrame = timestamp;
        const profile = delegate === 'GPU' ? captureProfiles.high :
          recovered || navigator.hardwareConcurrency <= 4 ? captureProfiles.low : captureProfiles.medium;
        if (recovering || this.busy || timestamp - lastCapture < 1000 / profile.hz) return;
        lastCapture = timestamp;
        this.handlingFrame = true;
        try { run(timestamp, Math.min(video.videoWidth, profile.width)); } catch { void recover(); }
        finally { this.handlingFrame = false; }
      };
      const watchdog = window.setInterval(() => {
        if (!active() || document.hidden || recovering) return;
        const now = performance.now();
        if (videoFrames && video.readyState >= 2 && now - lastCameraFrame > 500) {
          cancelRequest();
          videoFrames = false;
          lastVideo = -1;
          schedule();
        }
        // Wait for inference rather than interpreting an in-flight frame as an absent hand.
        if (!stalled && now - lastArrival > 1100) {
          stalled = true;
          lastDelivered = now;
          onFrame([], now, aspect(), true);
        }
        if (this.busy && now - lastCapture > 2500) void recover();
      }, 200);
      this.cancelFrames = () => {
        cancelRequest();
        window.clearInterval(watchdog);
        if (canvas) { canvas.canvas.width = 0; canvas.canvas.height = 0; }
      };
      schedule();
    } catch (error) {
      console.warn('Balance Quest camera setup failed', error);
      const { message, help } = cameraError(error);
      fail(message, help);
    }
  }

  private attachWorker(
    worker: Worker, onFrame: DetectorFrame, aspect: () => number, recover: () => Promise<void>,
  ) {
    worker.onmessage = ({ data }) => {
      if (data.type === 'frame') {
        this.busy = false;
        onFrame(handsFrom(data.result), data.timestamp, aspect());
      } else if (data.type === 'error') void recover();
    };
    worker.onerror = () => void recover();
  }

  stop() {
    this.generation += 1;
    this.cancelFrames?.();
    this.cancelFrames = undefined;
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

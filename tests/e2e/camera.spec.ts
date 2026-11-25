import { expect, test, type Page } from '@playwright/test';

type TestPose = { x: number; y: number; pinched: boolean; step: number };
type CameraTestWindow = Window & { testStream?: MediaStream; testCameraStarts?: number; testPose?: TestPose };

async function withSyntheticCamera(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('balance-quest-preferences', JSON.stringify({ quality: '2d', reduced: true, mute: true }));
    const StandardWorker = Worker;
    class ObservedWorker extends StandardWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', event => {
          if (event.data.type !== 'frame') return;
          document.documentElement.dataset.inference = String(event.data.timestamp);
          const pose = (window as CameraTestWindow).testPose;
          if (!pose) return;
          document.documentElement.dataset.testPoseStep = String(pose.step);
          const x = .5 + (.5 - pose.x) * .65;
          const y = .5 + (pose.y - .5) * .65;
          const landmarks = Array.from({ length: 21 }, () => ({ x, y }));
          landmarks[0] = { x, y: y + .15 };
          landmarks[9] = { x, y: y + .05 };
          landmarks[5] = { x: x + .04, y };
          landmarks[17] = { x: x - .04, y };
          landmarks[4] = { x: x + (pose.pinched ? .005 : .065), y };
          event.data.result.landmarks = [landmarks];
          event.data.result.handedness = [[{ categoryName: 'Right', score: .98 }]];
        });
      }
    }
    window.Worker = ObservedWorker;
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d')!;
      const stream = canvas.captureStream(25);
      let counter = 0;
      const timer = setInterval(() => {
        if (stream.getTracks()[0].readyState === 'ended') return clearInterval(timer);
        ctx.fillStyle = counter++ % 2 ? '#283343' : '#283344';
        ctx.fillRect(0, 0, 320, 240);
      }, 40);
      const testWindow = window as CameraTestWindow;
      testWindow.testStream = stream;
      testWindow.testCameraStarts = (testWindow.testCameraStarts ?? 0) + 1;
      return stream;
    };
  });
}

test('permission denial keeps mouse mode available', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => { throw new DOMException('Denied for test', 'NotAllowedError'); } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'ตั้งค่ากล้อง' }).click();
  await page.getByRole('button', { name: 'เปิดกล้อง', exact: true }).click();
  await expect(page.getByText('เบราว์เซอร์ยังไม่อนุญาตให้ใช้กล้อง', { exact: false })).toBeVisible();
  await expect(page.getByText(/เปิดใน Chrome หรือ Edge โดยตรง/)).toBeVisible();
  await page.getByRole('button', { name: 'ใช้เมาส์', exact: true }).click();
  await page.getByRole('button', { name: 'เริ่มเรียนรู้' }).click();
  await expect(page.locator('.inventory')).toBeVisible();
});

test('local MediaPipe GPU processes a synthetic stream and handles track disconnection', async ({ page }) => {
  await withSyntheticCamera(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'ตั้งค่ากล้อง' }).click();
  await page.getByRole('button', { name: 'เปิดกล้อง', exact: true }).click();
  const camera = page.getByRole('dialog', { name: 'ตั้งค่ากล้อง' });
  await expect(camera.getByText('เปิดกล้องแล้ว · GPU · Worker', { exact: true })).toBeVisible({ timeout: 23000 });
  await expect(page.locator('html')).toHaveAttribute('data-inference', /\d/);
  await expect(camera.getByText('ยังไม่พบมือ', { exact: false })).toBeVisible();
  await page.evaluate(() => {
    const track = (window as Window & { testStream?: MediaStream }).testStream?.getVideoTracks()[0];
    track?.dispatchEvent(new Event('ended'));
  });
  await expect(camera.getByText('กล้องถูกตัดการเชื่อมต่อ', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { testStream?: MediaStream }).testStream?.getVideoTracks()[0].readyState)).toBe('ended');
});

test('GPU initialization failure falls back to CPU and processes synthetic video frames', async ({ page }) => {
  await withSyntheticCamera(page);
  await page.route('**/mediapipe/hand-worker.js', async route => {
    const response = await route.fetch();
    const script = (await response.text()).replace('async function setup(delegate) {',
      "async function setup(delegate) { if (delegate === 'GPU') throw new Error('Test GPU initialization failure');");
    await route.fulfill({ response, body: script });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'ตั้งค่ากล้อง' }).click();
  await page.getByRole('button', { name: 'เปิดกล้อง', exact: true }).click();
  const camera = page.getByRole('dialog', { name: 'ตั้งค่ากล้อง' });
  await expect(camera.getByText('เปิด GPU ไม่สำเร็จ ใช้ CPU แทน · Worker', { exact: true })).toBeVisible({ timeout: 23000 });
  await expect(page.locator('html')).toHaveAttribute('data-inference', /\d/);
  await expect(camera.getByText('ยังไม่พบมือ', { exact: false })).toBeVisible();
  await camera.getByRole('button', { name: 'เริ่มปรับเทียบ' }).click();
  await expect(camera.locator('[data-calibration-target="true"]')).toBeVisible();
  await camera.getByRole('button', { name: 'ใช้เมาส์', exact: true }).click();
  await expect(camera).toBeHidden();
  await page.getByRole('button', { name: 'เริ่มเรียนรู้' }).click();
  await expect(page.locator('.vector-scale')).toBeVisible();
});

test('camera stays on after solving, can restart on results, and continues into the next question', async ({ page }) => {
  test.setTimeout(65000);
  await withSyntheticCamera(page);
  await page.goto('/');
  const settings = page.getByRole('button', { name: 'ตั้งค่ากล้อง', exact: true });
  const camera = page.getByRole('dialog', { name: 'ตั้งค่ากล้อง' });
  async function startCamera() {
    await settings.click();
    await camera.getByRole('button', { name: 'เปิดกล้อง', exact: true }).click();
    await expect(camera.getByRole('button', { name: 'ใช้กล้อง', exact: true })).toBeVisible({ timeout: 23000 });
    await camera.getByRole('button', { name: 'ใช้กล้อง', exact: true }).click();
  }
  const stream = () => page.evaluate(() => {
    const testWindow = window as CameraTestWindow;
    return { starts: testWindow.testCameraStarts, track: testWindow.testStream?.getVideoTracks()[0].readyState };
  });

  await startCamera();
  await page.getByRole('button', { name: 'เริ่มเรียนรู้' }).click();
  for (const side of ['left', 'right']) {
    const slot = page.locator('[data-drop-side="' + side + '"]');
    await page.locator('.inventory-tile[data-tile="−"]').click();
    await slot.click();
    await page.locator('.inventory-tile[data-tile="3"]').click();
    await slot.click();
  }
  const verify = page.getByRole('dialog', { name: 'แทนค่าตรวจคำตอบ' });
  await verify.getByLabel('ค่า x').fill('5');
  await verify.getByRole('button', { name: 'ตรวจคำตอบ' }).click();
  await expect(page.getByRole('heading', { name: 'ผ่านภารกิจ' })).toBeVisible();
  expect(await stream()).toEqual({ starts: 1, track: 'live' });
  await page.getByRole('button', { name: 'ปิดกล้อง' }).click();
  expect(await stream()).toEqual({ starts: 1, track: 'ended' });
  await startCamera();
  const inference = await page.locator('html').getAttribute('data-inference');
  await page.getByRole('button', { name: 'โจทย์ถัดไป' }).click();
  await expect(page.locator('.inventory')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ปิดกล้อง' })).toBeVisible();
  await expect.poll(() => page.locator('html').getAttribute('data-inference')).not.toBe(inference);
  expect(await stream()).toEqual({ starts: 2, track: 'live' });
  await page.getByRole('button', { name: 'กลับเมนูหลัก' }).click();
  expect(await stream()).toEqual({ starts: 2, track: 'ended' });
});

test('hand input can pick a number in the nearby gap and release it far from the pan', async ({ page }) => {
  await withSyntheticCamera(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'ตั้งค่ากล้อง', exact: true }).click();
  const camera = page.getByRole('dialog', { name: 'ตั้งค่ากล้อง' });
  await camera.getByRole('button', { name: 'เปิดกล้อง', exact: true }).click();
  await camera.getByRole('button', { name: 'ใช้กล้อง', exact: true }).click({ timeout: 23000 });
  await page.getByRole('button', { name: 'เริ่มเรียนรู้' }).click();
  await page.locator('.inventory-tile[data-tile="+"]').click();
  await page.locator('[data-drop-side="left"]').click();
  const digit = page.locator('.inventory-tile[data-tile="3"]');
  const tile = (await digit.boundingBox())!;
  let step = 0;
  const setPose = async (x: number, y: number, pinched: boolean) => {
    await page.evaluate(({ x, y, pinched, step }) => {
      const stage = document.querySelector('.gameplay')!.getBoundingClientRect();
      const testWindow = window as CameraTestWindow;
      testWindow.testPose = { x: (x - stage.left) / (stage.width - 1), y: (y - stage.top) / (stage.height - 1), pinched, step };
    }, { x, y, pinched, step: ++step });
    await expect(page.locator('html')).toHaveAttribute('data-test-pose-step', String(step));
  };
  await setPose(tile.x - 2, tile.y + tile.height / 2, false);
  await expect(digit).toHaveClass(/hand-hover/);
  await setPose(tile.x - 2, tile.y + tile.height / 2, true);
  const region = page.locator('[data-drop-region="left"]');
  await expect(region).toBeVisible();
  const bounds = (await region.boundingBox())!;
  const x = bounds.x + 24, y = bounds.y + bounds.height * .66;
  for (let progress = .1; progress <= 1.01; progress += .1) {
    await setPose(tile.x + (x - tile.x) * progress, tile.y + tile.height / 2 + (y - tile.y - tile.height / 2) * progress, true);
  }
  await expect(region).toHaveAttribute('data-over', 'true');
  await setPose(x, y, false);
  await expect(page.getByTestId('expression-left')).toHaveAttribute('aria-label', 'x + 3 + 3');
  await expect(region).toHaveCount(0);
});

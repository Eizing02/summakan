import { expect, test, type Page } from '@playwright/test';

type TestPose = { x: number; y: number; pinched: boolean; step: number };
type CameraTestWindow = Window & { testStream?: MediaStream; testCameraStarts?: number; testPose?: TestPose | null };

async function withSyntheticCamera(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('balance-quest-preferences', JSON.stringify({ quality: '2d', reduced: true, mute: true, calibration: { cursorGain: 1 } }));
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
          const { x, y, pinched } = pose;
          const offsets = [
            [0, .15], [.037, .12], [.05, .093], [pinched ? .02 : .064, .055], [pinched ? .005 : .065, 0],
            [.027, .059], [.02, .035], [.008, .015], [0, 0],
            [0, .055], [-.005, .015], [-.01, -.01], [-.014, -.029],
            [-.03, .06], [-.037, .025], [-.04, .005], [-.046, -.009],
            [-.057, .074], [-.065, .048], [-.071, .031], [-.075, .019],
          ];
          const landmarks = offsets.map(([dx, dy]) => ({ x: 1 - x + dx, y: y + dy }));
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

async function mockInference(page: Page) {
  await page.route('**/mediapipe/hand-worker.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `self.onmessage = ({ data }) => {
      if (data.type === 'init') self.postMessage({ type: 'ready', delegate: data.preference });
      else {
        data.bitmap.close();
        self.postMessage({ type: 'frame', result: { landmarks: [], handedness: [] }, timestamp: data.timestamp });
      }
    };`,
  }));
}

function moveSyntheticHand(page: Page) {
  let step = 0;
  return async (x: number, y: number, pinched = false) => {
    await page.evaluate(pose => { (window as CameraTestWindow).testPose = pose; }, { x, y, pinched, step: ++step });
    await expect(page.locator('html')).toHaveAttribute('data-test-pose-step', String(step));
  };
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
  test.setTimeout(75000);
  await withSyntheticCamera(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'ตั้งค่ากล้อง' }).click();
  await page.getByRole('button', { name: 'เปิดกล้อง', exact: true }).click();
  const camera = page.getByRole('dialog', { name: 'ตั้งค่ากล้อง' });
  await expect(camera.getByText('เปิดกล้องแล้ว · GPU · Worker', { exact: true })).toBeVisible({ timeout: 35000 });
  await expect(page.locator('html')).toHaveAttribute('data-inference', /\d/, { timeout: 25000 });
  await expect(camera.getByText('ยังไม่พบมือ', { exact: false })).toBeVisible();
  await page.evaluate(() => {
    const track = (window as Window & { testStream?: MediaStream }).testStream?.getVideoTracks()[0];
    track?.dispatchEvent(new Event('ended'));
  });
  await expect(camera.getByText('กล้องถูกตัดการเชื่อมต่อ', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { testStream?: MediaStream }).testStream?.getVideoTracks()[0].readyState)).toBe('ended');
});

test('GPU initialization failure falls back to CPU and processes synthetic video frames', async ({ page }) => {
  test.setTimeout(60000);
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
  await expect(camera.getByText('เปิด GPU ไม่สำเร็จ ใช้ CPU แทน · Worker', { exact: true })).toBeVisible({ timeout: 35000 });
  await expect(page.locator('html')).toHaveAttribute('data-inference', /\d/, { timeout: 12000 });
  await expect(camera.getByText('ยังไม่พบมือ', { exact: false })).toBeVisible();
  await camera.getByRole('button', { name: 'เริ่มปรับเทียบ' }).click();
  await expect(camera.locator('[data-calibration-target="true"]')).toBeVisible();
  await camera.getByRole('button', { name: 'ใช้เมาส์', exact: true }).click();
  await expect(camera).toBeHidden();
  await page.getByRole('button', { name: 'เริ่มเรียนรู้' }).click();
  await expect(page.locator('.vector-scale')).toBeVisible();
});

test('camera stays on after solving, can restart on results, and continues into the next question', async ({ page }) => {
  test.setTimeout(95000);
  await withSyntheticCamera(page);
  await page.goto('/');
  const settings = page.getByRole('button', { name: 'ตั้งค่ากล้อง', exact: true });
  const camera = page.getByRole('dialog', { name: 'ตั้งค่ากล้อง' });
  async function startCamera() {
    await settings.click();
    await camera.getByRole('button', { name: 'เปิดกล้อง', exact: true }).click();
    await expect(camera.getByRole('button', { name: 'ใช้กล้อง', exact: true })).toBeVisible({ timeout: 35000 });
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

test('calibration records comfortable extremes and practices closing and opening the hand', async ({ page }) => {
  await withSyntheticCamera(page);
  await mockInference(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'ตั้งค่ากล้อง', exact: true }).click();
  const camera = page.getByRole('dialog', { name: 'ตั้งค่ากล้อง' });
  await camera.getByRole('button', { name: 'เปิดกล้อง', exact: true }).click();
  await camera.getByRole('button', { name: 'เริ่มปรับเทียบ' }).click();
  const move = moveSyntheticHand(page);
  const edges = [
    { label: 'ซ้าย', x: .30, y: .5 }, { label: 'ขวา', x: .64, y: .5 },
    { label: 'บน', x: .47, y: .33 }, { label: 'ล่าง', x: .47, y: .67 },
  ];
  const first = camera.getByRole('button', { name: 'บันทึกขอบซ้าย' });
  await first.click();
  await expect(camera.getByText(/ยังไม่พบมือ ค้างนิ้วชี้/)).toBeVisible();
  for (const [index, edge] of edges.entries()) {
    const previous = edges[index - 1] ?? edge;
    for (const progress of [.25, .5, .75, 1]) await move(previous.x + (edge.x - previous.x) * progress, previous.y + (edge.y - previous.y) * progress);
    await move(edge.x, edge.y);
    await move(edge.x, edge.y);
    const marker = camera.locator('[data-tracking-cursor]');
    await expect(marker).toHaveAttribute('visibility', 'visible');
    await camera.getByRole('button', { name: 'บันทึกขอบ' + edge.label }).click();
  }
  await expect(camera.getByText(/บันทึกช่วงมือแล้ว/)).toBeVisible();
  const range = await page.evaluate(() => JSON.parse(localStorage.getItem('balance-quest-preferences')!).calibration.range);
  expect(range.left).toBeCloseTo(.30, 1);
  expect(range.right).toBeCloseTo(.64, 1);
  expect(range.top).toBeCloseTo(.33, 1);
  expect(range.bottom).toBeCloseTo(.67, 1);
  await move(.47, .58);
  await move(.47, .5);
  await expect.poll(async () => Number(await camera.locator('[data-tracking-cursor]').getAttribute('cy'))).toBeLessThan(56);
  await move(.47, .5, true);
  await expect(camera.getByText(/ลองคลายนิ้วเพื่อปล่อย/)).toBeVisible();
  await move(.47, .5);
  await expect(camera.getByText(/ทดลองหยิบและปล่อยสำเร็จ/)).toBeVisible();
});

test('compact desktop hand input reaches the tile tray, shows a translucent grip, and drops away from the pan', async ({ page }) => {
  await page.setViewportSize({ width: 1040, height: 440 });
  await withSyntheticCamera(page);
  await mockInference(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'ตั้งค่ากล้อง', exact: true }).click();
  const camera = page.getByRole('dialog', { name: 'ตั้งค่ากล้อง' });
  await camera.getByRole('button', { name: 'เปิดกล้อง', exact: true }).click();
  await camera.getByRole('button', { name: 'ใช้กล้อง', exact: true }).click({ timeout: 23000 });
  await page.getByRole('button', { name: 'เริ่มเรียนรู้' }).click();
  const tiles = page.locator('.inventory-tile');
  await expect(tiles).toHaveCount(14);
  for (const tile of await tiles.all()) await expect(tile).toBeInViewport({ ratio: 1 });
  await page.locator('.inventory-tile[data-tile="+"]').click();
  await page.locator('[data-drop-side="left"]').click();
  const digit = page.locator('.inventory-tile[data-tile="3"]');
  const tile = (await digit.boundingBox())!;
  const move = moveSyntheticHand(page);
  const lab = (await page.locator('.lab').boundingBox())!;
  const digits = (await page.locator('.digits').boundingBox())!;
  const last = (await page.locator('.digits .inventory-tile').last().boundingBox())!;
  const inset = Math.min(16, last.width * .25);
  const left = digits.x + inset, right = digits.x + digits.width - inset;
  const top = lab.y + 8, bottom = last.y + last.height * .76;
  const setPose = async (x: number, y: number, pinched: boolean) => {
    await move(.175 + .65 * (x - left) / (right - left), .175 + .65 * (y - top) / (bottom - top), pinched);
  };
  const cursor = page.locator('.hand-cursor');
  const ring = cursor.locator('.hand-cursor-aim');
  const fingers = cursor.locator('.hand-cursor-fingers');
  await setPose(tile.x - 2, tile.y + tile.height / 2, false);
  await expect(digit).toHaveClass(/hand-hover/);
  await expect(cursor).toHaveAttribute('data-mode', 'target');
  await expect(ring).toHaveCSS('border-top-color', 'rgb(211, 242, 255)');
  await expect(fingers).toHaveCSS('stroke-opacity', '0.28');
  const openPose = await fingers.getAttribute('d');
  await setPose(tile.x - 2, tile.y + tile.height / 2, true);
  const region = page.locator('[data-drop-region="left"]');
  await expect(region).toBeVisible();
  await expect(cursor).toHaveAttribute('data-mode', 'holding');
  await expect(ring).toHaveCSS('border-top-color', 'rgb(255, 211, 108)');
  await expect(fingers).not.toHaveAttribute('d', openPose!);
  const bounds = (await region.boundingBox())!;
  const x = left + 12, y = bounds.y + bounds.height * .66;
  for (let progress = .1; progress <= 1.01; progress += .1) {
    await setPose(tile.x + (x - tile.x) * progress, tile.y + tile.height / 2 + (y - tile.y - tile.height / 2) * progress, true);
  }
  await expect(region).toHaveAttribute('data-over', 'true');
  await setPose(x, y, false);
  await expect(page.getByTestId('expression-left')).toHaveAttribute('aria-label', 'x + 3 + 3');
  await expect(region).toHaveCount(0);
  await expect(cursor).toHaveAttribute('data-mode', 'aim');
  await expect(ring).toHaveCSS('border-top-color', 'rgb(158, 220, 255)');
  await setPose(x, y, true);
  await expect(cursor).toHaveAttribute('data-pose', 'DRAGGING');
  await expect(cursor).toHaveAttribute('data-mode', 'aim');
  await expect(region).toHaveCount(0);
  await page.evaluate(() => { (window as CameraTestWindow).testPose = null; });
  await expect(cursor).toHaveAttribute('data-mode', 'lost');
  await expect(cursor).toHaveCSS('opacity', '0');
});

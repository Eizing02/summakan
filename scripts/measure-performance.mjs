import { chromium } from 'playwright';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const url = process.env.BALANCE_QUEST_PREVIEW ?? 'http://127.0.0.1:4173/';
const viewport = { width: 1280, height: 720 };
const nativeGpu = process.env.BALANCE_QUEST_RENDERER === 'd3d11';
const browser = await chromium.launch(nativeGpu
  ? { channel: 'chromium', args: ['--enable-gpu', '--use-angle=d3d11'] }
  : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport });

await page.addInitScript(() => {
  localStorage.setItem('balance-quest-preferences', JSON.stringify({ quality: 'medium', reduced: false, mute: true }));
  localStorage.setItem('balance-quest-first-camera', 'true');
  const StandardWorker = window.Worker;
  window.__benchmarkFrames = 0;
  window.Worker = class extends StandardWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', ({ data }) => { if (data.type === 'frame') window.__benchmarkFrames++; });
    }
  };
  navigator.mediaDevices.getUserMedia = async () => {
    const scene = document.createElement('canvas');
    scene.width = 320;
    scene.height = 240;
    const context = scene.getContext('2d');
    const stream = scene.captureStream(25);
    let counter = 0;
    const timer = setInterval(() => {
      if (stream.getTracks()[0].readyState === 'ended') return clearInterval(timer);
      context.fillStyle = counter++ % 2 ? '#192b42' : '#1a2b42';
      context.fillRect(0, 0, 320, 240);
    }, 40);
    return stream;
  };
});

function percentile(samples, percent) {
  const sorted = [...samples].sort((a, b) => a - b);
  return Number(sorted[Math.ceil(sorted.length * percent) - 1].toFixed(2));
}

async function sampleFrames() {
  const result = await page.evaluate(() => new Promise(resolve => {
    const startFrames = window.__benchmarkFrames;
    const times = [];
    function next(timestamp) {
      times.push(timestamp);
      if (timestamp - times[0] >= 5000) resolve({ times, processed: window.__benchmarkFrames - startFrames });
      else requestAnimationFrame(next);
    }
    requestAnimationFrame(next);
  }));
  const { times, processed } = result;
  const seconds = (times.at(-1) - times[0]) / 1000;
  return {
    fps: Number(((times.length - 1) / seconds).toFixed(2)),
    frameMsP95: percentile(times.slice(1).map((time, i) => time - times[i]), .95),
    inferenceFps: Number((processed / seconds).toFixed(2)),
  };
}

async function sizeOf(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const sizes = await Promise.all(entries.map(entry => {
    const fullPath = join(path, entry.name);
    return entry.isDirectory() ? sizeOf(fullPath) : stat(fullPath).then(file => file.size);
  }));
  return sizes.reduce((sum, size) => sum + size, 0);
}

try {
  await page.goto(url);
  await page.getByRole('button', { name: 'เริ่มเรียนรู้' }).click();
  await page.locator('[data-renderer="3d"] canvas').waitFor();
  const renderer = await page.evaluate(() => {
    const context = document.querySelector('[data-renderer="3d"] canvas').getContext('webgl2');
    const debug = context.getExtension('WEBGL_debug_renderer_info');
    return debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER);
  });
  await page.waitForTimeout(1300);
  const noCamera = await sampleFrames();
  console.log('3D without camera', noCamera);

  const left = page.locator('[data-drop-side="left"]');
  const minus = page.locator('[data-tile="−"].inventory-tile');
  const number = page.locator('[data-tile="3"].inventory-tile');
  const undo = page.getByRole('button', { name: 'ย้อนกลับ' });
  const samples = [];
  for (let i = 0; i < 15; i += 1) {
    await minus.click();
    await left.click();
    const source = await number.boundingBox();
    const target = await left.boundingBox();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
    await page.evaluate(() => {
      const left = document.querySelector('[data-testid="anchor-left"]');
      window.__benchmarkDrop = new Promise(resolve => {
        window.addEventListener('pointerup', () => {
          const start = performance.now();
          const before = Number(left.dataset.angle);
          function probe() {
            if (Math.abs(Number(left.dataset.angle) - before) >= .001 || performance.now() - start > 2000) resolve(performance.now() - start);
            else requestAnimationFrame(probe);
          }
          requestAnimationFrame(probe);
        }, { capture: true, once: true });
      });
    });
    await page.mouse.up();
    samples.push(await page.evaluate(() => window.__benchmarkDrop));
    await undo.click();
    await undo.click();
    await page.waitForTimeout(380);
  }
  console.log('Drop to movement', { trials: samples.length, median: percentile(samples, .5), p95: percentile(samples, .95) });

  await page.getByRole('button', { name: 'ตั้งค่ากล้อง' }).click();
  await page.getByRole('button', { name: 'เปิดกล้อง', exact: true }).click();
  await page.waitForFunction(() => window.__benchmarkFrames >= 3, undefined, { timeout: 30000 });
  const camera = await page.getByRole('dialog').getByText(/GPU|CPU/).first().innerText();
  await page.getByRole('button', { name: 'ใช้กล้อง', exact: true }).click();
  const syntheticCamera = await sampleFrames();
  console.log('3D with synthetic camera', syntheticCamera);
  await page.getByRole('button', { name: 'ปิดกล้อง', exact: true }).click();

  const report = {
    measuredAt: new Date().toISOString(),
    browserVersion: browser.version(),
    renderer, viewport, quality: 'medium',
    noCamera, syntheticCamera, delegate: camera,
    dropToAngleMs: { trials: samples.length, median: percentile(samples, .5), p95: percentile(samples, .95) },
    assets: { sceneAndAppBytes: await sizeOf('dist/assets'), cameraRuntimeBytes: await sizeOf('dist/mediapipe'), buildBytes: await sizeOf('dist') },
  };
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/performance-' + (nativeGpu ? 'd3d11' : 'swiftshader') + '.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}

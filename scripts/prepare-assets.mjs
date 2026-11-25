import { createHash } from 'node:crypto';
import { readFile, cp, mkdir } from 'node:fs/promises';

const publicRuntime = new URL('../public/mediapipe/', import.meta.url);
const model = await readFile(new URL('hand_landmarker.task', publicRuntime));
const digest = createHash('sha256').update(model).digest('hex');
if (digest !== 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1') {
  throw new Error('Unexpected Hand Landmarker model checksum');
}
await mkdir(new URL('wasm/', publicRuntime), { recursive: true });
await cp(new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url), new URL('wasm/', publicRuntime), { recursive: true });
await cp(new URL('../node_modules/@mediapipe/tasks-vision/vision_bundle.cjs', import.meta.url), new URL('vision-worker-bundle.js', publicRuntime));
const packages = {
  NotoSansThai: '@fontsource/noto-sans-thai', KaTeX: 'katex', Lucide: 'lucide-react',
  Three: 'three', React: 'react', ReactDOM: 'react-dom',
};
await mkdir(new URL('../public/licenses/npm/', import.meta.url), { recursive: true });
await Promise.all(Object.entries(packages).map(([name, fallback]) => cp(
  new URL('../node_modules/' + fallback + '/LICENSE', import.meta.url),
  new URL('../public/licenses/npm/' + name + '.txt', import.meta.url),
)));

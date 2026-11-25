import { CanvasTexture, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Tile } from '../features/game/session';

const body = new RoundedBoxGeometry(.29, .29, .14, 2, .043);
const border = new RoundedBoxGeometry(.315, .315, .104, 2, .043);
const glyphPlane = new PlaneGeometry(.27,.27);
const frame = new MeshStandardMaterial({ color: '#efc378', metalness: .55, roughness: .31 });
const colorMap = { '+': '#319873', '−': '#b7506b', '×': '#b47638', '÷': '#7453a6' };
const gems = Object.fromEntries(Object.entries(colorMap).map(([symbol, color]) => [symbol, new MeshStandardMaterial({ color, metalness: .22, roughness: .39 })]));
const sapphire = new MeshStandardMaterial({ color: '#3c75a8', metalness: .22, roughness: .39 });
const glyphs = new Map<Tile, MeshBasicMaterial>();

function glyphFor(tile: Tile) {
  const cached = glyphs.get(tile);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 97px Arial';
  ctx.fillStyle = '#fff9e7';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(tile, 64, 69);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const material = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
  glyphs.set(tile, material);
  return material;
}

export function MathTiles({ tiles }: { tiles?: readonly Tile[] }) {
  if (!tiles?.length) return null;
  const visible = tiles.slice(-7);
  return <group position={[0,.22,.55]} name="Math_Tiles">{visible.map((tile, index) =>
    <group key={index} position={[(index - (visible.length - 1) / 2) * .32, 0, 0]} rotation={[-.12,0,0]}>
      <mesh geometry={border} material={frame} dispose={null}/>
      <mesh geometry={body} material={gems[tile] ?? sapphire} scale={.94} dispose={null}/>
      <mesh geometry={glyphPlane} position={[0,0,.072]} material={glyphFor(tile)} dispose={null}/>
    </group>
  )}</group>;
}

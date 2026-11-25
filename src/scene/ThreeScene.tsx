import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ACESFilmicToneMapping, BoxGeometry, BufferGeometry, CanvasTexture, Color, CylinderGeometry,
  Float32BufferAttribute, Group, LatheGeometry, Matrix4, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry,
  OrthographicCamera, PlaneGeometry, Quaternion, RingGeometry, TorusGeometry, Vector2, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BalanceSpring } from '../core/balance/spring-physics';
import type { Tile } from '../features/game/session';
import type { SceneProps } from './types';
import { MathTiles } from './MathTiles';

const gold = new MeshStandardMaterial({ color: '#d5a247', metalness: 0.53, roughness: 0.28 });
const paleGold = new MeshStandardMaterial({ color: '#ffda86', metalness: 0.46, roughness: 0.25 });
const bronze = new MeshStandardMaterial({ color: '#905627', metalness: 0.50, roughness: 0.39 });
const indigo = new MeshStandardMaterial({ color: '#2a2c4b', metalness: 0.37, roughness: 0.42 });
const basalt = new MeshStandardMaterial({ color: '#272d45', metalness: 0.17, roughness: 0.67 });
const stone = new MeshStandardMaterial({ color: '#20283d', roughness: 0.91 });
const grout = new MeshStandardMaterial({ color: '#2e364d', roughness: 0.85 });
const brassRecess = new MeshStandardMaterial({ color: '#514451', metalness: 0.27, roughness: 0.81 });
const wallLight = new MeshStandardMaterial({ color: '#180f28', emissive: '#813d22', emissiveIntensity: 0.93, roughness: 0.7 });
const windowLight = new MeshStandardMaterial({ color: '#1e426a', emissive: '#204569', emissiveIntensity: 0.6, roughness: 0.72 });
const cylinder = new CylinderGeometry(1, 1, 1, 40);
const thinCylinder = new CylinderGeometry(1, 1, 1, 10);
const box = new BoxGeometry();
const gem = new OctahedronGeometry(1);
const ring = new TorusGeometry(1, 0.032, 8, 48);
const floorRing = new RingGeometry(0.987, 1, 80);
const shadowPlane = new PlaneGeometry(1, 1);
let shade: MeshBasicMaterial | undefined;
function pedestalShade() {
  if (shade) return shade;
  const texture = document.createElement('canvas');
  texture.width = texture.height = 128;
  const context = texture.getContext('2d')!;
  const gradient = context.createRadialGradient(64, 64, 12, 64, 64, 64);
  gradient.addColorStop(0, '#070c16c8');
  gradient.addColorStop(.6, '#070c1670');
  gradient.addColorStop(1, '#070c1600');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  shade = new MeshBasicMaterial({ map: new CanvasTexture(texture), transparent: true, depthWrite: false });
  return shade;
}
const bowl = new LatheGeometry([
  [0, -0.16], [0.49, -0.16], [0.77, -0.13], [1.02, -0.06], [1.2, 0.07], [1.24, 0.12],
  [1.22, 0.17], [1.15, 0.18], [1.1, 0.13], [0.94, 0.045], [0.57, -0.035], [0, -0.05],
].map(([x, y]) => new Vector2(x, y)), 48);
const spindle = new LatheGeometry([
  [0, 0], [.75, 0], [.76, .11], [.56, .23], [.43, .36], [.32, .66], [.26, 1.03],
  [.27, 1.75], [.36, 2.04], [.48, 2.28], [.46, 2.49], [0, 2.49],
].map(([x, y]) => new Vector2(x, y)), 48);
const SPAN = 3.63;
const PIVOT = 0.83;

type Triple = [number, number, number];

function ColumnDisc({ at, size, material }: { at: Triple; size: Triple; material: MeshStandardMaterial }) {
  return <mesh position={at} scale={size} geometry={cylinder} material={material} dispose={null} />;
}

function Wire({ start, end, thickness = .028, material = paleGold }: { start: Triple; end: Triple; thickness?: number; material?: MeshStandardMaterial }) {
  const from = new Vector3(...start);
  const to = new Vector3(...end);
  const direction = to.clone().sub(from);
  const quaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize());
  return <mesh position={from.addScaledVector(direction, .5)} quaternion={quaternion} scale={[thickness, direction.length(), thickness]} geometry={thinCylinder} material={material} dispose={null} />;
}

function Suspension({ side, group, tiles }: { side: 'Left' | 'Right'; group: React.RefObject<Group | null>; tiles?: Tile[] }) {
  const position = side === 'Left' ? -SPAN : SPAN;
  return <group name={side + '_Suspension'} position={[position, 0, 0]} ref={group}>
    <mesh name={side + '_Hook'} geometry={ring} material={paleGold} scale={.13} dispose={null} />
    <group name={side + '_Chain'}>
      {Array.from({ length: 3 }, (_, i) => {
        const angle = (i / 3 + .25) * 2 * Math.PI;
        const end: Triple = [Math.cos(angle) * 1.1, -1.49, Math.sin(angle) * 1.1];
        return <group key={i}>
          <Wire start={[0, -.105, 0]} end={end} thickness={.019} material={i === 0 ? bronze : gold}/>
          <mesh position={end} scale={.043} geometry={gem} material={paleGold} dispose={null}/>
        </group>;
      })}
    </group>
    <group name={side + '_Pan'} position={[0, -1.66, 0]}>
      <mesh geometry={bowl} material={gold} dispose={null}/>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .155, 0]} scale={1.19} geometry={ring} material={paleGold} dispose={null}/>
      <ColumnDisc at={[0, .01, 0]} size={[.84, .037, .84]} material={indigo} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .035, 0]} scale={.73} geometry={ring} material={brassRecess} dispose={null}/>
      <mesh position={[0, -.21, 0]} geometry={gem} material={paleGold} scale={[.12, .10, .12]} dispose={null}/>
      <object3D name={side + '_Drop_Surface'} position={[0, .25, .26]} />
      <MathTiles tiles={tiles}/>
    </group>
  </group>;
}

function Scale({ target, reduced, mood, anchors, quality, panTiles, lowerQuality }: SceneProps & { lowerQuality: () => void }) {
  const spring = useRef(new BalanceSpring());
  const beam = useRef<Group>(null);
  const left = useRef<Group>(null);
  const right = useRef<Group>(null);
  const crystal = useRef<Group>(null);
  const marker = useMemo(() => new Vector3(), []);
  const color = useMemo(() => new Color(), []);
  const crystalMaterial = useRef<MeshStandardMaterial>(null);
  const glowMaterial = useRef<MeshStandardMaterial>(null);
  const stats = useRef({ elapsed: 0, frames: 0, slow: 0 });
  const position = useRef({ width: 0, height: 0, angle: NaN, anchors: undefined as SceneProps['anchors'] });
  const colors = { idle: '#65b9ff', uneven: '#f88767', even: '#66efac', waiting: '#eabb68', victory: '#ffe6a2' };

  useFrame(({ camera, size, clock }, delta) => {
    if (!beam.current || !left.current || !right.current) return;
    const cam = camera as OrthographicCamera;
    const width = size.width;
    const height = size.height;
    const resized = width !== position.current.width || height !== position.current.height;
    if (resized) {
      cam.zoom = Math.min(width / (width < 660 ? 10.5 : 14.3), height / 5.75);
      cam.updateProjectionMatrix();
    }
    const angle = spring.current.update(target, delta, reduced);
    const changed = resized || angle !== position.current.angle || anchors !== position.current.anchors;
    if (changed) {
      position.current = { width, height, angle, anchors };
      beam.current.rotation.z = angle;
      left.current.rotation.z = -angle;
      right.current.rotation.z = -angle;
      beam.current.updateWorldMatrix(true, true);
    }
    if (changed && anchors) {
      for (const [side, suspension] of [['left', left.current], ['right', right.current]] as const) {
        const node = anchors[side].current;
        if (!node) continue;
        const surface = suspension.getObjectByName(side === 'left' ? 'Left_Drop_Surface' : 'Right_Drop_Surface');
        if (!surface) continue;
        marker.setFromMatrixPosition(surface.matrixWorld).project(cam);
        node.style.setProperty('--anchor-x', ((1 + marker.x) * width / 2).toFixed(1) + 'px');
        node.style.setProperty('--anchor-y', ((1 - marker.y) * height / 2).toFixed(1) + 'px');
        node.dataset.angle = angle.toFixed(3);
      }
    }
    if (crystal.current) {
      crystal.current.rotation.y = reduced ? .35 : clock.elapsedTime * .43;
      crystal.current.position.y = 1.26 + (reduced ? 0 : Math.sin(clock.elapsedTime * 1.65) * .065);
    }
    color.set(colors[mood]);
    crystalMaterial.current?.color.lerp(color, .12);
    crystalMaterial.current?.emissive.lerp(color, .12);
    glowMaterial.current?.color.lerp(color, .12);
    if (quality === 'auto' && !reduced) {
      const metrics = stats.current;
      metrics.elapsed += Math.min(delta, .1);
      metrics.frames += 1;
      if (metrics.elapsed > 2.6) {
        metrics.slow = metrics.frames / metrics.elapsed < 33 ? metrics.slow + 1 : 0;
        if (metrics.slow >= 2) { lowerQuality(); metrics.slow = 0; }
        metrics.elapsed = 0;
        metrics.frames = 0;
      }
    }
  });

  return <group name="Scale_Root" position={[0, 0, .55]}>
    <group name="Scale_Base">
      <ColumnDisc at={[0,-2.23,0]} size={[1.41,.25,1.17]} material={brassRecess}/>
      <ColumnDisc at={[0,-2.10,0]} size={[1.34,.11,1.11]} material={gold}/>
      <ColumnDisc at={[0,-2.005,0]} size={[1.16,.15,.99]} material={basalt}/>
      <ColumnDisc at={[0,-1.925,0]} size={[1.09,.058,.93]} material={paleGold}/>
      <ColumnDisc at={[0,-1.873,0]} size={[.8,.09,.75]} material={bronze}/>
    </group>
    <mesh name="Scale_Pillar" position={[0,-1.87,0]} geometry={spindle} material={gold} dispose={null}/>
    <group name="Scale_Ornaments">
      {[-1.77,-1.59,-1.35,-.41,.03,.41,.57].map((y, i) => <ColumnDisc key={y} at={[0,y,0]} size={[ [.69,.57,.47,.295,.33,.47,.55][i],.064,[.69,.57,.47,.295,.33,.47,.55][i] ]} material={i % 2 ? bronze : paleGold}/>)}
      {[0, 1, 2, 3, 4, 5, 6, 7].map(i => {
        const a = i * Math.PI / 4;
        return <Wire key={i} start={[Math.sin(a)*.55,-1.62,Math.cos(a)*.55]} end={[Math.sin(a)*.33,-.55,Math.cos(a)*.33]} material={bronze} thickness={.04}/>;
      })}
    </group>
    <group name="Scale_Pivot" position={[0,PIVOT,.18]}>
      <mesh geometry={cylinder} material={gold} rotation={[Math.PI/2,0,0]} scale={[.365,.38,.365]} dispose={null}/>
    </group>
    <group name="Beam_Group" position={[0,PIVOT,0]} ref={beam}>
      <group name="Scale_Beam">
        {[-1, 1].map(sign => <group key={sign} scale={[sign,1,1]}>
          <Wire start={[.24,-.045,0]} end={[1.43,.19,0]} thickness={.16} material={gold}/>
          <Wire start={[1.43,.19,0]} end={[2.61,.22,0]} thickness={.125} material={gold}/>
          <Wire start={[2.61,.22,0]} end={[3.65,.015,0]} thickness={.093} material={gold}/>
          <Wire start={[.23,.03,.113]} end={[1.43,.285,.074]} thickness={.039}/>
          <Wire start={[1.43,.285,.074]} end={[2.61,.30,.061]} thickness={.033}/>
          <Wire start={[2.61,.30,.061]} end={[3.65,.06,.05]} thickness={.027}/>
          <Wire start={[.27,-.12,.047]} end={[1.28,-.15,.05]} thickness={.065} material={bronze}/>
          <Wire start={[1.28,-.15,.05]} end={[2.64,.12,.042]} thickness={.068} material={bronze}/>
          <mesh position={[2.63,.225,.11]} scale={.1} geometry={gem} material={paleGold} dispose={null}/>
          <mesh position={[3.64,.02,.08]} rotation={[0,.2,.3]} scale={.13} geometry={gem} material={paleGold} dispose={null}/>
        </group>)}
      </group>
      <Suspension side="Left" group={left} tiles={panTiles?.left}/><Suspension side="Right" group={right} tiles={panTiles?.right}/>
    </group>
    <group position={[0,PIVOT,.38]}>
      <mesh geometry={cylinder} material={indigo} rotation={[Math.PI/2,0,0]} scale={[.28,.12,.28]} dispose={null}/>
      <mesh geometry={ring} material={paleGold} position={[0,0,.09]} scale={.27} dispose={null}/>
      <mesh geometry={gem} scale={[.112,.112,.09]} position={[0,0,.112]} dispose={null}><meshStandardMaterial ref={glowMaterial} color="#65b9ff" metalness={.25} roughness={.2}/></mesh>
    </group>
    <group name="Magic_Crystal" position={[0,1.26,.27]} ref={crystal}>
      <mesh geometry={gem} scale={[.22,.45,.22]}><meshStandardMaterial ref={crystalMaterial} color="#65b9ff" emissive="#4f96e3" emissiveIntensity={.7} metalness={.19} roughness={.25}/></mesh>
      <mesh geometry={gem} scale={[.29,.54,.28]}><meshBasicMaterial color="#75b6ec" wireframe opacity={.34} transparent/></mesh>
    </group>
  </group>;
}

function buildArchitecture() {
  const parts = new Map<MeshStandardMaterial, BufferGeometry[]>();
  const identity = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const add = (geometry: BufferGeometry, at: Triple, size: Triple, material: MeshStandardMaterial, rotation = identity) => {
    const transforms = new Matrix4().compose(new Vector3(...at), rotation, new Vector3(...size));
    const list = parts.get(material) ?? [];
    // Use the same vertex layout for all shapes that share a material.
    const baked = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    list.push(baked.applyMatrix4(transforms));
    parts.set(material, list);
  };
  add(box, [0,-2.51,-1], [29,.17,14], stone);
  add(box, [0,.32,-5.8], [27,8,.26], stone);
  add(box, [0,-2.08,-5.52], [27,.18,.24], grout);
  add(box, [0,1.65,-5.49], [27,.10,.20], grout);
  for (const x of [-8,-5.45,-2.8,2.8,5.45,8]) {
    add(box, [x,-.27,-5.03], [.42,5,.44], grout);
    add(box, [x,-2.06,-4.98], [.60,.25,.55], basalt);
    add(box, [x,1.68,-4.98], [.60,.21,.56], grout);
    add(box, [x,1.22,-4.71], [.35,.26,.25], brassRecess);
    add(gem, [x,1.49,-4.55], [.105,.22,.105], wallLight);
  }
  for (const x of [-6.72,-4.16,0,4.16,6.72]) {
    const radius = x === 0 ? 1.03 : .68;
    const y = x === 0 ? .66 : .95;
    const z = -5.48;
    const material = x === 0 ? grout : bronze;
    add(box, [x,y-1.37,z-.06], [(radius-.085)*2,2.74,.10], windowLight);
    for (let i = 0; i < 12; i += 1) {
      const a = i * Math.PI / 12;
      const b = (i + 1) * Math.PI / 12;
      const from = new Vector3(x + Math.cos(a) * radius, y + Math.sin(a) * radius * 1.35, z);
      const to = new Vector3(x + Math.cos(b) * radius, y + Math.sin(b) * radius * 1.35, z);
      const delta = to.sub(from);
      const rotation = new Quaternion().setFromUnitVectors(up, delta.clone().normalize());
      add(thinCylinder, from.addScaledVector(delta, .5).toArray(), [.075,delta.length(),.075], material, rotation);
    }
    for (const sign of [-1, 1]) add(box, [x+sign*radius,y-1.42,z], [.13,2.84,.19], material);
    add(box, [x,y-1.19,z+.018], [.025,2.97,.09], grout);
    add(box, [x,y-.57,z+.018], [(radius-.085)*2,.027,.09], grout);
  }
  add(cylinder, [0,-2.46,.03], [5.8,.042,2.55], basalt);
  add(cylinder, [0,-2.425,.035], [5.61,.045,2.45], indigo);
  for (let i = 0; i < 18; i += 1) {
    const angle = i * 2 * Math.PI / 18;
    add(gem, [Math.cos(angle)*5.39,-2.386,Math.sin(angle)*2.36], [.102,.025,.055], bronze, new Quaternion().setFromAxisAngle(up, -angle));
  }
  return Array.from(parts, ([material, geometries]) => {
    const geometry = mergeGeometries(geometries);
    geometries.forEach(part => part.dispose());
    return { geometry, material };
  });
}

const architecture = buildArchitecture();

function Tower({ reduced, detail, mood }: { reduced: boolean; detail: number; mood: SceneProps['mood'] }) {
  const stars = useRef<Group>(null);
  const points = useMemo(() => {
    const positions = Array.from({ length: 96 }, (_, i) => {
      const x = Math.sin(i * 78.23 + 1) * 8;
      const y = Math.abs(Math.sin(i * 39.07)) * 5 - 2.04;
      const z = Math.sin(i * 13.59) * 3 - 2;
      return [x, y, z];
    }).flat();
    const result = new BufferGeometry();
    result.setAttribute('position', new Float32BufferAttribute(positions, 3));
    result.setDrawRange(0, [0, 24, 55, 96][detail]);
    return result;
  }, [detail]);
  useFrame(({ clock }) => {
    if (stars.current) stars.current.position.y = reduced ? 0 : Math.sin(clock.elapsedTime * .48) * .23;
  });
  return <>
    <fog attach="fog" args={['#11192b', 9, 26]}/>
    <ambientLight intensity={1.04} color="#a9caff"/>
    <hemisphereLight args={['#badbff','#542e48',1.65]}/>
    <directionalLight position={[-4,5,6]} color="#fff0c7" intensity={3.35}/>
    <directionalLight position={[4,2,-3]} color="#8ccaff" intensity={2.45}/>
    <pointLight position={[0,3.3,5]} color="#f1a651" intensity={21} distance={17} decay={2}/>
    {architecture.map(({ geometry, material }) => geometry && <mesh key={material.uuid} geometry={geometry} material={material} dispose={null}/>)}
    <mesh geometry={shadowPlane} material={pedestalShade()} position={[.1,-2.38,.55]} rotation={[-Math.PI/2,0,0]} scale={[4.8,3.5,1]} dispose={null}/>
    {[4.95,5.23,5.55].map((r, i) => <mesh key={r} rotation={[-Math.PI/2,0,0]} position={[0,-2.4,.08]} scale={[r,r*.44,1]} geometry={floorRing} dispose={null}>
      <meshBasicMaterial color={mood === 'even' || mood === 'victory' ? '#d9b85e' : i === 1 ? '#5274a1' : '#8b7044'} opacity={i === 1 ? .68 : .53} transparent/>
    </mesh>)}
    <group ref={stars}><points geometry={points}><pointsMaterial color={mood === 'victory' ? '#ffdd74' : '#e7b96b'} size={mood === 'victory' ? .082 : .043} sizeAttenuation transparent opacity={.60} depthWrite={false}/></points></group>
  </>;
}

function ContextMonitor({ onLost }: { onLost: () => void }) {
  useFrame(({ gl }) => { if (gl.getContext().isContextLost()) onLost(); });
  return null;
}

export default function ThreeScene(props: SceneProps) {
  const [auto, setAuto] = useState(2);
  const [lost, setLost] = useState(false);
  if (lost) throw new Error('WebGL context lost');
  const detail = props.quality === 'low' ? 1 : props.quality === 'high' ? 3 : props.quality === 'auto' ? auto : 2;
  const dpr: number | [number, number] = detail === 1 ? .82 : detail === 3 ? [1, 1.75] : [1, 1.25];
  const group: ReactNode = <>
    <Tower reduced={props.reduced} detail={props.reduced ? 0 : detail} mood={props.mood}/>
    <Scale {...props} lowerQuality={() => setAuto(1)}/>
    <ContextMonitor onLost={() => setLost(true)}/>
  </>;
  return <Canvas data-renderer="3d" frameloop={props.reduced ? 'demand' : 'always'} orthographic dpr={dpr} camera={{ position: [0, 1.6, 13], near: .1, far: 55 }}
    gl={{ antialias: detail > 1, alpha: true, powerPreference: 'high-performance', toneMapping: ACESFilmicToneMapping }} aria-hidden="true">
    {group}
  </Canvas>;
}

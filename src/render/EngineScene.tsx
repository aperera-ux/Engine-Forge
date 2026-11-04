import { useEffect, useMemo, useRef, useState, type JSX, type CSSProperties } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, MeshReflectorMaterial, OrbitControls } from '@react-three/drei';
import { createStudioEnvironment } from './studioEnv';
import { Bloom, EffectComposer, SMAA, SSAO, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { EngineConfig } from '../sim/types';
import { buildEngine, type EngineModel } from './build';
import { MaterialLib, lookFor, type ViewMode } from './materials';
import { visualSpeed } from './speed';

export interface EngineSceneProps {
  config: EngineConfig;
  rpm: number;
  running: boolean;
  viewMode: ViewMode;
  /** 0–1 throttle; drives combustion glow and throttle plate. */
  load?: number;
  /** Exhaust gas temperature °C; drives header glow. */
  egtC?: number;
  /** Visual slow-motion factor (shown rev/s = rpm/60·timeScale). Default: auto 0.5–3 rev/s. */
  timeScale?: number;
  onCylinderHover?: (n: number | null) => void;
  /** Called at ~15 Hz with the visual crank angle θ (deg, [0,720)) — same θ as layout.ts localCrankAngle/cyclePhase. */
  onCrankAngle?: (deg: number) => void;
  /** Shift the framed engine by a fraction of the viewport (+x right, +y up). Default { x: 0.06, y: 0.05 }. */
  viewOffset?: { x: number; y: number };
  /** Postprocessing quality. 'low' disables AO/bloom/reflections for slow GPUs. */
  quality?: 'high' | 'low';
  /** Screen-space ambient occlusion (high quality only). Default false (noisy on some GPUs). */
  ao?: boolean;
  /** Called every ~0.5 s with the measured frame rate (diagnostics). */
  onFps?: (fps: number, drawCalls: number, triangles: number) => void;
  className?: string;
  style?: CSSProperties;
}

const BG = '#0b0d11';

/** Only fields that change geometry trigger a rebuild. */
function geometryKey(c: EngineConfig) {
  const { name: _n, fuel: _f, lambda: _l, redlineRpm: _r, idleRpm: _i, directInjection: _d, pistons: _p, crank: _c, ...rest } = c;
  return JSON.stringify(rest);
}

function Engine(props: EngineSceneProps & { onBuilt: (m: EngineModel) => void }) {
  const { config, viewMode } = props;
  const look = lookFor(config);
  const lookKey = `${look.racy}|${look.ironBlock}|${look.titaniumRods}`;
  const lib = useMemo(() => new MaterialLib(look), [lookKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => lib.dispose(), [lib]);
  const gk = geometryKey(config);
  const fuelKey = config.fuel;
  const model = useMemo(() => buildEngine(config, lib, viewMode), [gk, lib, fuelKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => model.dispose(), [model]);
  useEffect(() => model.setViewMode(viewMode), [model, viewMode]);
  useEffect(() => props.onBuilt(model), [model]); // eslint-disable-line react-hooks/exhaustive-deps

  const anim = useRef({ theta: 0, rev: 0 });
  const live = useRef(props);
  live.current = props;
  const fps = useRef({ t: 0, f: 0 });
  const crankT = useRef(1);

  useFrame((state, dtRaw) => {
    const p = live.current;
    const dt = Math.min(dtRaw, 0.1);
    const target = p.running ? visualSpeed(p.rpm, p.timeScale).revPerSec : 0;
    const a = anim.current;
    a.rev += (target - a.rev) * Math.min(1, dt * (p.running ? 3 : 1.6));
    if (!p.running && a.rev < 0.01) a.rev = 0;
    a.theta = (a.theta + a.rev * 360 * dt) % (720 * 1000);
    const load = p.load ?? 0.5;
    const egt = p.running ? (p.egtC ?? 500 + 400 * load) : 0;
    model.update({ theta: a.theta, dt, load, egtC: egt, revPerSec: a.rev, boost: config.induction === 'turbo' ? load : 0 });
    if (p.onCrankAngle) {
      crankT.current += dtRaw;
      if (crankT.current >= 1 / 15) {
        crankT.current = 0;
        p.onCrankAngle(((a.theta % 720) + 720) % 720);
      }
    }
    const calls = state.gl.info.render.calls, tris = state.gl.info.render.triangles;
    state.gl.info.reset();
    if (p.onFps) {
      fps.current.t += dtRaw;
      fps.current.f++;
      if (fps.current.t > 0.5) {
        p.onFps(fps.current.f / fps.current.t, calls, tris);
        fps.current.t = 0;
        fps.current.f = 0;
      }
    }
  });

  const hoverRef = useRef<number | null>(null);
  const setHover = (n: number | null) => {
    if (hoverRef.current === n) return;
    hoverRef.current = n;
    model.setHover(n);
    live.current.onCylinderHover?.(n);
  };

  return (
    <>
      <primitive object={model.root} />
      <primitive
        object={model.hitRoot}
        onPointerMove={(e: { stopPropagation(): void; object: THREE.Object3D }) => {
          e.stopPropagation();
          setHover((e.object.userData.cyl as number) ?? null);
        }}
        onPointerOut={() => setHover(null)}
      />
    </>
  );
}

let _spot: THREE.Texture | null = null;
/** Soft radial light pool under the engine. */
function spotTex() {
  if (_spot) return _spot;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(64,66,72,0.3)');
  grd.addColorStop(0.45, 'rgba(36,38,42,0.12)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  _spot = new THREE.CanvasTexture(c);
  _spot.colorSpace = THREE.SRGBColorSpace;
  return _spot;
}

function ViewOffset({ x, y }: { x: number; y: number }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const w = size.width, h = size.height;
    if (x === 0 && y === 0) cam.clearViewOffset();
    else cam.setViewOffset(w, h, -x * w, y * h, w, h);
    cam.updateProjectionMatrix();
  }, [camera, size.width, size.height, x, y]);
  return null;
}

function Rig({ model, quality, offset }: { model: EngineModel | null; quality: 'high' | 'low'; offset: { x: number; y: number } }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, scene, size } = useThree();
  const fitted = useRef(false);
  const idleTimer = useRef<number | undefined>(undefined);
  const floor = useRef<THREE.Group>(null);
  const sizeRef = useRef(5);

  useEffect(() => {
    if (!model || !controls.current) return;
    const sphere = model.bounds.getBoundingSphere(new THREE.Sphere());
    const cam = camera as THREE.PerspectiveCamera;
    cam.aspect = size.width / Math.max(1, size.height);
    const tv = Math.tan((cam.fov * Math.PI) / 360);
    const th = tv * Math.max(0.2, cam.aspect);
    const fb = model.fitBounds;
    const target = fb.getCenter(new THREE.Vector3());
    const dir0 = fitted.current ? cam.position.clone().sub(controls.current.target).normalize() : new THREE.Vector3(1.0, 0.6, 1.3).normalize();
    const Y = new THREE.Vector3(0, 1, 0);
    /** distance needed so the box projects within tanV / tanW half-angles from direction `dir` */
    const need = (dir: THREE.Vector3, tanV: number, tanW: number) => {
      const fwd = dir.clone().negate();
      const right = new THREE.Vector3().crossVectors(fwd, Y).normalize();
      const upv = new THREE.Vector3().crossVectors(right, fwd);
      let d = 0;
      for (let i = 0; i < 8; i++) {
        const c = new THREE.Vector3(i & 1 ? fb.max.x : fb.min.x, i & 2 ? fb.max.y : fb.min.y, i & 4 ? fb.max.z : fb.min.z).sub(target);
        const depth = c.dot(dir);
        if (tanV > 0) d = Math.max(d, depth + Math.abs(c.dot(upv)) / tanV);
        if (tanW > 0) d = Math.max(d, depth + Math.abs(c.dot(right)) / tanW);
      }
      return d;
    };
    // fill ~60% of the height or ~75% of the width at the current view, whichever binds first
    let dist = Math.max(need(dir0, tv * 0.6, 0), need(dir0, 0, th * 0.75));
    // never clip at any auto-rotate azimuth: 8% margin inside the region left by the view offset
    // (8% margin at the framed view; while auto-rotating only require it to stay inside the frame)
    const fv = Math.max(0.3, 1 - 2 * Math.abs(offset.y)), fh = Math.max(0.3, 1 - 2 * Math.abs(offset.x));
    for (let k = 0; k < 12; k++) {
      // framed view: 8% margin; other azimuths: stay in frame vertically, allow the extreme
      // corners of long/wide engines to graze the side edges while auto-rotating
      const dirK = dir0.clone().applyAxisAngle(Y, (k * Math.PI) / 6);
      dist = Math.max(dist, k === 0 ? need(dirK, tv * fv * 0.92, th * fh * 0.92) : need(dirK, tv * fv, th * fh * 1.15));
    }
    cam.position.copy(target).addScaledVector(dir0, dist);
    controls.current.target.copy(target);
    fitted.current = true;
    cam.near = dist / 50;
    cam.far = dist * 20;
    cam.updateProjectionMatrix();
    controls.current.minDistance = dist * 0.35;
    controls.current.maxDistance = dist * 3;
    controls.current.update();
    sizeRef.current = sphere.radius;
    if (floor.current) floor.current.position.y = model.bounds.min.y - 0.01;
    if (scene.fog) {
      (scene.fog as THREE.Fog).near = dist * 1.1;
      (scene.fog as THREE.Fog).far = dist * 3.2;
    }
  }, [model, camera, scene, size.width, size.height, offset.x, offset.y]);

  const r = sizeRef.current;
  return (
    <>
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        autoRotate
        autoRotateSpeed={0.6}
        maxPolarAngle={Math.PI * 0.52}
        onStart={() => {
          if (controls.current) controls.current.autoRotate = false;
          window.clearTimeout(idleTimer.current);
        }}
        onEnd={() => {
          window.clearTimeout(idleTimer.current);
          idleTimer.current = window.setTimeout(() => {
            if (controls.current) controls.current.autoRotate = true;
          }, 4000);
        }}
      />
      <group ref={floor}>
        <mesh rotation-x={-Math.PI / 2} receiveShadow>
          <circleGeometry args={[400, 64]} />
          {quality === 'high' ? (
            <MeshReflectorMaterial
              blur={[400, 120]}
              resolution={512}
              mixBlur={1}
              mixStrength={0.9}
              roughness={0.85}
              depthScale={1.1}
              minDepthThreshold={0.3}
              maxDepthThreshold={1.3}
              color="#07080b"
              metalness={0.5}
              mirror={0.45}
            />
          ) : (
            <meshStandardMaterial color="#050608" roughness={0.7} metalness={0.3} />
          )}
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={0.002} renderOrder={-1}>
          <circleGeometry args={[Math.max(3, r * 0.95), 64]} />
          <meshBasicMaterial map={spotTex()} transparent depthWrite={false} toneMapped={false} />
        </mesh>
        <ContactShadows key={model ? model.root.uuid : 'none'} position={[0, 0.004, 0]} scale={Math.max(12, r * 4)} blur={2.6} far={Math.max(4, r * 1.6)} opacity={0.85} resolution={512} frames={quality === 'high' ? Infinity : 1} color="#000000" />
      </group>
    </>
  );
}

function StudioEnv() {
  const { gl, scene } = useThree();
  useEffect(() => {
    let tex: THREE.Texture | null = null;
    try {
      tex = createStudioEnvironment(gl);
      scene.environment = tex;
      scene.environmentIntensity = 1.1;
    } catch (e) {
      console.warn('EngineScene: environment generation failed, using lights only', e);
    }
    return () => {
      if (scene.environment === tex) scene.environment = null;
      tex?.dispose();
    };
  }, [gl, scene]);
  return null;
}

function Lights() {
  return (
    <>
      <ambientLight intensity={0.04} />
      {/* warm key (front-right, high) */}
      <directionalLight position={[7, 9, 6]} intensity={2.6} color="#ffe6c8" />
      {/* soft neutral fill (front-left, low) */}
      <directionalLight position={[-7, 2.5, 5]} intensity={0.55} color="#dfe8ff" />
      {/* cool rim from behind to pop the silhouette */}
      <directionalLight position={[-5, 6, -9]} intensity={2.0} color="#9ccbff" />
      <directionalLight position={[6, 3, -8]} intensity={0.9} color="#b8d6ff" />
      <StudioEnv />
    </>
  );
}

function FX({ mode, ao }: { mode: ViewMode; ao: boolean }) {
  return (
    <EffectComposer multisampling={0} enableNormalPass={ao}>
      {/* N8AO 2.0.1 is incompatible with three 0.187 MRT API (texture getter returns array) → postprocessing SSAO */}
      {ao ? <SSAO samples={21} rings={5} radius={0.08} intensity={mode === 'xray' ? 4 : 9} luminanceInfluence={0.5} bias={0.025} worldDistanceThreshold={20} worldDistanceFalloff={5} worldProximityThreshold={0.4} worldProximityFalloff={0.3} /> : <></>}
      <Bloom mipmapBlur luminanceThreshold={3} luminanceSmoothing={0.2} intensity={mode === 'xray' ? 0.4 : 0.6} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.3} darkness={0.65} />
      <SMAA />
    </EffectComposer>
  );
}

function LowFX() {
  return (
    <EffectComposer multisampling={4}>
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}



export function EngineScene(props: EngineSceneProps): JSX.Element {
  const [model, setModel] = useState<EngineModel | null>(null);
  const quality = props.quality ?? 'high';
  return (
    <div className={props.className} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 200, background: BG, ...props.style }}>
      <Canvas
        flat
        dpr={[1, 1.75]}
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
        camera={{ fov: 32, position: [6, 3, 7], near: 0.05, far: 200 }}
        onCreated={({ gl }) => {
          gl.localClippingEnabled = true;
          gl.info.autoReset = false;
        }}
        onPointerMissed={() => props.onCylinderHover?.(null)}
      >
        <color attach="background" args={[BG]} />
        <fog attach="fog" args={[BG, 12, 40]} />
        <Lights />
        <Engine {...props} onBuilt={setModel} />
        <Rig model={model} quality={quality} offset={{ x: props.viewOffset?.x ?? 0.06, y: props.viewOffset?.y ?? 0.05 }} />
        <ViewOffset x={props.viewOffset?.x ?? 0.06} y={props.viewOffset?.y ?? 0.05} />
        {quality === 'high' ? <FX mode={props.viewMode} ao={props.ao ?? false} /> : <LowFX />}
      </Canvas>
    </div>
  );
}

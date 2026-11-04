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
  /** Postprocessing quality. 'low' disables AO/bloom/reflections for slow GPUs. */
  quality?: 'high' | 'low';
  /** Screen-space ambient occlusion (high quality only). Default false (noisy on some GPUs). */
  ao?: boolean;
  /** Called every ~0.5 s with the measured frame rate (diagnostics). */
  onFps?: (fps: number) => void;
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

  useFrame((_, dtRaw) => {
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
    if (p.onFps) {
      fps.current.t += dtRaw;
      fps.current.f++;
      if (fps.current.t > 0.5) {
        p.onFps(fps.current.f / fps.current.t);
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

function Rig({ model, quality }: { model: EngineModel | null; quality: 'high' | 'low' }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, scene } = useThree();
  const fitted = useRef<{ radius: number } | null>(null);
  const idleTimer = useRef<number | undefined>(undefined);
  const floor = useRef<THREE.Group>(null);
  const sizeRef = useRef(5);

  useEffect(() => {
    if (!model || !controls.current) return;
    const sphere = model.bounds.getBoundingSphere(new THREE.Sphere());
    const cam = camera as THREE.PerspectiveCamera;
    const vf = (cam.fov * Math.PI) / 360;
    const hf = Math.atan(Math.tan(vf) * Math.max(0.3, cam.aspect));
    const dist = (sphere.radius / Math.sin(Math.min(vf, hf))) * 0.86;
    const prev = fitted.current;
    const target = sphere.center.clone();
    target.y = sphere.center.y * 0.9;
    if (!prev || Math.abs(prev.radius - sphere.radius) / prev.radius > 0.12) {
      const dir = prev ? cam.position.clone().sub(controls.current.target).normalize() : new THREE.Vector3(1.0, 0.5, 1.15).normalize();
      cam.position.copy(target).addScaledVector(dir, dist);
      controls.current.target.copy(target);
      fitted.current = { radius: sphere.radius };
    } else controls.current.target.lerp(target, 1);
    cam.near = dist / 50;
    cam.far = dist * 20;
    cam.updateProjectionMatrix();
    controls.current.minDistance = sphere.radius * 0.6;
    controls.current.maxDistance = dist * 3;
    controls.current.update();
    sizeRef.current = sphere.radius;
    if (floor.current) floor.current.position.y = model.bounds.min.y - 0.01;
    if (scene.fog) {
      (scene.fog as THREE.Fog).near = dist * 1.1;
      (scene.fog as THREE.Fog).far = dist * 3.2;
    }
  }, [model, camera, scene]);

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
              color="#0d0f13"
              metalness={0.6}
              mirror={0.6}
            />
          ) : (
            <meshStandardMaterial color="#0d0f13" roughness={0.6} metalness={0.4} />
          )}
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
      scene.environmentIntensity = 1.5;
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
      <ambientLight intensity={0.08} />
      <directionalLight position={[6, 10, 5]} intensity={2.2} color="#fff4e8" />
      <directionalLight position={[-8, 4, -6]} intensity={1.0} color="#9cc6ff" />
      <directionalLight position={[-4, 6, 8]} intensity={0.8} color="#ffffff" />
      <StudioEnv />
    </>
  );
}

function FX({ mode, ao }: { mode: ViewMode; ao: boolean }) {
  return (
    <EffectComposer multisampling={0} enableNormalPass={ao}>
      {/* N8AO 2.0.1 is incompatible with three 0.187 MRT API (texture getter returns array) → postprocessing SSAO */}
      {ao ? <SSAO samples={21} rings={5} radius={0.08} intensity={mode === 'xray' ? 4 : 9} luminanceInfluence={0.5} bias={0.025} worldDistanceThreshold={20} worldDistanceFalloff={5} worldProximityThreshold={0.4} worldProximityFalloff={0.3} /> : <></>}
      <Bloom mipmapBlur luminanceThreshold={0.9} luminanceSmoothing={0.2} intensity={mode === 'xray' ? 0.5 : 0.85} />
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
        }}
        onPointerMissed={() => props.onCylinderHover?.(null)}
      >
        <color attach="background" args={[BG]} />
        <fog attach="fog" args={[BG, 12, 40]} />
        <Lights />
        <Engine {...props} onBuilt={setModel} />
        <Rig model={model} quality={quality} />
        {quality === 'high' ? <FX mode={props.viewMode} ao={props.ao ?? false} /> : <LowFX />}
      </Canvas>
    </div>
  );
}

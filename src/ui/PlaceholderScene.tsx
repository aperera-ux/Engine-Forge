/**
 * Temporary stand-in for the render agent's <EngineScene/>. Simple but honest:
 * cylinders placed from computeLayout, pistons driven by slider-crank kinematics.
 */
import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { Group } from 'three';
import { computeLayout, localCrankAngle, pistonDisplacement } from '../sim/layout';
import type { SceneProps } from './sceneTypes';

const S = 0.0055; // mm → scene units

function Engine({ config, rpm, running, viewMode, onCylinderHover }: SceneProps) {
  const lay = useMemo(() => computeLayout(config), [config]);
  const pistons = useRef<(Group | null)[]>([]);
  const theta = useRef(0);
  const r = config.strokeMm / 2;
  const l = config.rodLengthMm;
  const len = (lay.rows - 1) * lay.boreSpacingMm + lay.bankOffsetMm;
  useFrame((_, dt) => {
    if (running) theta.current += rpm * 6 * Math.min(dt, 0.05) * 0.12; // slowed for legibility
    lay.cylinders.forEach((cyl, i) => {
      const g = pistons.current[i];
      if (!g) return;
      const phi = (localCrankAngle(cyl, theta.current) * Math.PI) / 180;
      const x = pistonDisplacement(phi, r, l);
      g.position.y = (l + r - x) * S;
    });
  });
  const wire = viewMode === 'xray';
  const opacity = viewMode === 'solid' ? 1 : viewMode === 'cutaway' ? 0.35 : 0.12;
  return (
    <group position={[0, -0.9, (-len * S) / 2]}>
      {/* crank */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, (len * S) / 2]}>
        <cylinderGeometry args={[0.18, 0.18, len * S + 0.6, 24]} />
        <meshStandardMaterial color="#4a4d55" metalness={0.8} roughness={0.35} />
      </mesh>
      {lay.cylinders.map((cyl, i) => (
        <group key={cyl.number} position={[0, 0, cyl.zMm * S]} rotation={[0, 0, (-cyl.bankAngleDeg * Math.PI) / 180]}>
          <mesh
            position={[0, (l + r + config.strokeMm * 0.5) * S, 0]}
            onPointerOver={(e) => {
              e.stopPropagation();
              onCylinderHover?.(cyl.number);
            }}
            onPointerOut={() => onCylinderHover?.(null)}
          >
            <cylinderGeometry args={[(config.boreMm / 2 + 6) * S, (config.boreMm / 2 + 6) * S, (config.strokeMm * 2.1) * S, 32, 1, true]} />
            <meshStandardMaterial color="#8b8f99" metalness={0.6} roughness={0.45} transparent opacity={opacity} wireframe={wire} depthWrite={viewMode === 'solid'} />
          </mesh>
          <group ref={(g) => { pistons.current[i] = g; }}>
            <mesh>
              <cylinderGeometry args={[(config.boreMm / 2) * S, (config.boreMm / 2) * S, 0.45, 32]} />
              <meshStandardMaterial color="#d7d9de" metalness={0.9} roughness={0.25} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

export default function PlaceholderScene(props: SceneProps) {
  return (
    <Canvas camera={{ position: [6.5, 4.2, 7.5], fov: 30 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={['#0d0e10']} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[5, 8, 4]} intensity={1.6} />
      <directionalLight position={[-6, 2, -4]} intensity={0.6} color="#ff8a3d" />
      <Engine {...props} />
      <gridHelper args={[20, 40, '#26282d', '#17181b']} position={[0, -1.6, 0]} />
      <OrbitControls enablePan={false} minDistance={3} maxDistance={16} />
    </Canvas>
  );
}


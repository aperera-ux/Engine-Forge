/** PBR material library, procedural textures and view-mode variants. */
import * as THREE from 'three';
import type { EngineConfig } from '../sim/types';

export type ViewMode = 'solid' | 'cutaway' | 'xray';

/** Shell parts get clipped (cutaway) or become translucent (xray). */
export const SHELL_KEYS = new Set(['block', 'crankcase', 'head', 'cover', 'timing', 'pan', 'blockDetail']);

// ---------- procedural textures ----------
function hash(x: number, y: number, s: number) {
  const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function valueNoise(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const w = (t: number) => t * t * (3 - 2 * t);
  const p = (a: number) => ((a % period) + period) % period;
  const v00 = hash(p(xi), p(yi), seed), v10 = hash(p(xi + 1), p(yi), seed);
  const v01 = hash(p(xi), p(yi + 1), seed), v11 = hash(p(xi + 1), p(yi + 1), seed);
  const u = w(xf), v = w(yf);
  return v00 * (1 - u) * (1 - v) + v10 * u * (1 - v) + v01 * (1 - u) * v + v11 * u * v;
}

function normalMapFromHeight(size: number, height: (x: number, y: number) => number, strength: number) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = height(x / size, y / size);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
      const d = h[((y - 1 + size) % size) * size + x], u = h[((y + 1) % size) * size + x];
      const nx = (l - r) * strength, ny = (d - u) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

let _cast: THREE.Texture | null = null;
let _crinkle: THREE.Texture | null = null;
let _fins: THREE.Texture | null = null;
let _machined: THREE.Texture | null = null;
function castTex() {
  if (!_cast) {
    const P = 64;
    _cast = normalMapFromHeight(256, (x, y) => {
      let v = 0, a = 1, f = 1;
      for (let o = 0; o < 4; o++) { v += valueNoise(x * P * f / 4, y * P * f / 4, (P * f) / 4, o) * a; a *= 0.5; f *= 2; }
      return v;
    }, 1.6);
  }
  return _cast;
}
function crinkleTex() {
  if (!_crinkle) {
    const P = 24;
    _crinkle = normalMapFromHeight(256, (x, y) => {
      let v = 0, a = 1, f = 1;
      for (let o = 0; o < 3; o++) {
        const n = valueNoise(x * P * f, y * P * f, P * f, o + 7);
        v += (1 - Math.abs(n * 2 - 1)) * a; a *= 0.55; f *= 2.1;
      }
      return v;
    }, 3.2);
  }
  return _crinkle;
}
function finTex() {
  if (!_fins) {
    _fins = normalMapFromHeight(128, (_x, y) => Math.abs(Math.sin(y * Math.PI * 32)), 6);
  }
  return _fins;
}
function machinedTex() {
  if (!_machined) {
    _machined = normalMapFromHeight(256, (x, y) => Math.sin(y * Math.PI * 2 * 90) * 0.3 + valueNoise(x * 8, y * 256, 8, 3) * 0.2, 0.8);
  }
  return _machined;
}

// ---------- shader tweaks ----------
const CUT_COLOR = new THREE.Color('#c23b22');
/** Back faces of clipped shells render as a flat "section" colour. */
function addCutFaces(m: THREE.MeshStandardMaterial) {
  m.side = THREE.DoubleSide;
  m.onBeforeCompile = (s) => {
    s.uniforms.cutColor = { value: CUT_COLOR };
    s.fragmentShader = 'uniform vec3 cutColor;\n' + s.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n if(!gl_FrontFacing){ diffuseColor.rgb = cutColor; }')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n if(!gl_FrontFacing){ totalEmissiveRadiance += cutColor*0.25; }')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n if(!gl_FrontFacing){ roughnessFactor = 0.8; }')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n if(!gl_FrontFacing){ metalnessFactor = 0.0; }');
  };
  m.customProgramCacheKey = () => 'cutface';
}

/** Emissive multiplied by a per-vertex `heat` attribute (headers, turbine). */
export function addHeat(m: THREE.MeshStandardMaterial) {
  m.onBeforeCompile = (s) => {
    s.vertexShader = 'attribute float heat;\nvarying float vHeat;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vHeat = heat;');
    s.fragmentShader = 'varying float vHeat;\n' + s.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= vHeat*vHeat;');
  };
  m.customProgramCacheKey = () => 'heat';
}

function xrayMaterial(color: string, strength = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, strength: { value: strength } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 color; uniform float strength; varying vec3 vN; varying vec3 vV;
      void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); f = pow(f, 2.2);
        gl_FragColor = vec4(color*(0.008 + f*0.6)*strength, 1.0); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export interface Look {
  racy: boolean;
  ironBlock: boolean;
  titaniumRods: boolean;
}

export function lookFor(cfg: EngineConfig): Look {
  const racy = cfg.redlineRpm >= 7500 || cfg.induction !== 'na' || cfg.itb || cfg.fuel === 'race100' || cfg.fuel === 'methanol';
  return { racy, ironBlock: cfg.blockMaterial === 'iron', titaniumRods: cfg.rods === 'titanium' };
}

type Std = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;

export class MaterialLib {
  base: Record<string, Std> = {};
  private variants = new Map<string, THREE.Material>();
  /** Persistent clip planes (world space) updated in place by the builder. */
  planes: Record<string, THREE.Plane> = { '0': new THREE.Plane(), '1': new THREE.Plane(), common: new THREE.Plane() };
  xrayShell = xrayMaterial('#6cb8ff', 1.0);
  constructor(look: Look) {
    const cast = castTex();
    const S = (p: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(p);
    const alu = (c: string, rough = 0.5) =>
      S({ color: c, metalness: 0.72, roughness: rough, normalMap: cast, normalScale: new THREE.Vector2(0.35, 0.35) });
    this.base.block = look.ironBlock
      ? S({ color: '#55585d', metalness: 0.85, roughness: 0.62, normalMap: cast, normalScale: new THREE.Vector2(0.6, 0.6) })
      : alu('#a8adb4', 0.5);
    this.base.blockDetail = this.base.block;
    this.base.crankcase = this.base.block;
    this.base.head = alu('#c9ccd1', 0.42);
    this.base.timing = look.racy ? S({ color: '#2a2c30', metalness: 0.75, roughness: 0.4, normalMap: cast, normalScale: new THREE.Vector2(0.5, 0.5) }) : alu('#9ea3aa', 0.48);
    this.base.coilAccent = S({ color: look.racy ? '#d21d1d' : '#c9a227', metalness: 0.2, roughness: 0.4 });
    this.base.pan = look.racy ? alu('#9da1a7', 0.35) : S({ color: '#26282c', metalness: 0.7, roughness: 0.5 });
    this.base.cover = look.racy
      ? S({ color: '#a3101a', metalness: 0.15, roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.5, normalMap: crinkleTex(), normalScale: new THREE.Vector2(1.1, 1.1) })
      : S({ color: '#141416', metalness: 0.2, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.6, normalMap: crinkleTex(), normalScale: new THREE.Vector2(1.0, 1.0) });
    this.base.coverTrim = S({ color: '#d9dce0', metalness: 1, roughness: 0.18 });
    this.base.crank = S({ color: '#dfe2e6', metalness: 1, roughness: 0.16, normalMap: machinedTex(), normalScale: new THREE.Vector2(0.15, 0.15) });
    this.base.forged = S({ color: '#8d9198', metalness: 1, roughness: 0.42, normalMap: cast, normalScale: new THREE.Vector2(0.3, 0.3) });
    this.base.rod = look.titaniumRods
      ? S({ color: '#9b9488', metalness: 1, roughness: 0.32, iridescence: 0.4, iridescenceIOR: 1.6 })
      : S({ color: '#aeb2b8', metalness: 1, roughness: 0.28 });
    this.base.piston = S({ color: '#d4d6d9', metalness: 1, roughness: 0.3, normalMap: machinedTex(), normalScale: new THREE.Vector2(0.12, 0.12) });
    this.base.valve = S({ color: '#c4c7cc', metalness: 1, roughness: 0.25 });
    this.base.valveEx = S({ color: '#8f8a84', metalness: 1, roughness: 0.38 });
    this.base.spring = S({ color: look.racy ? '#2a5bd7' : '#c9a227', metalness: 0.6, roughness: 0.35 });
    this.base.cam = S({ color: '#cfd2d6', metalness: 1, roughness: 0.14 });
    this.base.steel = S({ color: '#b8bcc2', metalness: 1, roughness: 0.3 });
    this.base.chrome = S({ color: '#f0f2f5', metalness: 1, roughness: 0.06 });
    this.base.blackPlastic = S({ color: '#121314', metalness: 0, roughness: 0.55, clearcoat: 0.2 });
    this.base.rubber = S({ color: '#0d0d0e', metalness: 0, roughness: 0.85 });
    this.base.ceramic = S({ color: '#ece8df', metalness: 0, roughness: 0.3 });
    this.base.intake = look.racy
      ? S({ color: '#17181b', metalness: 0.3, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.12 }) // carbon-ish gloss black
      : alu('#b4b8be', 0.4);
    this.base.runner = look.racy ? S({ color: '#d8dbe0', metalness: 1, roughness: 0.14 }) : alu('#b4b8be', 0.4);
    this.base.chargePipe = S({ color: '#c2c6cc', metalness: 1, roughness: 0.32 });
    this.base.trumpet = S({ color: '#e9ecf0', metalness: 1, roughness: 0.08 });
    this.base.castAlu = alu('#c3c6cb', 0.42);
    this.base.filter = S({ color: look.racy ? '#b31220' : '#2b2d31', metalness: 0, roughness: 0.8, normalMap: finTex(), normalScale: new THREE.Vector2(1.2, 1.2) });
    this.base.icCore = S({ color: '#9ea3aa', metalness: 1, roughness: 0.35, normalMap: finTex(), normalScale: new THREE.Vector2(2, 2) });
    this.base.blower = look.racy ? S({ color: '#e4e7eb', metalness: 1, roughness: 0.1 }) : alu('#bfc3c8', 0.35);
    this.base.belt = S({ color: '#151516', metalness: 0, roughness: 0.75, normalMap: finTex(), normalScale: new THREE.Vector2(0.6, 0.6) });
    this.base.flywheel = S({ color: '#9fa3a9', metalness: 1, roughness: 0.22, normalMap: machinedTex(), normalScale: new THREE.Vector2(0.3, 0.3) });

    this.base.mainCap = this.base.forged;
    this.base.ignitionBoot = S({ color: look.racy ? '#c81e1e' : '#1b1b1d', metalness: 0, roughness: 0.6 });
    const header = S({ color: '#ffffff', vertexColors: true, metalness: 1, roughness: 0.3, emissive: '#ff4a12', emissiveIntensity: 0 });
    addHeat(header);
    this.base.header = header;
    const turbine = S({ color: '#ffffff', vertexColors: true, metalness: 0.9, roughness: 0.55, emissive: '#ff4a12', emissiveIntensity: 0 });
    addHeat(turbine);
    this.base.turbine = turbine;
  }

  /** Material for a static part key under the current view mode; bank -1 = common. */
  get(key: string, bank: number, mode: ViewMode): THREE.Material {
    const base = this.base[key] ?? this.base.steel;
    if (!SHELL_KEYS.has(key) || mode === 'solid') return base;
    if (mode === 'xray') return this.xrayShell;
    const id = `${key}|${bank}`;
    let m = this.variants.get(id);
    if (!m) {
      const c = base.clone() as THREE.MeshStandardMaterial;
      const plane = this.planes[bank < 0 ? 'common' : String(bank)];
      c.clippingPlanes = plane ? [plane] : [];
      c.clipShadows = true;
      addCutFaces(c);
      this.variants.set(id, c);
      m = c;
    }
    return m;
  }

  private hotCut = new Map<string, THREE.MeshStandardMaterial>();
  /** Header/turbine material; clipped by the common plane in cutaway. */
  hot(key: 'header' | 'turbine', mode: ViewMode): THREE.MeshStandardMaterial {
    const base = this.base[key] as THREE.MeshStandardMaterial;
    if (mode !== 'cutaway') return base;
    let m = this.hotCut.get(key);
    if (!m) {
      m = base.clone();
      addHeat(m);
      m.clippingPlanes = [this.planes.common];
      m.side = THREE.DoubleSide;
      this.hotCut.set(key, m);
    }
    m.emissive.copy(base.emissive);
    m.emissiveIntensity = base.emissiveIntensity;
    return m;
  }

  dispose() {
    this.hotCut.forEach((m) => m.dispose());
    Object.values(this.base).forEach((m) => m.dispose());
    this.variants.forEach((m) => m.dispose());
    this.xrayShell.dispose();
  }
}

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

function grayTex(size: number, f: (x: number, y: number) => number) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = Math.max(0, Math.min(255, f(x / size, y / size) * 255));
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
let _castRough: THREE.Texture | null = null;
let _brushRough: THREE.Texture | null = null;
function castRoughTex() {
  return (_castRough ??= grayTex(256, (x, y) => {
    let v = 0, a = 0.5, f = 16;
    for (let o = 0; o < 4; o++) { v += valueNoise(x * f, y * f, f, o + 20) * a; a *= 0.5; f *= 2; }
    return 0.86 + 0.14 * v + (hash(Math.floor(x * 256), Math.floor(y * 256), 3) - 0.5) * 0.1;
  }));
}
function brushRoughTex() {
  return (_brushRough ??= grayTex(256, (x, y) => 0.8 + 0.25 * valueNoise(x * 4, y * 128, 4, 31) + (hash(0, Math.floor(y * 256), 9) - 0.5) * 0.15));
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
    const cr = castRoughTex();
    const br = brushRoughTex();
    const mach = machinedTex();
    const crink = crinkleTex();
    const S = (p: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(p);
    const v2 = (k: number) => new THREE.Vector2(k, k);
    /** sand-cast metal: satin, grainy */
    const castM = (c: string, rough: number, env = 0.85, ns = 0.22) =>
      S({ color: c, metalness: 1, roughness: rough, roughnessMap: cr, normalMap: cast, normalScale: v2(ns), envMapIntensity: env });
    /** machined / brushed metal */
    const machM = (c: string, rough: number, env = 1, aniso = 0.5) =>
      S({ color: c, metalness: 1, roughness: rough, roughnessMap: br, normalMap: mach, normalScale: v2(0.12 + aniso * 0.1), envMapIntensity: env }) // (physical anisotropy produced NaNs → bloom blackout);
    this.base.block = look.ironBlock ? castM('#5d6066', 0.86, 0.7, 0.7) : castM('#b3b8bf', 0.72, 0.85);
    this.base.blockDetail = look.ironBlock ? castM('#4a4d52', 0.6, 0.6) : castM('#8d9299', 0.6, 0.7);
    this.base.crankcase = this.base.block;
    this.base.head = castM('#c2c6cc', 0.66, 0.9);
    this.base.timing = look.racy ? castM('#6b7078', 0.62, 0.85, 0.3) : castM('#a3a8af', 0.66, 0.85);
    this.base.coilAccent = S({ color: look.racy ? '#c81d1d' : '#c9a227', metalness: 0.1, roughness: 0.45 });
    this.base.pan = look.racy ? castM('#9fa4ab', 0.6, 0.8) : S({ color: '#232528', metalness: 0.6, roughness: 0.6, normalMap: crink, normalScale: v2(0.4), envMapIntensity: 0.6 });
    this.base.cover = look.racy
      ? S({ color: '#9a0f18', metalness: 0.1, roughness: 0.62, clearcoat: 0.25, clearcoatRoughness: 0.55, normalMap: crink, normalScale: v2(1.3), envMapIntensity: 0.8 })
      : S({ color: '#161719', metalness: 0.15, roughness: 0.68, clearcoat: 0.2, clearcoatRoughness: 0.6, normalMap: crink, normalScale: v2(1.2), envMapIntensity: 0.8 });
    this.base.coverTrim = machM('#cfd2d6', 0.3, 1, 0.6);
    this.base.crank = machM('#c9ccd1', 0.28, 1, 0.7);
    this.base.forged = castM('#7f838a', 0.62, 0.8, 0.35);
    this.base.rod = look.titaniumRods ? machM('#8f8a80', 0.36, 1, 0.4) : machM('#a3a7ad', 0.38, 0.9, 0.3);
    this.base.piston = machM('#c6c9cd', 0.34, 0.9, 0.4);
    this.base.valve = machM('#b8bcc1', 0.3, 1, 0.3);
    this.base.valveEx = S({ color: '#7d7872', metalness: 1, roughness: 0.48, envMapIntensity: 0.8 });
    this.base.spring = S({ color: look.racy ? '#4d5a52' : '#5a5e58', metalness: 0.85, roughness: 0.42, envMapIntensity: 0.8 });
    this.base.cam = machM('#bfc2c7', 0.26, 1, 0.6);
    this.base.steel = machM('#a3a7ad', 0.42, 0.8, 0);
    this.base.boltSteel = S({ color: '#8e9298', metalness: 1, roughness: 0.4, envMapIntensity: 0.8 });
    this.base.chrome = S({ color: '#e8eaee', metalness: 1, roughness: 0.1, envMapIntensity: 1.1 });
    this.base.blackPlastic = S({ color: '#141516', metalness: 0, roughness: 0.62, normalMap: cast, normalScale: v2(0.2), envMapIntensity: 0.6 });
    this.base.rubber = S({ color: '#0d0d0e', metalness: 0, roughness: 0.85 });
    this.base.ceramic = S({ color: '#e6e2d8', metalness: 0, roughness: 0.35 });
    this.base.intake = look.racy
      ? S({ color: '#1a1b1e', metalness: 0.4, roughness: 0.55, normalMap: crink, normalScale: v2(0.5), clearcoat: 0.3, clearcoatRoughness: 0.4, envMapIntensity: 0.8 })
      : castM('#b9bdc3', 0.62, 0.85);
    this.base.runner = castM(look.racy ? '#b5b9bf' : '#b4b8be', 0.55, 0.9, 0.3);
    this.base.chargePipe = S({ color: '#b8bcc2', metalness: 1, roughness: 0.42, roughnessMap: br, envMapIntensity: 0.85 });
    this.base.trumpet = S({ color: '#e9ecf0', metalness: 1, roughness: 0.12, envMapIntensity: 1.1 });
    this.base.castAlu = castM('#bcc0c6', 0.64, 0.85);
    this.base.filter = S({ color: look.racy ? '#a3121d' : '#2b2d31', metalness: 0, roughness: 0.85, normalMap: finTex(), normalScale: v2(1.2) });
    this.base.icCore = S({ color: '#8d9299', metalness: 1, roughness: 0.5, normalMap: finTex(), normalScale: v2(2), envMapIntensity: 0.7 });
    this.base.blower = look.racy ? machM('#d5d8dc', 0.24, 1, 0.5) : castM('#bfc3c8', 0.55, 0.9);
    this.base.belt = S({ color: '#151516', metalness: 0, roughness: 0.78, normalMap: finTex(), normalScale: v2(0.6) });
    this.base.flywheel = machM('#9a9ea4', 0.36, 0.85, 0.3);

    this.base.mainCap = this.base.forged;
    this.base.brass = S({ color: '#b58a3c', metalness: 1, roughness: 0.45, envMapIntensity: 0.8 });
    this.base.oilFilter = S({ color: look.racy ? '#1b1c1f' : '#1d3f8a', metalness: 0.3, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.3 });
    this.base.ignitionBoot = S({ color: look.racy ? '#c81e1e' : '#1b1b1d', metalness: 0, roughness: 0.6 });
    const header = S({ color: '#ffffff', vertexColors: true, metalness: 1, roughness: 0.38, roughnessMap: br, envMapIntensity: 0.85, emissive: '#ff4a12', emissiveIntensity: 0 });
    addHeat(header);
    this.base.header = header;
    const turbine = S({ color: '#ffffff', vertexColors: true, metalness: 0.9, roughness: 0.7, roughnessMap: cr, normalMap: cast, envMapIntensity: 0.7, emissive: '#ff4a12', emissiveIntensity: 0 });
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

/** Low-level procedural geometry helpers. All dimensions in mm. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type V2 = [number, number];
export const DEG = Math.PI / 180;
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const mod = (a: number, m: number) => ((a % m) + m) % m;

/** Andrew's monotone chain convex hull (CCW). */
export function hull2d(pts: V2[]): V2[] {
  const p = [...pts].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  if (p.length < 3) return p;
  const cross = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: V2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: V2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function circlePts(cx: number, cy: number, r: number, n = 32, a0 = 0, a1 = Math.PI * 2): V2[] {
  const out: V2[] = [];
  const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
  const cnt = full ? n : n + 1;
  for (let i = 0; i < cnt; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

export function shapeOf(outer: V2[], holes: V2[][] = []): THREE.Shape {
  const s = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) s.holes.push(new THREE.Path([...h].reverse().map(([x, y]) => new THREE.Vector2(x, y))));
  return s;
}

/** Rounded rectangle points (CCW) centered at cx,cy. */
export function roundRect(cx: number, cy: number, w: number, h: number, r: number, seg = 5): V2[] {
  r = Math.min(r, w / 2 - 0.01, h / 2 - 0.01);
  const pts: V2[] = [];
  const corners: [number, number, number][] = [
    [cx + w / 2 - r, cy - h / 2 + r, -Math.PI / 2],
    [cx + w / 2 - r, cy + h / 2 - r, 0],
    [cx - w / 2 + r, cy + h / 2 - r, Math.PI / 2],
    [cx - w / 2 + r, cy - h / 2 + r, Math.PI],
  ];
  for (const [x, y, a] of corners) for (let i = 0; i <= seg; i++) {
    const t = a + (i / seg) * (Math.PI / 2);
    pts.push([x + Math.cos(t) * r, y + Math.sin(t) * r]);
  }
  return pts;
}

/** Extrude an XY shape along +Z from z0 to z1, with optional rounded bevel that stays inside the bounds. */
export function extrudeZ(shape: THREE.Shape, z0: number, z1: number, bevel = 0, curveSegments = 12): THREE.BufferGeometry {
  const len = Math.abs(z1 - z0);
  const b = Math.min(bevel, len * 0.45);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, len - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: b > 0 ? 3 : 0,
    curveSegments,
  });
  g.translate(0, 0, Math.min(z0, z1) + b);
  return g;
}

/** Extrude a shape given in (x, z) coordinates along +Y from y0 to y1. */
export function extrudeY(outer: V2[], holes: V2[][], y0: number, y1: number, bevel = 0, curveSegments = 12) {
  const flip = (p: V2[]): V2[] => p.map(([x, z]) => [x, -z] as V2).reverse();
  const shape = shapeOf(flip(outer), holes.map(flip));
  const g = extrudeZ(shape, 0, y1 - y0, bevel, curveSegments);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

/** Lathe around Y from a [radius, y] profile. */
export function lathe(profile: V2[], seg = 32): THREE.BufferGeometry {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.001), y)), seg);
}

/** Cylinder along Z, from z0 to z1. */
export function cylZ(r: number, z0: number, z1: number, seg = 24, x = 0, y = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, Math.abs(z1 - z0), seg, 1);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, (z0 + z1) / 2);
  return g;
}

export function box(w: number, h: number, d: number, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Normalize to non-indexed position/normal/uv so arbitrary geometries can be merged. */
export function norm(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  if (!n.attributes.normal) n.computeVertexNormals();
  if (!n.attributes.uv) {
    const cnt = n.attributes.position.count;
    n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(cnt * 2), 2));
  }
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
  n.morphAttributes = {};
  return n;
}

export function merge(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geoms.length === 0) return new THREE.BufferGeometry();
  const ns = geoms.map(norm);
  const m = mergeGeometries(ns, false);
  ns.forEach((g) => g.dispose());
  return m ?? new THREE.BufferGeometry();
}

/** Collects static geometry per material key and merges into a few meshes. */
export class Batcher {
  private parts = new Map<string, THREE.BufferGeometry[]>();
  add(key: string, g: THREE.BufferGeometry, m?: THREE.Matrix4) {
    if (m) g.applyMatrix4(m);
    let arr = this.parts.get(key);
    if (!arr) this.parts.set(key, (arr = []));
    arr.push(norm(g));
  }
  build(): { key: string; geometry: THREE.BufferGeometry }[] {
    const out: { key: string; geometry: THREE.BufferGeometry }[] = [];
    for (const [key, arr] of this.parts) {
      const m = mergeGeometries(arr, false);
      arr.forEach((g) => g.dispose());
      if (m) {
        m.computeBoundingSphere();
        out.push({ key, geometry: m });
      }
    }
    this.parts.clear();
    return out;
  }
}

/**
 * Indexed tube with variable radius along a curve. Adds `color` (vec3) and
 * `heat` (float) attributes from callbacks of u∈[0,1] (used by hot parts).
 */
export function varTube(
  curve: THREE.Curve<THREE.Vector3>,
  radius: (u: number) => number,
  segs = 48,
  radial = 16,
  color?: (u: number) => [number, number, number],
  heat?: (u: number) => number,
  caps = false,
): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const ht: number[] = [];
  const idx: number[] = [];
  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    curve.getPointAt(u, P);
    const r = radius(u);
    const c = color ? color(u) : [1, 1, 1];
    const h = heat ? heat(u) : 0;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const s = Math.sin(a);
      const cc = -Math.cos(a);
      N.set(0, 0, 0).addScaledVector(frames.normals[i], cc).addScaledVector(frames.binormals[i], s).normalize();
      pos.push(P.x + r * N.x, P.y + r * N.y, P.z + r * N.z);
      nor.push(N.x, N.y, N.z);
      uv.push(u, j / radial);
      col.push(c[0], c[1], c[2]);
      ht.push(h);
    }
  }
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = (i + 1) * (radial + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  if (caps) {
    for (const end of [0, 1]) {
      const i = end === 0 ? 0 : segs;
      curve.getPointAt(end, P);
      const T = frames.tangents[i].clone().multiplyScalar(end === 0 ? -1 : 1);
      const c = color ? color(end) : [1, 1, 1];
      const h = heat ? heat(end) : 0;
      const center = pos.length / 3;
      pos.push(P.x, P.y, P.z);
      nor.push(T.x, T.y, T.z);
      uv.push(0.5, 0.5);
      col.push(c[0], c[1], c[2]);
      ht.push(h);
      const ring0 = pos.length / 3;
      for (let j = 0; j <= radial; j++) {
        const k = i * (radial + 1) + j;
        pos.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
        nor.push(T.x, T.y, T.z);
        uv.push(0, 0);
        col.push(c[0], c[1], c[2]);
        ht.push(h);
      }
      for (let j = 0; j < radial; j++) {
        if (end === 0) idx.push(center, ring0 + j, ring0 + j + 1);
        else idx.push(center, ring0 + j + 1, ring0 + j);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('heat', new THREE.Float32BufferAttribute(ht, 1));
  g.setIndex(idx);
  return g;
}

/** Add constant color/heat attributes to a geometry (for merging with varTube outputs). */
export function withHeat(g: THREE.BufferGeometry, c: [number, number, number], h: number): THREE.BufferGeometry {
  const n = g.index ? g : g;
  const cnt = n.attributes.position.count;
  const col = new Float32Array(cnt * 3);
  const ht = new Float32Array(cnt).fill(h);
  for (let i = 0; i < cnt; i++) col.set(c, i * 3);
  n.setAttribute('color', new THREE.BufferAttribute(col, 3));
  n.setAttribute('heat', new THREE.BufferAttribute(ht, 1));
  if (!n.index) {
    const idx = Array.from({ length: cnt }, (_, i) => i);
    n.setIndex(idx);
  }
  return n;
}

/** Merge hot geometries keeping color/heat (all must be indexed with same attrs). */
export function mergeHot(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ok = geoms.map((g) => {
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'heat'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.index) g.setIndex(Array.from({ length: g.attributes.position.count }, (_, i) => i));
    return g;
  });
  const m = mergeGeometries(ok, false) ?? new THREE.BufferGeometry();
  ok.forEach((g) => g.dispose());
  m.computeBoundingSphere();
  return m;
}

/** Cubic bezier through 4 points as a three curve. */
export function bez(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) {
  return new THREE.CubicBezierCurve3(a, b, c, d);
}

/** Helix (spring) along +Y from 0 to h. */
export class HelixCurve extends THREE.Curve<THREE.Vector3> {
  R: number;
  h: number;
  turns: number;
  constructor(R: number, h: number, turns: number) {
    super();
    this.R = R;
    this.h = h;
    this.turns = turns;
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    const a = t * this.turns * Math.PI * 2;
    return target.set(Math.cos(a) * this.R, t * this.h, Math.sin(a) * this.R);
  }
}

/** Planar spiral volute (around Z axis) for turbo/SC housings. */
export class SpiralCurve extends THREE.Curve<THREE.Vector3> {
  r0: number;
  r1: number;
  sweep: number;
  z: number;
  constructor(r0: number, r1: number, sweep: number, z = 0) {
    super();
    this.r0 = r0;
    this.r1 = r1;
    this.sweep = sweep;
    this.z = z;
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    const a = t * this.sweep;
    const r = this.r0 + (this.r1 - this.r0) * t;
    return target.set(Math.cos(a) * r, Math.sin(a) * r, this.z);
  }
}

/** Gear outline (XY) with n teeth. */
export function gearPts(rRoot: number, rTip: number, n: number): V2[] {
  const pts: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const da = (Math.PI * 2) / n;
    pts.push([Math.cos(a) * rRoot, Math.sin(a) * rRoot]);
    pts.push([Math.cos(a + da * 0.2) * rTip, Math.sin(a + da * 0.2) * rTip]);
    pts.push([Math.cos(a + da * 0.5) * rTip, Math.sin(a + da * 0.5) * rTip]);
    pts.push([Math.cos(a + da * 0.7) * rRoot, Math.sin(a + da * 0.7) * rRoot]);
  }
  return pts;
}

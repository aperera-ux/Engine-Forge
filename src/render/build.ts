/**
 * Procedural engine model built from an EngineConfig. Everything is modelled in
 * millimetres inside `root` (scaled 0.01 → 1 scene unit = 100 mm).
 *
 * Frames: crank axis = Z (front = +Z), Y up. Each bank has a frame rotated
 * -bankAngle about Z so its local +Y is the cylinder axis (layout.ts convention:
 * axis = (sin b, cos b)). A crank pin at angle α from vertical sits at
 * r·(sin α, cos α); the crank group therefore rotates by -θ about Z.
 */
import * as THREE from 'three';
import type { EngineConfig, FuelType } from '../sim/types';
import { computeLayout, cyclePhase, localCrankAngle, pistonDisplacement, rodAngle, type CylinderGeom } from '../sim/layout';
import {
  Batcher, DEG, HelixCurve, SpiralCurve, bez, box, circlePts, clamp, cylZ, extrudeY, extrudeZ, gearPts, hull2d, lathe,
  merge, mergeHot, mod, norm, roundRect, shapeOf, varTube, withHeat, type V2,
} from './geom';
import type { MaterialLib, ViewMode } from './materials';

export const MM = 0.01;

export interface AnimInput {
  theta: number; // crank angle, deg (unbounded)
  dt: number;
  load: number;
  egtC: number;
  revPerSec: number;
  boost: number; // 0..1 visual boost factor for turbo spin
}

export interface EngineModel {
  root: THREE.Group;
  /** Invisible per-cylinder pick volumes (attach pointer handlers here only). */
  hitRoot: THREE.Group;
  bounds: THREE.Box3;
  hitMeshes: THREE.Mesh[];
  update(a: AnimInput): void;
  setViewMode(m: ViewMode): void;
  setHover(n: number | null): void;
  dispose(): void;
}

const FUEL_FLAME: Record<FuelType, string> = {
  gas87: '#ff8a2a', gas91: '#ff9a35', gas93: '#ffa640', race100: '#ff7a1f', e85: '#ffd27a', methanol: '#7fb6ff',
};

/** Valve lift (mm) at cycle phase `cyc` for a cam event peaking at `peak` with advertised duration. */
function liftAt(cyc: number, peak: number, durAdv: number, L: number) {
  const d = mod(cyc - peak + 360, 720) - 360;
  if (Math.abs(d) >= durAdv / 2) return 0;
  const c = Math.cos((Math.PI * d) / durAdv);
  return L * c * c;
}

interface ValveRec {
  cyl: number; // index
  frame: THREE.Matrix4; // root-space, closed position
  peakTheta: number; // crank deg mod 720 of max lift
  dur: number;
  lift: number;
  intake: boolean;
  springBase: number;
  springLen: number;
  idx: number; // instance index within its mesh
  rocker?: { pivot: THREE.Matrix4; arm: THREE.Matrix4; dx: number; ratio: number; idx: number };
  push?: { start: THREE.Vector3; dir: THREE.Vector3; len: number; idx: number };
}

export function buildEngine(cfg: EngineConfig, lib: MaterialLib, initialMode: ViewMode): EngineModel {
  const L = computeLayout(cfg);
  const cyls = L.cylinders;
  const n = cyls.length;
  const isV = cfg.layout === 'v';
  const isFlat = cfg.layout === 'flat';
  const inline = cfg.layout === 'inline';
  const B = cfg.boreMm;
  const r = cfg.strokeMm / 2;
  const l = Math.max(cfg.rodLengthMm, r * 2.3);

  const root = new THREE.Group();
  root.scale.setScalar(MM);
  const batch = new Batcher();
  const disposables: { dispose(): void }[] = [];

  // ---- z mapping (front cylinder at +z) ----
  const zsMm = cyls.map((c) => c.zMm);
  const zMinCyl = Math.min(...zsMm), zMaxCyl = Math.max(...zsMm);
  const zc = (zMinCyl + zMaxCyl) / 2;
  const ZW = (zmm: number) => zc - zmm;

  // ---- banks ----
  const banks: (0 | 1)[] = inline ? [0] : [0, 1];
  const bankAngle = [0, 0];
  for (const c of cyls) bankAngle[c.bank] = c.bankAngleDeg;
  const Mb = [0, 1].map((k) => new THREE.Matrix4().makeRotationZ(-bankAngle[k] * DEG));
  const bankGroups = [0, 1].map((k) => {
    const g = new THREE.Group();
    g.rotation.z = -bankAngle[k] * DEG;
    root.add(g);
    return g;
  });
  const toWorld = (k: number, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(Mb[k]);
  const dirWorld = (k: number, x: number, y: number, z = 0) => new THREE.Vector3(x, y, z).transformDirection(Mb[k]);
  // intake side in bank-local x: valley side for V/flat (bank A +x, bank B -x), -x for inline
  const sI = (k: number) => (inline ? -1 : k === 0 ? 1 : -1);
  const sE = (k: number) => -sI(k);

  // ---- core dimensions ----
  const ch = 0.32 * B;
  const crankPinR = 0.27 * B;
  const mainR = 0.3 * B;
  const wristR = 0.12 * B;
  const deck = r + l + ch + 0.6;
  const rodW = inline ? 0.27 * B : Math.max(L.bankOffsetMm * 0.94, 0.16 * B);
  const webT = 0.13 * B;
  const bigEndR = crankPinR + 0.1 * B;
  const Rcw = r + crankPinR * 0.85;
  const Rswing = Math.max(r + bigEndR + 0.05 * B, Rcw + 0.04 * B);
  const W = 1.32 * B;
  const Wh = 1.36 * B;
  const y0Bank = Rswing * 0.55;

  // ---- crank z layout (mm along crank) ----
  const rows: CylinderGeom[][] = [];
  for (const c of cyls) (rows[c.row] ??= []).push(c);
  rows.forEach((rw) => rw.sort((a, b) => a.zMm - b.zMm));
  const rowStart = rows.map((rw) => rw[0].zMm - rodW / 2 - webT);
  const rowEnd = rows.map((rw) => rw[rw.length - 1].zMm + rodW / 2 + webT);
  const mainLenEnd = 0.3 * B;
  const mains: [number, number][] = [[rowStart[0] - mainLenEnd, rowStart[0]]];
  for (let i = 1; i < rows.length; i++) mains.push([rowEnd[i - 1], rowStart[i]]);
  mains.push([rowEnd[rows.length - 1], rowEnd[rows.length - 1] + mainLenEnd]);
  const blockFrontMm = Math.min(zMinCyl - 0.64 * B, mains[0][0] - 0.02 * B);
  const blockRearMm = Math.max(zMaxCyl + 0.64 * B, mains[mains.length - 1][1] + 0.02 * B);
  const zwF = ZW(blockFrontMm);
  const zwR = ZW(blockRearMm);
  const zwMid = (zwF + zwR) / 2;
  const blockLen = zwF - zwR;

  // ---- valvetrain geometry ----
  const vt = cfg.valvetrain;
  const vpc = clamp(Math.round(cfg.valvesPerCylinder), 2, 5);
  const nIn = vpc === 2 ? 1 : vpc === 3 ? 2 : vpc === 4 ? 2 : 3;
  const nEx = vpc - nIn;
  const tau = (vt === 'dohc' ? 15 : vt === 'sohc' ? 12 : 7) * DEG;
  const chamber = 0.09 * B;
  const seatY = deck + chamber;
  const Ls = vt === 'dohc' ? 1.05 * B : vt === 'sohc' ? 1.1 * B : 1.25 * B;
  const bucketH = 0.12 * B;
  const camBaseR = 0.15 * B;
  const maxD = (cnt: number) => (cnt === 1 ? 0.47 * B : cnt === 2 ? 0.4 * B : 0.29 * B);
  const Di = Math.min(cfg.intakeValveMm, vt === 'pushrod' ? 0.52 * B : maxD(nIn));
  const De = Math.min(cfg.exhaustValveMm, vt === 'pushrod' ? 0.45 * B : maxD(nEx));
  const xo = vt === 'pushrod' ? 0.12 * B : 0.22 * B;
  const tipLocal = (s: number) => [s * (xo + Math.sin(tau) * Ls), seatY + Math.cos(tau) * Ls] as const;
  const cam = cfg.cam;
  const durAdvI = clamp(cam.intakeDurationDeg, 120, 400) / 0.795;
  const durAdvE = clamp(cam.exhaustDurationDeg, 120, 400) / 0.795;
  const icl = cam.intakeCenterlineDeg;
  const ecl = 2 * cam.lobeSeparationDeg - icl;
  const peakI = 360 + icl;
  const peakE = 360 - ecl;
  const maxLift = Math.max(cam.intakeLiftMm, cam.exhaustLiftMm);

  let camY = 0, camX = 0, headTop = 0, coverTop = 0;
  if (vt === 'dohc') {
    const reach = Ls + bucketH + camBaseR;
    camX = xo + Math.sin(tau) * reach;
    camY = seatY + Math.cos(tau) * reach;
    headTop = camY;
    coverTop = camY + camBaseR + maxLift + 0.12 * B;
  } else if (vt === 'sohc') {
    const [, ty] = tipLocal(1);
    camY = ty + 0.22 * B;
    headTop = camY;
    coverTop = camY + camBaseR + maxLift + 0.13 * B;
  } else {
    const [, ty] = tipLocal(1);
    headTop = ty - 0.42 * B;
    coverTop = ty + 0.3 * B;
  }
  const portY = seatY + 0.42 * (headTop - seatY);

  // =====================================================================
  // CRANKSHAFT (rotating group)
  // =====================================================================
  const crankGroup = new THREE.Group();
  root.add(crankGroup);
  {
    const parts: THREE.BufferGeometry[] = [];
    for (const [a, b] of mains) parts.push(cylZ(mainR, ZW(a), ZW(b), 32));
    const web = (pinAngles: number[], z0: number, z1: number) => {
      const pts: V2[] = [...circlePts(0, 0, mainR + 0.07 * B, 24)];
      for (const p of pinAngles) pts.push(...circlePts(r * Math.sin(p * DEG), r * Math.cos(p * DEG), crankPinR + 0.09 * B, 24));
      const p0 = pinAngles[0];
      for (let a = -68; a <= 68; a += 8) {
        const ang = (p0 + 180 + a) * DEG;
        pts.push([Rcw * Math.sin(ang), Rcw * Math.cos(ang)]);
      }
      parts.push(extrudeZ(shapeOf(hull2d(pts)), ZW(z1), ZW(z0), 0.018 * B, 6));
    };
    rows.forEach((rw, i) => {
      const shared = rw.length === 2 && Math.abs(mod(rw[0].pinAngleDeg - rw[1].pinAngleDeg + 180, 360) - 180) < 0.5;
      web([rw[0].pinAngleDeg], rowStart[i], rowStart[i] + webT);
      web([rw[rw.length - 1].pinAngleDeg], rowEnd[i] - webT, rowEnd[i]);
      const pin = (p: number, a: number, b: number) =>
        parts.push(cylZ(crankPinR, ZW(a), ZW(b), 28, r * Math.sin(p * DEG), r * Math.cos(p * DEG)));
      if (rw.length === 1 || shared) pin(rw[0].pinAngleDeg, rowStart[i] + webT * 0.9, rowEnd[i] - webT * 0.9);
      else {
        const mid = (rw[0].zMm + rw[1].zMm) / 2;
        const sw = 0.05 * B;
        pin(rw[0].pinAngleDeg, rowStart[i] + webT * 0.9, mid - sw / 2 + 0.5);
        pin(rw[1].pinAngleDeg, mid + sw / 2 - 0.5, rowEnd[i] - webT * 0.9);
        const pts: V2[] = [];
        for (const c of rw) pts.push(...circlePts(r * Math.sin(c.pinAngleDeg * DEG), r * Math.cos(c.pinAngleDeg * DEG), crankPinR + 0.05 * B, 20));
        parts.push(extrudeZ(shapeOf(hull2d(pts)), ZW(mid + sw / 2), ZW(mid - sw / 2), 0.008 * B, 4));
      }
    });
    // snout + rear flange
    parts.push(cylZ(mainR * 0.72, ZW(mains[0][0]), zwF + 0.52 * B, 28));
    parts.push(cylZ(mainR * 1.3, zwR - 0.08 * B, ZW(mains[mains.length - 1][1]), 32));
    const crankMesh = new THREE.Mesh(merge(parts), lib.base.crank);
    crankMesh.castShadow = true;
    crankGroup.add(crankMesh);
  }
  // damper / pulley
  const coverT = vt === 'pushrod' ? 0.14 * B : 0.24 * B;
  const pulleyR = 0.88 * B;
  const zPulley0 = zwF + coverT + 0.06 * B;
  const pulleyW = 0.3 * B;
  const zBelt = zPulley0 + pulleyW * 0.55;
  {
    const prof: V2[] = [[0.001, 0], [pulleyR * 0.98, 0]];
    const grooves = 6;
    for (let g = 0; g <= grooves * 2; g++) prof.push([pulleyR * (g % 2 === 0 ? 1 : 0.965), (pulleyW * 0.5 * g) / (grooves * 2)]);
    prof.push([pulleyR * 0.98, pulleyW * 0.5], [pulleyR * 0.8, pulleyW * 0.55], [pulleyR * 0.8, pulleyW * 0.8], [pulleyR * 0.92, pulleyW * 0.82], [pulleyR * 0.92, pulleyW], [mainR * 0.9, pulleyW], [mainR * 0.9, pulleyW * 1.15], [0.001, pulleyW * 1.15]);
    const pg = lathe(prof, 64);
    pg.rotateX(Math.PI / 2);
    pg.translate(0, 0, zPulley0);
    const pm = new THREE.Mesh(pg, lib.base.steel);
    crankGroup.add(pm);
    const bolts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      bolts.push(cylZ(0.035 * B, zPulley0 + pulleyW, zPulley0 + pulleyW * 1.12, 6, Math.cos(a) * pulleyR * 0.5, Math.sin(a) * pulleyR * 0.5));
    }
    bolts.push(cylZ(mainR * 0.5, zPulley0 + pulleyW * 1.1, zPulley0 + pulleyW * 1.3, 6));
    crankGroup.add(new THREE.Mesh(merge(bolts), lib.base.chrome));
  }
  // flywheel
  const flyR = Math.max(Rswing + 0.45 * B, 1.45 * B);
  const flyT = 0.2 * B;
  const zFly1 = zwR - 0.1 * B;
  {
    const disk = lathe([[0.001, 0], [flyR * 0.96, 0], [flyR * 0.96, flyT], [flyR * 0.6, flyT], [flyR * 0.55, flyT * 0.75], [mainR * 1.4, flyT * 0.75], [mainR * 1.4, flyT * 1.1], [0.001, flyT * 1.1]], 72);
    disk.rotateX(-Math.PI / 2);
    disk.translate(0, 0, zFly1);
    const fm = new THREE.Mesh(disk, lib.base.flywheel);
    crankGroup.add(fm);
    const ring = extrudeZ(shapeOf(gearPts(flyR * 0.95, flyR, 112), [circlePts(0, 0, flyR * 0.9, 64)]), zFly1 - flyT * 0.75, zFly1, 0, 2);
    const bolts: THREE.BufferGeometry[] = [ring];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      bolts.push(cylZ(0.035 * B, zFly1 - flyT * 1.15, zFly1 - flyT * 0.7, 6, Math.cos(a) * mainR, Math.sin(a) * mainR));
    }
    crankGroup.add(new THREE.Mesh(merge(bolts), lib.base.steel));
  }
  // timing sprocket (visible in xray)
  {
    const g = extrudeZ(shapeOf(gearPts(mainR * 0.95, mainR * 1.08, 22)), zwF + 0.03 * B, zwF + 0.09 * B, 0, 2);
    crankGroup.add(new THREE.Mesh(g, lib.base.steel));
  }

  // =====================================================================
  // BLOCK, CRANKCASE, MAIN CAPS, OIL PAN
  // =====================================================================
  const deckOutline = (w: number, inset = 0) => roundRect(0, zwMid, w, blockLen - 2 * inset, 0.07 * B, 4);
  for (const k of banks) {
    const bankCyls = cyls.filter((c) => c.bank === k);
    const holes = bankCyls.map((c) => circlePts(0, ZW(c.zMm), B / 2, 40));
    batch.add(`block|${k}`, extrudeY(deckOutline(W), holes, y0Bank, deck, 0.012 * B, 6), Mb[k]);
    // head-bolt bosses and side ribs
    for (let i = 0; i <= bankCyls.length; i++) {
      const zb = i === 0 ? ZW(bankCyls[0].zMm) + B * 0.55 : i === bankCyls.length ? ZW(bankCyls[i - 1].zMm) - B * 0.55 : (ZW(bankCyls[i - 1].zMm) + ZW(bankCyls[i].zMm)) / 2;
      for (const s of [-1, 1]) {
        const g = new THREE.CylinderGeometry(0.055 * B, 0.07 * B, deck - y0Bank - 0.1 * B, 12);
        g.translate(s * (W / 2 + 0.01 * B), (deck + y0Bank) / 2 + 0.03 * B, zb);
        batch.add(`block|${k}`, g, Mb[k]);
      }
    }
    for (const c of bankCyls) for (const s of [-1, 1]) {
      const g = new THREE.CylinderGeometry(0.5 * B, 0.5 * B, deck - y0Bank - 0.45 * B, 28, 1);
      g.translate(s * (W / 2 - 0.43 * B), (deck + y0Bank) / 2 - 0.05 * B, ZW(c.zMm));
      batch.add(`block|${k}`, g, Mb[k]);
    }
    for (const s of [-1, 1]) {
      batch.add(`block|${k}`, box(0.04 * B, 0.05 * B, blockLen * 0.96, s * (W / 2 + 0.015 * B), deck - 0.18 * B, zwMid), Mb[k]);
      batch.add(`block|${k}`, box(0.03 * B, 0.04 * B, blockLen * 0.96, s * (W / 2 + 0.01 * B), y0Bank + 0.25 * (deck - y0Bank), zwMid), Mb[k]);
    }
  }
  // crankcase cross-section
  const yRail = isFlat ? -(W / 2) : -0.3 * B;
  const crankCirc = Rswing + 0.08 * B;
  let halfRail = isFlat ? y0Bank + 0.1 * B : Math.max(crankCirc, W / 2 + 0.02 * B);
  {
    const outer: V2[] = [];
    for (const k of banks) for (const sx of [-1, 1]) for (const yy of [y0Bank, y0Bank + 0.3 * B]) {
      const p = toWorld(k, (sx * W) / 2, yy, 0);
      outer.push([p.x, p.y]);
    }
    for (const p of circlePts(0, 0, crankCirc, 40)) if (p[1] >= yRail) outer.push(p);
    if (isV) {
      // keep the rail at least as wide as the lower bank corners
      for (const k of banks) { const p = toWorld(k, sE(k) * W / 2, y0Bank, 0); halfRail = Math.max(halfRail, Math.abs(p.x) * 0.9); }
    }
    outer.push([-halfRail, yRail], [halfRail, yRail]);
    const hOuter = hull2d(outer);
    const inner: V2[] = circlePts(0, 0, Rswing + 0.015 * B, 40).filter((p) => p[1] >= yRail + 0.05 * B);
    inner.push([-(halfRail - 0.06 * B), yRail + 0.05 * B], [halfRail - 0.06 * B, yRail + 0.05 * B]);
    const hInner = hull2d(inner);
    batch.add('crankcase|-1', extrudeZ(shapeOf(hOuter, [hInner]), zwR, zwF, 0.015 * B, 6));
    // end walls
    batch.add('crankcase|-1', extrudeZ(shapeOf(hOuter), zwR, zwR + 0.05 * B, 0.01 * B, 4));
    // main caps
    for (const [a, b] of mains) {
      const len = Math.abs(ZW(a) - ZW(b));
      batch.add('mainCap|-1', box(2 * mainR + 0.4 * B, mainR + 0.22 * B, len * 0.92, 0, -(mainR + 0.22 * B) / 2 - 0.02 * B, (ZW(a) + ZW(b)) / 2));
      for (const s of [-1, 1]) {
        const g = new THREE.CylinderGeometry(0.04 * B, 0.04 * B, 0.12 * B, 8);
        g.translate(s * (mainR + 0.12 * B), -(mainR + 0.28 * B), (ZW(a) + ZW(b)) / 2);
        batch.add('steel|-1', g);
      }
    }
  }
  // oil pan
  const panDepth = isFlat ? 0.55 * B : Rswing + 0.55 * B + yRail;
  const yPan = yRail - Math.max(panDepth, 0.4 * B);
  {
    const hr = halfRail + 0.02 * B;
    const pts: V2[] = [[-hr, yRail], [-hr * 0.97, yRail - (yRail - yPan) * 0.45], [-hr * 0.75, yPan], [hr * 0.75, yPan], [hr * 0.97, yRail - (yRail - yPan) * 0.45], [hr, yRail]];
    batch.add('pan|-1', extrudeZ(shapeOf(pts), zwR + 0.03 * B, zwF - 0.03 * B, 0.05 * B, 6));
    batch.add('pan|-1', box(2 * hr + 0.06 * B, 0.035 * B, blockLen * 0.99, 0, yRail - 0.017 * B, zwMid));
    const plug = cylZ(0.05 * B, zwR + 0.2 * B, zwR + 0.2 * B + 0.06 * B, 6, 0, yPan + 0.15 * B);
    plug.rotateX(0);
    batch.add('chrome|-1', plug);
  }

  // =====================================================================
  // HEADS, COVERS, PLUGS
  // =====================================================================
  for (const k of banks) {
    const bankCyls = cyls.filter((c) => c.bank === k);
    const holes = bankCyls.map((c) => circlePts(0, ZW(c.zMm), B * 0.49, 40));
    batch.add(`head|${k}`, extrudeY(deckOutline(Wh), holes, deck, seatY, 0, 6), Mb[k]);
    batch.add(`head|${k}`, extrudeY(deckOutline(Wh), [], seatY, headTop, 0.02 * B, 6), Mb[k]);
    batch.add(`blockDetail|${k}`, extrudeY(deckOutline(W * 1.01), bankCyls.map((c) => circlePts(0, ZW(c.zMm), B * 0.5, 40)), deck - 0.004 * B, deck + 0.006 * B, 0, 6), Mb[k]); // gasket line
    // port flanges
    for (const c of bankCyls) {
      const zw = ZW(c.zMm);
      batch.add(`head|${k}`, box(0.08 * B, 0.5 * B, 0.8 * B, sI(k) * (Wh / 2 + 0.03 * B), portY, zw), Mb[k]);
      batch.add(`head|${k}`, box(0.08 * B, 0.42 * B, 0.62 * B, sE(k) * (Wh / 2 + 0.03 * B), portY, zw), Mb[k]);
    }
    // covers
    if (vt === 'dohc') {
      for (const s of [-1, 1]) {
        const w = Math.min(0.48 * Wh, (camBaseR + maxLift) * 2 + 0.2 * B);
        const cx = s * Math.min(camX, Wh / 2 - w / 2);
        const g = extrudeY(roundRect(0, zwMid, w, blockLen - 0.04 * B, w * 0.3, 6), [], headTop - 0.02 * B, coverTop, 0.09 * B, 6);
        g.translate(cx, 0, 0);
        batch.add(`cover|${k}`, g, Mb[k]);
      }
      batch.add(`cover|${k}`, extrudeY(roundRect(0, zwMid, Wh * 0.6, blockLen - 0.1 * B, 0.05 * B), [], headTop - 0.02 * B, headTop + 0.1 * B, 0.03 * B, 4), Mb[k]);
    } else {
      batch.add(`cover|${k}`, extrudeY(roundRect(0, zwMid, Wh * 0.94, blockLen - 0.04 * B, 0.2 * B, 6), [], headTop - 0.02 * B, coverTop, 0.1 * B, 6), Mb[k]);
      if (vt === 'pushrod') {
        for (let f = 0; f < 5; f++) {
          const x = (f - 2) * Wh * 0.13;
          batch.add(`coverTrim|${k}`, box(0.03 * B, 0.06 * B, blockLen * 0.75, x, coverTop + 0.01 * B, zwMid), Mb[k]);
        }
      }
    }
    // cover bolts / trim
    for (const z of [zwF - 0.15 * B, zwR + 0.15 * B, zwMid]) {
      const g = new THREE.CylinderGeometry(0.035 * B, 0.035 * B, 0.05 * B, 6);
      g.translate(0, (vt === 'dohc' ? headTop + 0.1 * B : coverTop) + 0.02 * B, z);
      batch.add(`chrome|${k}`, g, Mb[k]);
    }
    // spark plugs and coils
    for (const c of bankCyls) {
      const zw = ZW(c.zMm);
      if (vt !== 'pushrod') {
        const plug = lathe([[0.001, 0], [0.05 * B, 0], [0.05 * B, 0.12 * B], [0.07 * B, 0.13 * B], [0.07 * B, 0.2 * B], [0.04 * B, 0.21 * B], [0.04 * B, 0.45 * B], [0.001, 0.45 * B]], 12);
        plug.translate(0, seatY, zw);
        batch.add('ceramic|-1', plug, Mb[k]);
        const coilBase = vt === 'dohc' ? headTop + 0.1 * B : coverTop;
        const coilTop = (vt === 'dohc' ? coverTop : coverTop) + 0.12 * B;
        batch.add('blackPlastic|-1', box(0.26 * B, coilTop - coilBase - 0.06 * B, 0.3 * B, 0, (coilTop + coilBase) / 2 - 0.03 * B, zw), Mb[k]);
        batch.add('blackPlastic|-1', box(0.3 * B, 0.08 * B, 0.42 * B, 0, coilTop - 0.02 * B, zw), Mb[k]);
        batch.add('coilAccent|-1', box(0.06 * B, 0.07 * B, 0.12 * B, 0, coilTop + 0.035 * B, zw - 0.14 * B), Mb[k]);
        const boot = new THREE.CylinderGeometry(0.07 * B, 0.07 * B, coilBase - seatY - 0.2 * B, 12);
        boot.translate(0, (coilBase + seatY + 0.2 * B) / 2, zw);
        batch.add('blackPlastic|-1', boot, Mb[k]);
        batch.add('coverTrim|-1', box(0.32 * B, 0.015 * B, 0.1 * B, 0, coilTop + 0.025 * B, zw + 0.08 * B), Mb[k]);
      } else {
        const g = new THREE.CylinderGeometry(0.06 * B, 0.06 * B, 0.35 * B, 12);
        g.rotateZ(sE(k) * (70 * DEG));
        g.translate(sE(k) * (Wh / 2 + 0.12 * B), seatY + 0.08 * B, zw + 0.25 * B);
        batch.add('ignitionBoot|-1', g, Mb[k]);
      }
    }
  }

  // timing cover
  {
    for (const k of banks) {
      const pts: V2[] = [...circlePts(0, 0, mainR + 0.35 * B, 24)];
      for (const sx of [-1, 1]) for (const yy of [y0Bank, coverTop - 0.08 * B]) {
        const p = toWorld(k, (sx * Wh) / 2 * 0.98, yy, 0);
        pts.push([p.x, p.y]);
      }
      pts.push([-halfRail * 0.9, yRail], [halfRail * 0.9, yRail]);
      batch.add('timing|-1', extrudeZ(shapeOf(hull2d(pts)), zwF - 0.02 * B, zwF + coverT, 0.05 * B, 8));
    }
    const zf = zwF + coverT;
    for (const k of banks) {
      for (const sx of [-0.28, 0.28]) {
        const g = box(0.06 * B, coverTop - y0Bank - 0.45 * B, 0.05 * B, sx * Wh, (coverTop + y0Bank) / 2 - 0.1 * B, zf);
        batch.add('timing|-1', g, Mb[k]);
      }
      batch.add('timing|-1', box(Wh * 0.7, 0.05 * B, 0.05 * B, 0, deck, zf), Mb[k]);
      if (vt !== 'pushrod') {
        const cxs = vt === 'dohc' ? [-camX, camX] : [0];
        for (const cx of cxs) batch.add('timing|-1', cylZ(camBaseR * 2.5, zf - 0.02 * B, zf + 0.06 * B, 32, cx, camY), Mb[k]);
      }
      for (const [bx, by] of [[-Wh * 0.45, coverTop - 0.15 * B], [Wh * 0.45, coverTop - 0.15 * B], [-Wh * 0.45, y0Bank + 0.2 * B], [Wh * 0.45, y0Bank + 0.2 * B]] as const)
        batch.add('chrome|-1', cylZ(0.035 * B, zf, zf + 0.04 * B, 6, bx, by), Mb[k]);
    }
    // seal boss around snout
    const g = cylZ(mainR * 1.05, zwF + coverT - 0.02 * B, zwF + coverT + 0.05 * B, 32);
    batch.add('castAlu|-1', g);
  }

  // =====================================================================
  // RECIPROCATING: pistons and rods (instanced)
  // =====================================================================
  const pistonGeo = (() => {
    const R = B / 2 - 0.3;
    const cr = cfg.compressionRatio;
    const prof: V2[] = [];
    const skirtBot = -0.42 * B;
    const underside = ch - 0.13 * B;
    prof.push([0.001, underside], [R - 0.06 * B, underside], [R - 0.06 * B, skirtBot + 0.02 * B], [R - 0.02 * B, skirtBot], [R, skirtBot + 0.01 * B]);
    const grooves = [ch - 0.21 * B, ch - 0.15 * B, ch - 0.09 * B];
    const gh = [0.028 * B, 0.014 * B, 0.014 * B];
    const gd = 0.03 * B;
    grooves.forEach((gy, i) => {
      prof.push([R, gy - gh[i] / 2], [R - gd, gy - gh[i] / 2], [R - gd, gy + gh[i] / 2], [R, gy + gh[i] / 2]);
    });
    prof.push([R, ch - 0.012 * B], [R - 0.012 * B, ch]);
    if (cr >= 11.5) {
      const h = clamp((cr - 11) * 0.02 * B, 0.02 * B, 0.12 * B);
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        prof.push([R * 0.86 * (1 - t), ch + h * Math.sin((t * Math.PI) / 2) ** 0.8]);
      }
    } else if (cr < 9.8) {
      const d = clamp((10.2 - cr) * 0.025 * B, 0.015 * B, 0.1 * B);
      prof.push([R * 0.78, ch], [R * 0.7, ch - d], [0.001, ch - d]);
    } else {
      prof.push([R * 0.8, ch], [R * 0.78, ch - 0.01 * B], [0.001, ch - 0.01 * B]);
    }
    const body = lathe(prof, 40);
    const pin = cylZ(wristR, -B * 0.4, B * 0.4, 20);
    // pin bosses
    const boss1 = box(0.16 * B, 0.34 * B, 0.12 * B, 0, 0.0, B * 0.26);
    const boss2 = box(0.16 * B, 0.34 * B, 0.12 * B, 0, 0.0, -B * 0.26);
    return merge([body, pin, boss1, boss2]);
  })();
  const rodGeo = (() => {
    const smallOut = wristR + 0.07 * B;
    const outer = hull2d([...circlePts(0, 0, smallOut, 24), ...circlePts(0, -l, bigEndR, 32)]);
    const slot = hull2d([...circlePts(0, -(smallOut + 0.06 * B), smallOut * 0.35, 12), ...circlePts(0, -l + bigEndR + 0.06 * B, bigEndR * 0.45, 12)]);
    const t = rodW * 0.92;
    const flange = extrudeZ(shapeOf(outer, [slot]), -t / 2, t / 2, 0.012 * B, 4);
    const webG = extrudeZ(shapeOf(slot), -t * 0.17, t * 0.17, 0, 4);
    const parts = [flange, webG];
    for (const s of [-1, 1]) {
      const g = new THREE.CylinderGeometry(0.035 * B, 0.035 * B, 0.42 * B, 8);
      g.translate(s * (crankPinR + 0.06 * B), -l - 0.03 * B, 0);
      parts.push(g);
      const nut = new THREE.CylinderGeometry(0.055 * B, 0.055 * B, 0.06 * B, 6);
      nut.translate(s * (crankPinR + 0.06 * B), -l - bigEndR + 0.02 * B, 0);
      parts.push(nut);
    }
    // cap parting line ring
    parts.push(extrudeZ(shapeOf(roundRect(0, -l, 2 * bigEndR + 0.03 * B, 0.025 * B, 0.005 * B)), -t / 2 - 0.004 * B, t / 2 + 0.004 * B, 0, 2));
    return merge(parts);
  })();
  const pistons = new THREE.InstancedMesh(pistonGeo, lib.base.piston, n);
  const rods = new THREE.InstancedMesh(rodGeo, lib.base.rod, n);
  for (const m of [pistons, rods]) {
    m.frustumCulled = false;
    m.castShadow = true;
    root.add(m);
  }
  const white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < n; i++) pistons.setColorAt(i, white);

  // =====================================================================
  // VALVETRAIN
  // =====================================================================
  const valves: ValveRec[] = [];
  const stemR = (D: number) => 0.055 * D + 1.5;
  const retR = (D: number) => Math.min(0.17 * B, D * 0.42);
  const springLen = 0.36 * B;
  const springTop = vt === 'dohc' ? Ls - 0.09 * B : Ls - 0.07 * B;
  const valveGeo = (D: number) => {
    const sr = stemR(D);
    const parts: THREE.BufferGeometry[] = [lathe([[0.001, 0], [D / 2, 0], [D / 2, 0.035 * D], [D * 0.38, 0.08 * D], [sr * 1.8, 0.24 * D], [sr, 0.4 * D], [sr, Ls], [0.001, Ls]], 28)];
    parts.push(lathe([[sr, springTop - 0.03 * B], [retR(D), springTop], [retR(D), springTop + 0.03 * B], [sr, springTop + 0.035 * B]], 20));
    if (vt === 'dohc') {
      const bR = Math.min(0.17 * B, D * 0.5);
      parts.push(lathe([[0.001, Ls - 0.08 * B], [bR, Ls - 0.08 * B], [bR, Ls + bucketH], [0.001, Ls + bucketH]], 24));
    }
    return merge(parts);
  };
  const springGeo = norm(varTube(new HelixCurve(retR(Math.min(Di, De)) * 0.82, springLen, 6.5), () => 0.028 * B + 0.6, 140, 6));

  // pushrod cam location (root frame)
  let pushCam: THREE.Vector3 | null = null;
  if (vt === 'pushrod') {
    if (isV) pushCam = new THREE.Vector3(0, Math.max(0.5 * deck * Math.cos((cfg.vAngleDeg / 2) * DEG), Rswing + 0.32 * B), 0);
    else if (isFlat) pushCam = new THREE.Vector3(0, -(Rswing + 0.25 * B), 0);
    else {
      const x = sI(0) * (W / 2 - 0.12 * B);
      pushCam = new THREE.Vector3(x, Math.sqrt(Math.max(0, (Rswing + 0.24 * B) ** 2 - x * x)), 0);
    }
  }

  const rocker = { count: 0 };
  const push = { count: 0 };
  const camLobes = new Map<string, { lobes: THREE.BufferGeometry[]; k: number; x: number; y: number; world: boolean }>();
  const addLobe = (camKey: string, k: number, cx: number, cy: number, world: boolean, zw: number, targetAngle: number, peakTheta: number, lobeLift: number, dur: number) => {
    let e = camLobes.get(camKey);
    if (!e) camLobes.set(camKey, (e = { lobes: [], k, x: cx, y: cy, world }));
    const pts: V2[] = [];
    for (let a = -180; a < 180; a += 3) {
      const rr = camBaseR + liftAt(360 + 2 * a, 360, dur, lobeLift);
      pts.push([Math.sin(a * DEG) * rr, Math.cos(a * DEG) * rr]);
    }
    const g = extrudeZ(shapeOf(pts), zw - 0.075 * B, zw + 0.075 * B, 0.006 * B, 2);
    const a0 = targetAngle - peakTheta / 2;
    g.rotateZ(-a0 * DEG);
    e.lobes.push(g);
  };

  for (let ci = 0; ci < n; ci++) {
    const c = cyls[ci];
    const k = c.bank;
    const zw = ZW(c.zMm);
    const specs: { intake: boolean; s: number; dz: number }[] = [];
    if (vt === 'pushrod') {
      const m = vpc;
      // simple alternating intake/exhaust along z
      const list: boolean[] = [];
      let ii = 0, ee = 0;
      for (let j = 0; j < m; j++) {
        if ((j % 2 === 0 && ii < nIn) || ee >= nEx) { list.push(true); ii++; } else { list.push(false); ee++; }
      }
      list.forEach((intake, j) => specs.push({ intake, s: intake ? sI(k) : sE(k), dz: (j - (m - 1) / 2) * ((0.82 * B) / m) }));
    } else {
      const spread = (cnt: number) => (cnt === 1 ? [0] : cnt === 2 ? [-0.22 * B, 0.22 * B] : [-0.27 * B, 0, 0.27 * B]);
      for (const dz of spread(nIn)) specs.push({ intake: true, s: sI(k), dz });
      for (const dz of spread(nEx)) specs.push({ intake: false, s: sE(k), dz });
    }
    for (const sp of specs) {
      const frameLocal = new THREE.Matrix4().makeTranslation(sp.s * xo, seatY, zw + sp.dz).multiply(new THREE.Matrix4().makeRotationZ(-sp.s * tau));
      const frame = Mb[k].clone().multiply(frameLocal);
      const peak = sp.intake ? peakI : peakE;
      const lift = sp.intake ? cam.intakeLiftMm : cam.exhaustLiftMm;
      const dur = sp.intake ? durAdvI : durAdvE;
      const peakTheta = mod(c.firingPhaseDeg + peak, 720);
      const rec: ValveRec = { cyl: ci, frame, peakTheta, dur, lift, intake: sp.intake, springBase: springTop - springLen, springLen, idx: 0 };
      const [tx, ty] = tipLocal(sp.s);
      if (vt === 'dohc') {
        const target = Math.atan2(-sp.s * Math.sin(tau), -Math.cos(tau)) / DEG;
        addLobe(`dohc|${k}|${sp.s}`, k, sp.s * camX, camY, false, zw + sp.dz, target, peakTheta, lift, dur);
      } else if (vt === 'sohc') {
        const contact = new THREE.Vector2(sp.s * 0.1 * B, camY - camBaseR - 0.03 * B);
        const pivot = new THREE.Vector2(sp.s * 0.02 * B + tx * 0.25, camY - camBaseR - 0.09 * B);
        const tip = new THREE.Vector2(tx, ty);
        const target = Math.atan2(contact.x, contact.y - camY) / DEG;
        const ratio = tip.distanceTo(pivot) / Math.max(1, contact.distanceTo(pivot));
        addLobe(`sohc|${k}`, k, 0, camY, false, zw + sp.dz, target, peakTheta, lift / ratio, dur);
        const pivotM = Mb[k].clone().multiply(new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, zw + sp.dz));
        const d = new THREE.Vector2().subVectors(tip, pivot);
        const len = d.length() + 0.08 * B;
        const ang = Math.atan2(d.y, d.x);
        const arm = new THREE.Matrix4().makeRotationZ(ang).multiply(new THREE.Matrix4().makeTranslation(len / 2 - 0.04 * B, 0.03 * B, 0)).multiply(new THREE.Matrix4().makeScale(len, 0.09 * B, 0.1 * B));
        rec.rocker = { pivot: pivotM, arm, dx: tip.x - pivot.x, ratio, idx: rocker.count++ };
      } else if (pushCam) {
        // rocker: pushrod cup on the cam side of the head
        const inv = Mb[k].clone().invert();
        const camLocal = pushCam.clone().applyMatrix4(inv);
        const sp_ = Math.sign(camLocal.x) || 1;
        const cup = new THREE.Vector2(sp_ * 0.42 * B, ty + 0.02 * B);
        const tip = new THREE.Vector2(tx, ty + 0.01 * B);
        const pivot = new THREE.Vector2(cup.x + (tip.x - cup.x) * 0.4, ty + 0.1 * B);
        const ratio = Math.abs(tip.x - pivot.x) / Math.max(1, Math.abs(cup.x - pivot.x));
        const pivotM = Mb[k].clone().multiply(new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, zw + sp.dz));
        const d = new THREE.Vector2().subVectors(tip, cup);
        const len = d.length() + 0.1 * B;
        const ang = Math.atan2(d.y, d.x);
        const mid = new THREE.Vector2().addVectors(cup, tip).multiplyScalar(0.5).sub(pivot);
        const arm = new THREE.Matrix4().makeTranslation(mid.x, mid.y - 0.03 * B, 0).multiply(new THREE.Matrix4().makeRotationZ(ang)).multiply(new THREE.Matrix4().makeScale(len, 0.07 * B, 0.09 * B));
        rec.rocker = { pivot: pivotM, arm, dx: cup.x - pivot.x, ratio, idx: rocker.count++ };
        const cupW = toWorld(k, cup.x, cup.y - 0.03 * B, zw + sp.dz);
        const camAt = new THREE.Vector3(pushCam.x, pushCam.y, zw + sp.dz);
        const dir = new THREE.Vector3().subVectors(cupW, camAt).normalize();
        const start = camAt.clone().addScaledVector(dir, camBaseR);
        const len2 = start.distanceTo(cupW);
        rec.push = { start, dir, len: len2, idx: push.count++ };
        const target = Math.atan2(dir.x, dir.y) / DEG;
        addLobe('push', -1, pushCam.x, pushCam.y, true, zw + sp.dz, target, peakTheta, lift / ratio, dur);
      }
      valves.push(rec);
    }
  }
  const vIn = valves.filter((v) => v.intake);
  const vEx = valves.filter((v) => !v.intake);
  vIn.forEach((v, i) => (v.idx = i));
  vEx.forEach((v, i) => (v.idx = i));
  const valveInMesh = new THREE.InstancedMesh(valveGeo(Di), lib.base.valve, vIn.length);
  const valveExMesh = new THREE.InstancedMesh(valveGeo(De), lib.base.valveEx, vEx.length);
  const springMesh = new THREE.InstancedMesh(springGeo, lib.base.spring, valves.length);
  const rockerMesh = rocker.count ? new THREE.InstancedMesh(norm(new THREE.BoxGeometry(1, 1, 1)), lib.base.forged, rocker.count) : null;
  const pushMesh = push.count ? new THREE.InstancedMesh(norm(new THREE.CylinderGeometry(0.03 * B, 0.03 * B, 1, 8).translate(0, 0.5, 0)), lib.base.chrome, push.count) : null;
  const lifterMesh = push.count ? new THREE.InstancedMesh(norm(new THREE.CylinderGeometry(0.075 * B, 0.075 * B, 0.3 * B, 14).translate(0, 0.15 * B, 0)), lib.base.steel, push.count) : null;
  for (const m of [valveInMesh, valveExMesh, springMesh, rockerMesh, pushMesh, lifterMesh]) if (m) { m.frustumCulled = false; root.add(m); }
  // rocker shafts / pivots (static)
  if (vt !== 'dohc') {
    for (const v of valves) if (v.rocker) {
      const g = new THREE.SphereGeometry(0.06 * B, 10, 8);
      g.applyMatrix4(v.rocker.pivot);
      batch.add('steel|-1', g);
    }
  }

  // camshafts
  const camMeshes: THREE.Mesh[] = [];
  for (const [key, e] of camLobes) {
    const parts = e.lobes;
    const z0 = zwR + 0.12 * B, z1 = zwF + (e.world ? 0.02 * B : coverT * 0.5);
    parts.push(cylZ(camBaseR * 0.62, z0, z1, 16));
    // journals
    const nj = Math.max(2, Math.round(blockLen / (1.3 * B)) + 1);
    for (let j = 0; j < nj; j++) {
      const z = zwR + 0.2 * B + ((blockLen - 0.4 * B) * j) / (nj - 1);
      parts.push(cylZ(camBaseR * 0.95, z - 0.06 * B, z + 0.06 * B, 20));
    }
    // sprocket
    parts.push(extrudeZ(shapeOf(gearPts(camBaseR * 2.0, camBaseR * 2.2, 36)), z1 - 0.06 * B, z1, 0, 2));
    const mesh = new THREE.Mesh(merge(parts), lib.base.cam);
    mesh.position.set(e.x, e.y, 0);
    mesh.userData.camKey = key;
    if (e.world) root.add(mesh);
    else bankGroups[e.k].add(mesh);
    camMeshes.push(mesh);
  }
  // DOHC cam caps on head top
  if (vt === 'dohc') {
    for (const k of banks) for (const s of [-1, 1]) {
      const nj = Math.max(2, Math.round(blockLen / (1.3 * B)) + 1);
      for (let j = 0; j < nj; j++) {
        const z = zwR + 0.2 * B + ((blockLen - 0.4 * B) * j) / (nj - 1);
        batch.add(`head|${k}`, box(camBaseR * 2.6, camBaseR * 1.1, 0.14 * B, s * camX, camY + camBaseR * 0.5, z), Mb[k]);
      }
    }
  }

  // =====================================================================
  // COMBUSTION FLASH + HOVER VOLUMES
  // =====================================================================
  const flameColor = new THREE.Color(FUEL_FLAME[cfg.fuel] ?? '#ffa640');
  const flashGeo = new THREE.CylinderGeometry(B * 0.46, B * 0.46, 1, 28, 1, false).translate(0, -0.5, 0);
  const flashCore = new THREE.SphereGeometry(B * 0.22, 16, 10);
  disposables.push(flashGeo, flashCore);
  const flashes: { mesh: THREE.Mesh; core: THREE.Mesh; mat: THREE.MeshBasicMaterial; coreMat: THREE.MeshBasicMaterial }[] = [];
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const hiMat = new THREE.MeshBasicMaterial({ color: '#39c6ff', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  disposables.push(hitMat, hiMat);
  const hitGeo = new THREE.CylinderGeometry(B * 0.56, B * 0.56, coverTop - y0Bank, 28).translate(0, (coverTop + y0Bank) / 2, 0);
  disposables.push(hitGeo);
  const hitMeshes: THREE.Mesh[] = [];
  const hitRoot = new THREE.Group();
  hitRoot.scale.setScalar(MM);
  const hitBanks = [0, 1].map((k) => {
    const g = new THREE.Group();
    g.rotation.z = -bankAngle[k] * DEG;
    hitRoot.add(g);
    return g;
  });
  for (let i = 0; i < n; i++) {
    const c = cyls[i];
    const mat = new THREE.MeshBasicMaterial({ color: flameColor, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const coreMat = new THREE.MeshBasicMaterial({ color: '#fff3d0', transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    disposables.push(mat, coreMat);
    const mesh = new THREE.Mesh(flashGeo, mat);
    mesh.position.set(0, seatY, ZW(c.zMm));
    mesh.visible = false;
    const core = new THREE.Mesh(flashCore, coreMat);
    core.position.set(0, seatY - chamber * 0.4, ZW(c.zMm));
    core.scale.set(1, 0.45, 1);
    core.visible = false;
    bankGroups[c.bank].add(mesh, core);
    flashes.push({ mesh, core, mat, coreMat });
    const hit = new THREE.Mesh(hitGeo, hitMat);
    hit.position.set(0, 0, ZW(c.zMm));
    hit.userData.cyl = c.number;
    hit.renderOrder = 10;
    hitBanks[c.bank].add(hit);
    hitMeshes.push(hit);
  }
  const lights = [0, 1].map(() => {
    const pl = new THREE.PointLight(flameColor, 0, 3.5 * B * MM * 10, 2);
    root.add(pl);
    return pl;
  });

  // =====================================================================
  // INTAKE
  // =====================================================================
  const rr = 0.21 * B;
  const forced = cfg.induction !== 'na';
  const scType = cfg.induction === 'supercharger' ? cfg.supercharger.type : null;
  const useItb = cfg.itb && !forced;
  const runnerL = clamp(cfg.intakeRunnerMm, 60, 1200);
  const intakePorts = cyls.map((c) => {
    const k = c.bank;
    const p = toWorld(k, sI(k) * (Wh / 2 + 0.07 * B), portY, ZW(c.zMm));
    const d = dirWorld(k, sI(k), 0.25).normalize();
    return { p, d, k, c };
  });
  const up = new THREE.Vector3(0, 1, 0);
  let plenum = { x: 0, y: 0, w: 0, h: 0, z0: zwR + 0.1 * B, z1: zwF - 0.1 * B };
  let throttleAt: { p: THREE.Vector3; dir: THREE.Vector3 } | null = null;
  const throttleR = cfg.throttleMm / 2;
  const tubeGeos = (key: string, g: THREE.BufferGeometry) => batch.add(key, g);
  let topOfIntake = coverTop;
  if (useItb) {
    for (const ip of intakePorts) {
      const endDir = (inline ? ip.d.clone().multiplyScalar(0.9).add(up) : up.clone().addScaledVector(ip.d, 0.5)).normalize();
      const mk = (s: number) => bez(ip.p, ip.p.clone().addScaledVector(ip.d, 0.28 * s), ip.p.clone().addScaledVector(ip.d, 0.3 * s).addScaledVector(endDir, 0.35 * s), ip.p.clone().addScaledVector(ip.d, 0.3 * s).addScaledVector(endDir, 0.72 * s));
      const len0 = mk(runnerL).getLength();
      const sc = runnerL * (runnerL / len0) * 0.82;
      const curve = mk(sc);
      tubeGeos('runner|-1', varTube(curve, () => rr, 32, 20));
      const end = curve.getPointAt(1);
      const tan = curve.getTangentAt(1);
      // throttle section
      const tb = curve.getPointAt(0.62);
      const tbT = curve.getTangentAt(0.62);
      const tbG = new THREE.CylinderGeometry(rr * 1.25, rr * 1.25, 0.32 * B, 20);
      tbG.applyMatrix4(new THREE.Matrix4().compose(tb, new THREE.Quaternion().setFromUnitVectors(up, tbT), new THREE.Vector3(1, 1, 1)));
      batch.add('castAlu|-1', tbG);
      const tl = 0.18 * runnerL + 0.2 * B;
      const bell = lathe([[rr * 1.02, 0], [rr * 1.05, tl * 0.5], [rr * 1.35, tl * 0.85], [rr * 1.85, tl], [rr * 1.95, tl * 1.02], [rr * 1.7, tl * 0.97], [rr * 1.2, tl * 0.8], [rr * 0.95, tl * 0.4], [rr * 0.95, 0]], 32);
      bell.applyMatrix4(new THREE.Matrix4().compose(end, new THREE.Quaternion().setFromUnitVectors(up, tan), new THREE.Vector3(1, 1, 1)));
      batch.add('trumpet|-1', bell);
      topOfIntake = Math.max(topOfIntake, end.y + tl);
    }
    // linkage bars per bank
    for (const k of banks) {
      const ps = intakePorts.filter((ip) => ip.k === k);
      const a = ps[0], b = ps[ps.length - 1];
      const off = (ip: (typeof ps)[number]) => ip.p.clone().addScaledVector(ip.d, 0.5 * runnerL * 0.6).addScaledVector(up, 0.2 * runnerL);
      const g = varTube(new THREE.LineCurve3(off(a).add(new THREE.Vector3(0, 0, 0.3 * B)), off(b).add(new THREE.Vector3(0, 0, -0.3 * B))), () => 0.03 * B, 2, 8);
      batch.add('chrome|-1', g);
    }
  } else {
    const centered = !inline;
    const pw = centered ? 1.15 * B : 0.8 * B;
    const ph = centered ? 0.75 * B : 1.15 * B;
    const median = intakePorts[Math.floor(intakePorts.length / 2)];
    const makeRunner = (ip: (typeof intakePorts)[number], px: number, py: number, k1 = runnerL * 0.32) => {
      let pe: THREE.Vector3, endDir: THREE.Vector3;
      if (centered) {
        pe = new THREE.Vector3(Math.sign(ip.p.x || 1) * pw * 0.22, py - ph * 0.35, ip.p.z);
        endDir = up;
      } else {
        pe = new THREE.Vector3(px - sI(0) * pw * 0.3, py, ip.p.z);
        endDir = new THREE.Vector3(sI(0), 0, 0);
      }
      return bez(ip.p, ip.p.clone().addScaledVector(ip.d, k1), pe.clone().addScaledVector(endDir, -k1), pe);
    };
    let lo = 0, hi = runnerL * 1.4;
    for (let it = 0; it < 30; it++) {
      const m = (lo + hi) / 2;
      const len = centered ? makeRunner(median, 0, median.p.y + m).getLength() : makeRunner(median, median.p.x + sI(0) * m, median.p.y + 0.85 * B).getLength();
      if (len < runnerL) lo = m;
      else hi = m;
    }
    const off = (lo + hi) / 2;
    const minAbove = isV ? Math.max(0, coverTop * 0.5) : 0;
    // keep the plenum compact; long runners arch outward instead (length stays = intakeRunnerMm)
    let coverTopW = -Infinity;
    for (const k of banks) for (const sx of [-1, 1]) coverTopW = Math.max(coverTopW, toWorld(k, (sx * Wh) / 2, coverTop, 0).y);
    const capY = coverTopW + ph * 0.5 + 0.25 * B;
    if (centered) plenum = { ...plenum, x: 0, y: clamp(median.p.y + off, minAbove, Math.max(minAbove, capY)), w: pw, h: ph };
    else plenum = { ...plenum, x: median.p.x + sI(0) * clamp(off, 0.6 * B, 1.5 * B), y: median.p.y + 0.85 * B, w: pw, h: ph };
    for (const ip of intakePorts) {
      let a = 0.05 * runnerL, b = 2.5 * runnerL;
      for (let it = 0; it < 26; it++) {
        const m = (a + b) / 2;
        if (makeRunner(ip, plenum.x, plenum.y, m).getLength() < runnerL) a = m;
        else b = m;
      }
      tubeGeos('runner|-1', varTube(makeRunner(ip, plenum.x, plenum.y, (a + b) / 2), (u) => rr * (1 + 0.15 * u), 40, 18));
    }
    const pg = extrudeZ(shapeOf(roundRect(plenum.x, plenum.y, pw, ph, Math.min(pw, ph) * 0.42, 6)), plenum.z0, plenum.z1, 0.14 * B, 8);
    batch.add('intake|-1', pg);
    topOfIntake = Math.max(topOfIntake, plenum.y + ph / 2);
    // plenum detail ribs
    for (let i = 1; i < 4; i++) {
      const z = plenum.z0 + ((plenum.z1 - plenum.z0) * i) / 4;
      batch.add('intake|-1', extrudeZ(shapeOf(roundRect(plenum.x, plenum.y, pw * 1.03, ph * 1.03, Math.min(pw, ph) * 0.44, 6)), z - 0.02 * B, z + 0.02 * B, 0, 6));
    }
    if (!(scType === 'roots' || scType === 'twin-screw')) {
      throttleAt = { p: new THREE.Vector3(plenum.x, plenum.y, plenum.z1), dir: new THREE.Vector3(0, 0, 1) };
    }
  }

  // throttle body (moving butterfly)
  let throttlePlate: THREE.Mesh | null = null;
  const addThrottle = (p: THREE.Vector3, dir: THREE.Vector3, withFilter: boolean) => {
    const len = Math.max(0.6 * throttleR * 2, 0.5 * B);
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    const M = new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
    const body = lathe([[throttleR + 0.06 * B, 0], [throttleR + 0.1 * B, 0.02 * B], [throttleR + 0.1 * B, 0.08 * B], [throttleR + 0.05 * B, 0.1 * B], [throttleR + 0.05 * B, len - 0.1 * B], [throttleR + 0.1 * B, len - 0.08 * B], [throttleR + 0.1 * B, len], [throttleR, len], [throttleR, 0]], 36);
    body.applyMatrix4(M);
    batch.add('castAlu|-1', body);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(throttleR * 0.98, throttleR * 0.98, 0.012 * B, 32), lib.base.steel);
    const holder = new THREE.Group();
    holder.position.copy(p).addScaledVector(dir, len / 2);
    holder.quaternion.copy(q);
    holder.add(plate);
    root.add(holder);
    throttlePlate = plate;
    const servo = box(0.35 * B, 0.3 * B, 0.3 * B, throttleR + 0.25 * B, len / 2, 0);
    servo.applyMatrix4(M);
    batch.add('blackPlastic|-1', servo);
    if (withFilter) {
      const fl = 1.1 * throttleR * 2 + 0.3 * B;
      const f = lathe([[throttleR + 0.08 * B, 0], [throttleR + 0.08 * B, 0.12 * B], [throttleR * 1.7, 0.16 * B], [throttleR * 1.5, fl], [0.001, fl]], 40);
      f.applyMatrix4(new THREE.Matrix4().compose(p.clone().addScaledVector(dir, len), q, new THREE.Vector3(1, 1, 1)));
      batch.add('filter|-1', f);
      const capG = lathe([[0.001, fl], [throttleR * 1.52, fl], [throttleR * 1.52, fl + 0.04 * B], [0.001, fl + 0.05 * B]], 40);
      capG.applyMatrix4(new THREE.Matrix4().compose(p.clone().addScaledVector(dir, len), q, new THREE.Vector3(1, 1, 1)));
      batch.add('chrome|-1', capG);
    }
    return p.clone().addScaledVector(dir, len);
  };

  // =====================================================================
  // EXHAUST
  // =====================================================================
  const rp = cfg.headerDiameterMm / 2 + 1.2;
  const hotGeos: THREE.BufferGeometry[] = [];
  const turbineGeos: THREE.BufferGeometry[] = [];
  const tint = (u: number): [number, number, number] => {
    const stops: [number, [number, number, number]][] = [[0, [0.5, 0.42, 0.36]], [0.08, [0.4, 0.4, 0.56]], [0.2, [0.62, 0.55, 0.62]], [0.32, [0.8, 0.68, 0.48]], [0.5, [0.8, 0.79, 0.76]], [1, [0.8, 0.81, 0.83]]];
    for (let i = 1; i < stops.length; i++) if (u <= stops[i][0]) {
      const [u0, c0] = stops[i - 1];
      const [u1, c1] = stops[i];
      const t = (u - u0) / (u1 - u0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
    return stops[stops.length - 1][1];
  };
  const IRON: [number, number, number] = [0.2, 0.19, 0.185];
  const collectorEnds: { k: number; p: THREE.Vector3; ob: THREE.Vector3 }[] = [];
  const exPorts = cyls.map((c) => {
    const k = c.bank;
    return {
      c, k,
      p: toWorld(k, sE(k) * (Wh / 2 + 0.07 * B), portY, ZW(c.zMm)),
      d: dirWorld(k, sE(k), -0.12).normalize(),
    };
  });
  const turbo = cfg.induction === 'turbo';
  for (const k of banks) {
    const ports = exPorts.filter((e) => e.k === k);
    const ob = dirWorld(k, sE(k), 0).normalize();
    const Q = ports.reduce((a, e) => a.add(e.p), new THREE.Vector3()).multiplyScalar(1 / ports.length);
    const zFront = Math.max(...ports.map((e) => e.p.z));
    const zRear = Math.min(...ports.map((e) => e.p.z));
    const down = new THREE.Vector3(0, -1, 0);
    if (cfg.exhaust === 'log') {
      const logR = rp * 1.35;
      const base = Q.clone().addScaledVector(ob, 0.5 * B).addScaledVector(down, 0.08 * B);
      const a = new THREE.Vector3(base.x, base.y, zFront + 0.25 * B);
      const b = new THREE.Vector3(base.x, base.y, zRear - 0.45 * B);
      hotGeos.push(varTube(new THREE.LineCurve3(a, b), () => logR, 8, 20, () => IRON, () => 0.6, true));
      for (const e of ports) {
        const tgt = new THREE.Vector3(base.x, base.y, e.p.z);
        hotGeos.push(varTube(new THREE.LineCurve3(e.p, tgt), () => rp * 1.05, 4, 16, () => IRON, () => 0.8));
        hotGeos.push(withHeat(box(0.06 * B, rp * 3, rp * 3.2, 0, 0, 0).applyMatrix4(new THREE.Matrix4().compose(e.p, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), e.d), new THREE.Vector3(1, 1, 1))), IRON, 1));
      }
      const outEnd = b.clone().addScaledVector(ob, 0.3 * B).addScaledVector(down, turbo ? 0.1 * B : 0.9 * B);
      collectorEnds.push({ k, p: outEnd, ob });
      if (!turbo) hotGeos.push(varTube(bez(b, b.clone().add(new THREE.Vector3(0, 0, -0.3 * B)), outEnd.clone().addScaledVector(up, 0.3 * B), outEnd), () => logR, 16, 18, () => IRON, (u) => 0.8 - 0.3 * u));
      continue;
    }
    const Lp = cfg.exhaust === 'shorty' ? Math.min(cfg.headerPrimaryMm, 360) : clamp(cfg.headerPrimaryMm, 150, 1400);
    const zC = cfg.exhaust === 'shorty' || turbo ? (zFront + zRear) / 2 - 0.4 * B : zRear - 0.4 * B;
    const outDist = cfg.exhaust === 'shorty' ? 0.55 * B : 0.8 * B;
    const ringR = rp * 1.25;
    const mkC = (drop: number, back = 0) => new THREE.Vector3(Q.x, Q.y, zC - back).addScaledVector(ob, outDist).addScaledVector(down, drop);
    const mkPath = (e: (typeof ports)[number], C: THREE.Vector3, kOut: number, idx: number) => {
      const a = (idx / ports.length) * Math.PI * 2;
      const end = C.clone().add(new THREE.Vector3(Math.cos(a) * ringR, Math.sin(a) * ringR, 0));
      return bez(e.p, e.p.clone().addScaledVector(e.d, kOut), end.clone().add(new THREE.Vector3(0, 0, Math.max(0.6 * B, Lp * 0.18))), end);
    };
    const med = ports[Math.floor((ports.length - 1) / 2)];
    // drop toward the pan rail first, then run the collector rearward for longer primaries
    const maxDrop = isFlat ? 0.5 * B : Math.max(0.3 * B, Q.y - yPan - 0.1 * B);
    let lo = 0, hi = maxDrop;
    for (let it = 0; it < 28; it++) {
      const m = (lo + hi) / 2;
      if (mkPath(med, mkC(m), 0.7 * B, 0).getLength() < Lp) lo = m;
      else hi = m;
    }
    let drop = (lo + hi) / 2, back = 0;
    if (mkPath(med, mkC(maxDrop), 0.7 * B, 0).getLength() < Lp) {
      drop = maxDrop;
      lo = 0; hi = Lp * 2;
      for (let it = 0; it < 28; it++) {
        const m = (lo + hi) / 2;
        if (mkPath(med, mkC(drop, m), 0.7 * B, 0).getLength() < Lp) lo = m;
        else hi = m;
      }
      back = (lo + hi) / 2;
    }
    const C = mkC(drop, back);
    ports.forEach((e, idx) => {
      let kOut = 0.7 * B;
      if (cfg.exhaust === 'tuned-equal') {
        let a = 0.1 * B, b = 6 * B;
        for (let it = 0; it < 26; it++) {
          const m = (a + b) / 2;
          if (mkPath(e, C, m, idx).getLength() < Lp) a = m;
          else b = m;
        }
        kOut = (a + b) / 2;
      }
      const curve = mkPath(e, C, kOut, idx);
      hotGeos.push(varTube(curve, () => rp, 64, 16, tint, (u) => Math.exp(-u * 2.6)));
      // flange
      hotGeos.push(withHeat(box(0.06 * B, rp * 2.9, rp * 3.1).applyMatrix4(new THREE.Matrix4().compose(e.p, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), e.d), new THREE.Vector3(1, 1, 1))), [0.62, 0.62, 0.64], 0.35));
    });
    // collector cone
    const collLen = 1.1 * B;
    const cr0 = ringR + rp * 1.05, cr1 = rp * 1.65;
    const cEnd = C.clone().add(new THREE.Vector3(0, 0, -collLen));
    hotGeos.push(varTube(new THREE.LineCurve3(C.clone().add(new THREE.Vector3(0, 0, 0.05 * B)), cEnd), (u) => cr0 + (cr1 - cr0) * u, 10, 24, () => tint(0.55), () => 0.45));
    collectorEnds.push({ k, p: cEnd, ob });
    if (!turbo) {
      const tail = cEnd.clone().add(new THREE.Vector3(0, -0.4 * B, -2.2 * B));
      hotGeos.push(varTube(bez(cEnd, cEnd.clone().add(new THREE.Vector3(0, 0, -0.8 * B)), tail.clone().add(new THREE.Vector3(0, 0.2 * B, 0.6 * B)), tail), () => cr1, 24, 20, () => tint(0.85), () => 0.25));
    }
  }

  // =====================================================================
  // FORCED INDUCTION
  // =====================================================================
  const spinners: { obj: THREE.Object3D; rate: number; kind: 'turbo' | 'crank' }[] = [];
  const icEff = forced ? (turbo ? cfg.turbo.intercoolerEffectiveness : cfg.supercharger.intercoolerEffectiveness) : 0;
  const engineHalfW = Math.max(...exPorts.map((e) => Math.abs(e.p.x))) + 0.6 * B;
  const icW = Math.max(engineHalfW * 1.5, 3 * B);
  const icH = 0.85 * B;
  const yIC = yPan + icH / 2 + 0.05 * B;
  const zIC = zPulley0 + pulleyW + 0.9 * B;
  const chargeR = clamp(throttleR * 0.8, 0.2 * B, 0.3 * B);
  const icPorts = icEff > 0 ? {
    a: new THREE.Vector3(-icW / 2 - 0.25 * B, yIC + icH * 0.25, zIC),
    b: new THREE.Vector3(icW / 2 + 0.25 * B, yIC + icH * 0.25, zIC),
  } : null;
  const addIntercoolerFront = () => {
    batch.add('icCore|-1', box(icW, icH, 0.32 * B, 0, yIC, zIC));
    for (const s of [-1, 1]) batch.add('castAlu|-1', extrudeZ(shapeOf(roundRect(s * (icW / 2 + 0.13 * B), yIC, 0.28 * B, icH * 1.04, 0.1 * B)), zIC - 0.2 * B, zIC + 0.2 * B, 0.05 * B, 4));
  };
  const chargePipe = (a: THREE.Vector3, aDir: THREE.Vector3, b: THREE.Vector3, bDir: THREE.Vector3, rad = chargeR) => {
    const d = Math.min(a.distanceTo(b) * 0.3, 2.2 * B);
    batch.add('chargePipe|-1', varTube(bez(a, a.clone().addScaledVector(aDir, d), b.clone().addScaledVector(bDir, -d), b), () => rad, 48, 18));
  };
  // compressor (shared by turbo & centrifugal); returns outlet point/dir in root frame
  const buildCompressor = (center: THREE.Vector3, inducer: number, facing: 1 | -1, outletSide: number) => {
    const Ex = inducer * 1.35;
    const g = new THREE.Group();
    g.position.copy(center);
    if (facing < 0) g.rotation.y = Math.PI;
    root.add(g);
    const volR0 = Ex * 0.72, volR1 = Ex * 0.95;
    const vol = varTube(new SpiralCurve(volR0, volR1, Math.PI * 1.85, 0), (u) => Ex * (0.16 + 0.24 * u), 64, 20);
    const ax = Ex * 0.72;
    const outlet = varTube(new THREE.LineCurve3(new THREE.Vector3(volR1, 0, 0), new THREE.Vector3(volR1, -Ex * 0.9, 0)), () => Ex * 0.38, 4, 20);
    void ax;
    const back = cylZ(volR1 * 1.02, -Ex * 0.45, -Ex * 0.25, 40);
    const inlet = lathe([[inducer / 2 + 3, 0], [inducer / 2 + 3, Ex * 0.6], [inducer / 2 + Ex * 0.12, Ex * 0.65], [inducer / 2 + Ex * 0.12, Ex * 0.8], [inducer / 2, Ex * 0.8], [inducer / 2, -Ex * 0.1]], 40);
    inlet.rotateX(Math.PI / 2);
    const disc = cylZ(volR0 * 1.02, -Ex * 0.26, Ex * 0.05, 40);
    const housing = new THREE.Mesh(merge([vol, outlet, back, inlet, disc]), lib.base.castAlu);
    housing.castShadow = true;
    housing.rotation.z = outletSide > 0 ? 0 : Math.PI;
    if (outletSide < 0) housing.scale.x = 1;
    g.add(housing);
    // wheel
    const blades: THREE.BufferGeometry[] = [lathe([[0.001, Ex * 0.5], [inducer * 0.14, Ex * 0.5], [Ex * 0.42, 0.02 * Ex], [Ex * 0.5, 0], [0.001, 0]], 24).rotateX(Math.PI / 2)];
    const nb = 12;
    for (let i = 0; i < nb; i++) {
      const bl = new THREE.BoxGeometry(inducer * 0.45, 0.012 * Ex + 0.4, Ex * 0.5);
      bl.translate(inducer * 0.24, 0, Ex * 0.22);
      bl.rotateZ((i / nb) * Math.PI * 2);
      blades.push(bl);
    }
    const wheel = new THREE.Mesh(merge(blades), lib.base.chrome);
    wheel.position.z = Ex * 0.1;
    g.add(wheel);
    spinners.push({ obj: wheel, rate: 1, kind: 'turbo' });
    g.updateMatrixWorld(true);
    const outLocal = new THREE.Vector3(volR1 * (outletSide > 0 ? 1 : -1), -Ex * 0.9, 0);
    // housing rotated by PI flips both x & y; keep outlet pointing down-ish then route
    if (outletSide < 0) outLocal.set(-volR1, Ex * 0.9, 0);
    const outP = outLocal.applyMatrix4(new THREE.Matrix4().makeRotationY(facing < 0 ? Math.PI : 0)).add(center);
    const outDir = new THREE.Vector3(0, outletSide > 0 ? -1 : 1, 0);
    const inP = center.clone().add(new THREE.Vector3(0, 0, facing * Ex * 0.8));
    return { outP, outDir, inP, Ex, g };
  };

  if (turbo) {
    const count = !inline && cfg.turbo.count === 2 ? 2 : 1;
    const inducer = clamp(cfg.turbo.compressorInducerMm, 25, 110);
    const usedEnds = count === 2 ? collectorEnds : [collectorEnds[collectorEnds.length - 1]];
    const outlets: { p: THREE.Vector3; d: THREE.Vector3 }[] = [];
    usedEnds.forEach((ce) => {
      const Rt = inducer * 1.1;
      const Tc = ce.p.clone().addScaledVector(ce.ob, Rt * 0.4).add(new THREE.Vector3(0, isFlat ? -Rt * 0.6 : Rt * 1.3, -Rt * 0.3));
      // turbine housing (glowing iron)
      const turbZ = Tc.z - Rt * 0.55;
      const tv = varTube(new SpiralCurve(Rt * 0.62, Rt * 0.85, Math.PI * 1.8, 0), (u) => Rt * (0.38 - 0.18 * u), 64, 20, () => [0.24, 0.22, 0.21], () => 1);
      tv.translate(Tc.x, Tc.y, turbZ);
      turbineGeos.push(tv);
      turbineGeos.push(withHeat(cylZ(Rt * 0.66, turbZ - Rt * 0.3, turbZ + Rt * 0.25, 36, Tc.x, Tc.y), [0.24, 0.22, 0.21], 0.9));
      if (cfg.turbo.twinScroll) turbineGeos.push(withHeat(cylZ(Rt * 0.9, turbZ - 0.01 * B, turbZ + 0.01 * B, 36, Tc.x, Tc.y), [0.3, 0.28, 0.26], 0.9));
      // feed from collector
      const inlet = new THREE.Vector3(Tc.x + Rt * 0.85, Tc.y - Rt * 0.1, turbZ);
      hotGeos.push(varTube(bez(ce.p, ce.p.clone().add(new THREE.Vector3(0, 0, -0.3 * B)), inlet.clone().add(new THREE.Vector3(0, -0.6 * Rt, 0)), inlet), () => rp * 1.6, 24, 18, () => tint(0.6), () => 0.6));
      // center cartridge
      batch.add('castAlu|-1', cylZ(Rt * 0.35, turbZ + Rt * 0.25, Tc.z + Rt * 0.1, 24, Tc.x, Tc.y));
      // downpipe
      const dpS = new THREE.Vector3(Tc.x, Tc.y, turbZ - Rt * 0.3);
      const dpE = new THREE.Vector3(Tc.x, yPan - 0.2 * B, zwR - 2 * B);
      hotGeos.push(varTube(bez(dpS, dpS.clone().add(new THREE.Vector3(0, 0, -1.2 * Rt)), dpE.clone().add(new THREE.Vector3(0, 0.6 * B, 0.6 * B)), dpE), () => Rt * 0.42, 32, 20, () => tint(0.8), (u) => 0.5 * (1 - u)));
      // compressor
      const comp = buildCompressor(new THREE.Vector3(Tc.x, Tc.y, Tc.z + Rt * 0.25), inducer, 1, 1);
      outlets.push({ p: comp.outP, d: comp.outDir });
      // inlet filter
      const fp = comp.inP.clone();
      const f = lathe([[inducer / 2 + 5, 0], [inducer * 0.9, 0.15 * B], [inducer * 0.8, inducer * 1.6], [0.001, inducer * 1.6]], 32);
      f.rotateX(Math.PI / 2);
      f.translate(fp.x, fp.y, fp.z);
      batch.add('filter|-1', f);
    });
    // single turbo on V/flat: crossover from the other bank
    if (count === 1 && collectorEnds.length === 2) {
      const a = collectorEnds[0].p, b = collectorEnds[1].p;
      const yUnder = yPan - 0.3 * B;
      hotGeos.push(varTube(bez(a, new THREE.Vector3(a.x, yUnder, a.z - 0.5 * B), new THREE.Vector3(b.x * 0.8, yUnder, b.z - 0.5 * B), b.clone().add(new THREE.Vector3(0, -0.05 * B, 0))), () => rp * 1.5, 40, 18, () => tint(0.6), () => 0.45));
    }
    // charge piping
    const tbStart = throttleAt ? addThrottle(throttleAt.p, throttleAt.dir, false) : null;
    void tbStart;
    if (throttleAt) {
      const tbFront = throttleAt.p.clone().addScaledVector(throttleAt.dir, Math.max(0.6 * throttleR * 2, 0.5 * B));
      if (icPorts) {
        addIntercoolerFront();
        outlets.forEach((o, i) => {
          const tgt = o.p.x < 0 ? icPorts.a : icPorts.b;
          const tgt2 = outlets.length === 2 ? tgt.clone().add(new THREE.Vector3(0, i === 0 ? 0 : -icH * 0.5, 0)) : tgt;
          chargePipe(o.p, o.d, tgt2, new THREE.Vector3(0, 0, 1).multiplyScalar(1));
        });
        const other = outlets[0].p.x < 0 ? icPorts.b : icPorts.a;
        chargePipe(other, new THREE.Vector3(0, 0, -1), tbFront, throttleAt.dir.clone().negate());
      } else {
        outlets.forEach((o) => chargePipe(o.p, o.d, tbFront, throttleAt!.dir.clone().negate()));
      }
    }
  } else if (scType === 'centrifugal') {
    const inducer = Math.max(0.6 * B, 50);
    const side = inline ? sI(0) : -1;
    const cx = side * (inline ? W / 2 + 0.9 * B : engineHalfW * 0.75);
    const center = new THREE.Vector3(cx, Math.max(0.15 * deck, 0.1 * B), zBelt - 0.1 * B - inducer * 0.9);
    const comp = buildCompressor(center, inducer, -1, 1);
    // pulley on front
    const pr = 0.32 * B;
    const pg = lathe([[0.001, 0], [pr, 0], [pr, pulleyW * 0.5], [0.001, pulleyW * 0.5]], 32);
    pg.rotateX(Math.PI / 2);
    const pm = new THREE.Mesh(pg, lib.base.steel);
    pm.position.set(center.x, center.y, zBelt - pulleyW * 0.25);
    root.add(pm);
    spinners.push({ obj: pm, rate: pulleyR / pr, kind: 'crank' });
    batch.add('castAlu|-1', cylZ(0.2 * B, center.z, zBelt - pulleyW * 0.25, 20, center.x, center.y));
    // belt
    const beltPts = hull2d([...circlePts(0, 0, pulleyR * 0.99, 48), ...circlePts(center.x, center.y, pr * 0.99, 32)]);
    const inner = hull2d([...circlePts(0, 0, pulleyR * 0.94, 48), ...circlePts(center.x, center.y, pr * 0.92, 32)]);
    batch.add('belt|-1', extrudeZ(shapeOf(beltPts, [inner]), zBelt - pulleyW * 0.22, zBelt + pulleyW * 0.22, 0, 2));
    const f = lathe([[inducer / 2 + 5, 0], [inducer * 0.9, 0.15 * B], [inducer * 0.8, inducer * 1.5], [0.001, inducer * 1.5]], 32);
    f.rotateX(-Math.PI / 2);
    f.translate(comp.inP.x, comp.inP.y, comp.inP.z);
    batch.add('filter|-1', f);
    if (throttleAt) {
      addThrottle(throttleAt.p, throttleAt.dir, false);
      const tbFront = throttleAt.p.clone().addScaledVector(throttleAt.dir, Math.max(0.6 * throttleR * 2, 0.5 * B));
      if (icPorts) {
        addIntercoolerFront();
        const near = comp.outP.x < 0 ? icPorts.a : icPorts.b;
        const far = comp.outP.x < 0 ? icPorts.b : icPorts.a;
        chargePipe(comp.outP, comp.outDir, near, new THREE.Vector3(0, 0, 1));
        chargePipe(far, new THREE.Vector3(0, 0, -1), tbFront, throttleAt.dir.clone().negate());
      } else chargePipe(comp.outP, comp.outDir, tbFront, throttleAt.dir.clone().negate());
    }
  } else if (scType === 'roots' || scType === 'twin-screw') {
    const Wsc = Math.max(1.35 * B, plenum.w * 1.05);
    const Hsc = Wsc * 0.62;
    const ic = icEff > 0 ? 0.16 * B : 0;
    const yb = plenum.y + plenum.h / 2 + ic + Hsc / 2 - 0.02 * B;
    const z0 = plenum.z0 + 0.05 * B, z1 = plenum.z1 - 0.05 * B;
    const cs = hull2d([...circlePts(plenum.x - Wsc * 0.24, yb, Hsc * 0.5, 24), ...circlePts(plenum.x + Wsc * 0.24, yb, Hsc * 0.5, 24)]);
    batch.add('blower|-1', extrudeZ(shapeOf(cs), z0, z1, 0.06 * B, 6));
    if (scType === 'roots') {
      for (let i = 0; i <= 6; i++) {
        const z = z0 + ((z1 - z0) * i) / 6;
        const rib = hull2d([...circlePts(plenum.x - Wsc * 0.24, yb, Hsc * 0.5 + 0.04 * B, 24), ...circlePts(plenum.x + Wsc * 0.24, yb, Hsc * 0.5 + 0.04 * B, 24)]);
        batch.add('blower|-1', extrudeZ(shapeOf(rib), z - 0.025 * B, z + 0.025 * B, 0.01 * B, 4));
      }
    } else {
      batch.add('coverTrim|-1', box(Wsc * 0.5, 0.04 * B, (z1 - z0) * 0.8, plenum.x, yb + Hsc / 2 + 0.01 * B, (z0 + z1) / 2));
    }
    if (ic > 0) batch.add('icCore|-1', box(plenum.w * 0.95, ic, (z1 - z0) * 0.9, plenum.x, plenum.y + plenum.h / 2 + ic / 2, (z0 + z1) / 2));
    // snout & pulley at the belt plane
    const pr = 0.36 * B;
    batch.add('castAlu|-1', cylZ(0.16 * B, z1, zBelt, 20, plenum.x, yb));
    const pg = lathe([[0.001, 0], [pr, 0], [pr, pulleyW * 0.5], [0.001, pulleyW * 0.5]], 32);
    pg.rotateX(Math.PI / 2);
    const pm = new THREE.Mesh(pg, lib.base.steel);
    pm.position.set(plenum.x, yb, zBelt - pulleyW * 0.25);
    root.add(pm);
    spinners.push({ obj: pm, rate: pulleyR / pr, kind: 'crank' });
    const idler = new THREE.Vector2(plenum.x + 1.1 * B, (yb + 0) / 2);
    const beltPts = hull2d([...circlePts(0, 0, pulleyR * 0.99, 48), ...circlePts(plenum.x, yb, pr * 0.99, 32), ...circlePts(idler.x, idler.y, 0.2 * B, 16)]);
    const inner = hull2d([...circlePts(0, 0, pulleyR * 0.94, 48), ...circlePts(plenum.x, yb, pr * 0.92, 32), ...circlePts(idler.x, idler.y, 0.16 * B, 16)]);
    batch.add('belt|-1', extrudeZ(shapeOf(beltPts, [inner]), zBelt - pulleyW * 0.22, zBelt + pulleyW * 0.22, 0, 2));
    batch.add('steel|-1', cylZ(0.17 * B, zBelt - pulleyW * 0.3, zBelt + pulleyW * 0.3, 20, idler.x, idler.y));
    // throttle on top
    const topP = new THREE.Vector3(plenum.x, yb + Hsc / 2 - 0.02 * B, (z0 + z1) / 2 + (scType === 'roots' ? 0 : (z1 - z0) * 0.25));
    addThrottle(topP, up.clone(), true);
    topOfIntake = Math.max(topOfIntake, yb + Hsc);
  }
  if (!forced && throttleAt && !useItb) addThrottle(throttleAt.p, throttleAt.dir, true);

  // accessory drive: water pump + alternator on a serpentine belt (unless a blower owns the belt plane)
  if (!(scType === 'roots' || scType === 'twin-screw' || scType === 'centrifugal')) {
    const wp = new THREE.Vector2(0, isFlat ? Rswing + 0.45 * B : Math.max(Rswing + 0.55 * B, 0.42 * deck));
    const alt = isFlat
      ? new THREE.Vector2(-(1.1 * B), wp.y + 0.35 * B)
      : inline
        ? new THREE.Vector2(sE(0) * (W / 2 + 0.55 * B), 0.5 * deck)
        : new THREE.Vector2(-(Math.abs(toWorld(0, -Wh / 2, deck, 0).x) * 0.75), 0.42 * deck);
    const wpR = 0.42 * B, altR = 0.22 * B;
    const pulley = (c: THREE.Vector2, R: number, rate: number) => {
      const pg = lathe([[0.001, 0], [R, 0], [R * 0.93, pulleyW * 0.25], [R, pulleyW * 0.5], [0.001, pulleyW * 0.5]], 32);
      pg.rotateX(Math.PI / 2);
      const pm = new THREE.Mesh(pg, lib.base.steel);
      pm.position.set(c.x, c.y, zBelt - pulleyW * 0.25);
      root.add(pm);
      spinners.push({ obj: pm, rate, kind: 'crank' });
    };
    pulley(wp, wpR, pulleyR / wpR);
    pulley(alt, altR, pulleyR / altR);
    batch.add('castAlu|-1', cylZ(0.25 * B, zwF + coverT, zBelt - pulleyW * 0.25, 20, wp.x, wp.y));
    const az0 = zBelt - pulleyW * 0.3 - 0.9 * B, az1 = zBelt - pulleyW * 0.3;
    batch.add('castAlu|-1', cylZ(0.55 * B, az0, az1 - 0.12 * B, 36, alt.x, alt.y));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      batch.add('steel|-1', box(0.04 * B, 0.12 * B, 0.7 * B, alt.x + Math.cos(a) * 0.56 * B, alt.y + Math.sin(a) * 0.56 * B, (az0 + az1) / 2 - 0.06 * B).applyMatrix4(new THREE.Matrix4()));
    }
    batch.add('steel|-1', cylZ(0.08 * B, az1 - 0.12 * B, az1, 12, alt.x, alt.y));
    const outer = hull2d([...circlePts(0, 0, pulleyR * 0.99, 48), ...circlePts(wp.x, wp.y, wpR * 0.99, 32), ...circlePts(alt.x, alt.y, altR * 0.99, 24)]);
    const inner = hull2d([...circlePts(0, 0, pulleyR * 0.94, 48), ...circlePts(wp.x, wp.y, wpR * 0.92, 32), ...circlePts(alt.x, alt.y, altR * 0.9, 24)]);
    batch.add('belt|-1', extrudeZ(shapeOf(outer, [inner]), zBelt - pulleyW * 0.2, zBelt + pulleyW * 0.2, 0, 2));
  }

  // clipping planes (world space; root sits at origin with uniform scale)
  const camDir = new THREE.Vector2(1, 0.3);
  for (const k of banks) {
    const lx = new THREE.Vector3(1, 0, 0).transformDirection(Mb[k]);
    const sgn = lx.x * camDir.x + lx.y * camDir.y >= 0 ? 1 : -1;
    lib.planes[String(k)].set(lx.multiplyScalar(-sgn), 0);
  }
  lib.planes.common.set(isFlat ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(-1, 0, 0), 0);

  // =====================================================================
  // ASSEMBLE STATIC MESHES
  // =====================================================================
  const staticMeshes: THREE.Mesh[] = [];
  for (const { key, geometry } of batch.build()) {
    const [mk, bk] = key.split('|');
    const mesh = new THREE.Mesh(geometry, lib.get(mk, Number(bk ?? -1), initialMode));
    mesh.userData.matKey = mk;
    mesh.userData.bank = Number(bk ?? -1);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    staticMeshes.push(mesh);
  }
  let headerMesh: THREE.Mesh | null = null;
  if (hotGeos.length) {
    headerMesh = new THREE.Mesh(mergeHot(hotGeos), lib.base.header);
    headerMesh.castShadow = true;
    root.add(headerMesh);
  }
  let turbineMesh: THREE.Mesh | null = null;
  if (turbineGeos.length) {
    turbineMesh = new THREE.Mesh(mergeHot(turbineGeos), lib.base.turbine);
    root.add(turbineMesh);
  }

  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  for (const m of staticMeshes) bounds.expandByObject(m);
  if (headerMesh) bounds.expandByObject(headerMesh);
  bounds.expandByPoint(new THREE.Vector3(flyR, -flyR, zFly1).multiplyScalar(MM));
  bounds.expandByPoint(new THREE.Vector3(-flyR, -flyR, zFly1).multiplyScalar(MM));

  // =====================================================================
  // ANIMATION
  // =====================================================================
  const m4 = new THREE.Matrix4();
  const t4 = new THREE.Matrix4();
  const v3 = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s3 = new THREE.Vector3();
  const hiColor = new THREE.Color(0.7, 1.5, 2.2);
  let hovered: number | null = null;
  const heatColor = new THREE.Color();
  let time = 0;
  const flashLevel = new Float32Array(n);

  const update = (a: AnimInput) => {
    time += a.dt;
    const th = a.theta;
    crankGroup.rotation.z = -th * DEG;
    for (const cm of camMeshes) cm.rotation.z = -(th / 2) * DEG;
    for (let i = 0; i < n; i++) {
      const c = cyls[i];
      const phi = localCrankAngle(c, th) * DEG;
      const x = pistonDisplacement(phi, r, l);
      const beta = rodAngle(phi, r, l);
      const yp = r + l - x;
      const zw = ZW(c.zMm);
      m4.copy(Mb[c.bank]).multiply(t4.makeTranslation(0, yp, zw));
      pistons.setMatrixAt(i, m4);
      m4.multiply(t4.makeRotationZ(beta));
      rods.setMatrixAt(i, m4);
      // combustion
      const cyc = cyclePhase(c, th);
      const d = mod(cyc + 18, 720);
      const e = d < 75 ? Math.pow(Math.sin((Math.PI * d) / 75), 0.7) * (d < 20 ? 1 : Math.exp(-(d - 20) / 30)) : 0;
      const lvl = e * (0.3 + 0.7 * a.load);
      flashLevel[i] = lvl;
      const f = flashes[i];
      if (lvl > 0.01 && a.revPerSec > 0) {
        f.mesh.visible = f.core.visible = true;
        f.mesh.scale.set(1, chamber + x * (d < 20 ? 1 : 1), 1);
        f.mat.opacity = lvl * 0.65;
        f.mat.color.copy(flameColor).multiplyScalar(1 + 2 * lvl);
        f.coreMat.opacity = lvl;
        f.coreMat.color.setRGB(3 * lvl + 0.5, 2.4 * lvl + 0.4, 1.4 * lvl + 0.2);
      } else f.mesh.visible = f.core.visible = false;
    }
    pistons.instanceMatrix.needsUpdate = true;
    rods.instanceMatrix.needsUpdate = true;
    // lights on the two brightest flashes
    const order = Array.from(flashLevel.keys()).sort((p, q2) => flashLevel[q2] - flashLevel[p]);
    lights.forEach((pl, j) => {
      const i = order[j];
      if (i === undefined || flashLevel[i] < 0.01 || a.revPerSec <= 0) { pl.intensity = 0; return; }
      const c = cyls[i];
      pl.position.copy(toWorld(c.bank, 0, seatY + 0.25 * B, ZW(c.zMm)));
      pl.intensity = flashLevel[i] * 1.2;
    });
    // valves
    for (const v of valves) {
      const c = cyls[v.cyl];
      const cyc = cyclePhase(c, th);
      const lift = liftAt(cyc, mod(v.peakTheta - c.firingPhaseDeg, 720), v.dur, v.lift);
      m4.copy(v.frame).multiply(t4.makeTranslation(0, -lift, 0));
      (v.intake ? valveInMesh : valveExMesh).setMatrixAt(v.idx, m4);
      const sIdx = valves.indexOf(v);
      m4.copy(v.frame).multiply(t4.makeTranslation(0, v.springBase, 0)).multiply(t4.makeScale(1, (v.springLen - lift) / v.springLen, 1));
      springMesh.setMatrixAt(sIdx, m4);
      if (v.rocker && rockerMesh) {
        const camLift = lift / v.rocker.ratio;
        const ang = vt === 'pushrod' ? camLift / v.rocker.dx : -(lift / (v.rocker.dx || 1));
        m4.copy(v.rocker.pivot).multiply(t4.makeRotationZ(ang)).multiply(v.rocker.arm);
        rockerMesh.setMatrixAt(v.rocker.idx, m4);
      }
      if (v.push && pushMesh && lifterMesh) {
        const camLift = lift / (v.rocker?.ratio ?? 1.5);
        v3.copy(v.push.start).addScaledVector(v.push.dir, camLift);
        q.setFromUnitVectors(up, v.push.dir);
        m4.compose(v3, q, s3.set(1, 1, 1));
        lifterMesh.setMatrixAt(v.push.idx, m4);
        v3.addScaledVector(v.push.dir, 0.22 * B);
        m4.compose(v3, q, s3.set(1, v.push.len - 0.22 * B, 1));
        pushMesh.setMatrixAt(v.push.idx, m4);
      }
    }
    valveInMesh.instanceMatrix.needsUpdate = true;
    valveExMesh.instanceMatrix.needsUpdate = true;
    springMesh.instanceMatrix.needsUpdate = true;
    if (rockerMesh) rockerMesh.instanceMatrix.needsUpdate = true;
    if (pushMesh) pushMesh.instanceMatrix.needsUpdate = true;
    if (lifterMesh) lifterMesh.instanceMatrix.needsUpdate = true;
    // spinners
    for (const s of spinners) {
      if (s.kind === 'crank') s.obj.rotation.z = -th * DEG * s.rate;
      else s.obj.rotation.z -= a.dt * (a.revPerSec * 6 + 2) * (0.3 + a.boost) * Math.PI * 2 * (a.revPerSec > 0 ? 1 : 0);
    }
    if (throttlePlate) (throttlePlate as THREE.Mesh).rotation.x = Math.PI / 2 - (0.12 + 0.88 * a.load) * (Math.PI / 2) * 0.95;
    // exhaust heat
    const t = clamp((a.egtC - 640) / 420, 0, 1);
    const flicker = 1 + 0.05 * Math.sin(time * 37) * (a.revPerSec > 0 ? 1 : 0);
    heatColor.setRGB(1, 0.1 + 0.32 * t * t, 0.03 + 0.08 * t * t * t);
    const hm = lib.base.header;
    hm.emissive.copy(heatColor);
    hm.emissiveIntensity = Math.pow(t, 2) * 1.6 * flicker;
    const tm = lib.base.turbine;
    tm.emissive.copy(heatColor);
    tm.emissiveIntensity = Math.pow(t, 1.8) * 1.8 * flicker;
    if (headerMesh) headerMesh.material = lib.hot('header', curMode);
    if (turbineMesh) turbineMesh.material = lib.hot('turbine', curMode);
  };

  let curMode: ViewMode = initialMode;
  const setViewMode = (mode: ViewMode) => {
    curMode = mode;
    for (const m of staticMeshes) {
      m.material = lib.get(m.userData.matKey, m.userData.bank, mode);
      m.castShadow = mode !== 'xray' || !['block', 'crankcase', 'head', 'cover', 'timing', 'pan', 'blockDetail'].includes(m.userData.matKey);
    }
  };

  const setHover = (num: number | null) => {
    if (num === hovered) return;
    hovered = num;
    for (let i = 0; i < n; i++) {
      const on = cyls[i].number === num;
      pistons.setColorAt(i, on ? hiColor : white);
      hitMeshes[i].material = on ? hiMat : hitMat;
    }
    if (pistons.instanceColor) pistons.instanceColor.needsUpdate = true;
  };

  update({ theta: 0, dt: 0, load: 0, egtC: 0, revPerSec: 0, boost: 0 });

  return {
    root,
    hitRoot,
    bounds,
    hitMeshes,
    update,
    setViewMode,
    setHover,
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      });
      disposables.forEach((d) => d.dispose());
      lights.forEach((l) => l.dispose());
    },
  };
}

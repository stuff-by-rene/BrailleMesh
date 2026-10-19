/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Braille solid geometry — the Braille as its own printable volume.
//
// For the "eigenes Teil" export the Braille is NOT baked into the mesh:
// every dot becomes a small solid (spherical cap + anchoring skirt) in the
// block's frame, so the 3MF carries the base body and the Braille as separate
// volumes the slicer can colour (and split) independently.
//
//   raised   — dot caps sit on the block plane (the model surface), each
//              skirt reaching `embed` mm INTO the body for adhesion.
//   recessed — the base body carries the pockets (baked from a pockets-only
//              map); the dot solids fill them, tops flush with the original
//              surface, skirts reaching below the pocket floor.
//
// Pure maths: in → Float32Array of non-indexed triangles (xyz per corner).
// The profile mirrors the rasterised dot stamp in braille.js exactly
// (spherical cap through (r, 0) and (0, h), outer DotRounding filleted).

import { blockDescriptor } from './brailleBlocks.js';

/**
 * Build one placement's dot solids.
 * @param {object} block   pool block with .map (generateBrailleMap result) and .params
 * @param {object} placement { center, normal, rotation }
 * @param {object} [opts]  { embed = 0.4, segments = 20, rings = 8 }
 * @returns {Float32Array} triangle soup (9 floats per triangle)
 */
export function buildBrailleSolid(block, placement, opts = {}) {
  const embed = Math.max(0.05, opts.embed ?? 0.4);
  const SEG = Math.max(6, opts.segments ?? 20);
  const RINGS = Math.max(2, opts.rings ?? 8);

  const map = block.map;
  const params = block.params ?? {};
  const d = blockDescriptor(block, placement);
  const recessed = params.mode === 'recessed';
  const recessDepth = Math.max(0, params.recessDepth ?? 0);
  const dotH = Math.max(0.05, params.dotHeight ?? 0.5);
  const r = Math.max(0.1, params.dotDiameter ?? 1.6) / 2;
  const rounding = Math.max(0, Math.min(params.dotRounding ?? 0.75, r));
  const innerR = r - rounding;

  // Spherical-cap profile through (r, 0) and (0, h) — same math as the stamp.
  let Rs;
  if (dotH >= r) Rs = r;                                   // hemisphere + cylinder top
  else Rs = (r * r + dotH * dotH) / (2 * dotH);
  const apexOffset = Rs - dotH;
  const edgeZ = innerR > 0
    ? Math.sqrt(Math.max(0, Rs * Rs - innerR * innerR)) - apexOffset
    : 0;
  const profileAt = (rho) => {
    if (rho <= innerR) {
      return dotH >= r
        ? Math.sqrt(Math.max(0, r * r - rho * rho)) + (dotH - r)
        : Math.sqrt(Math.max(0, Rs * Rs - rho * rho)) - apexOffset;
    }
    if (rho <= r && rounding > 0) {
      const t = (rho - innerR) / rounding;
      return edgeZ * Math.sqrt(Math.max(0, 1 - t * t));
    }
    return 0;
  };

  // Vertical offset of the profile: raised dots grow from the block plane,
  // recessed dots from the pocket floor.
  const zFloor = recessed ? -recessDepth : 0;
  const zBottom = zFloor - embed;

  const out = [];
  const push = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    out.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  };

  const dots = map.dots ?? [];
  for (const dot of dots) {
    // Dot centre in block-local millimetres (map mm → centred).
    const ca = dot.x - map.widthMm / 2;
    const cb = dot.y - map.heightMm / 2;
    const dr = Math.max(0.05, dot.r ?? r);
    const dh = Math.max(0.05, dot.h ?? dotH);
    // Per-dot cap profile (dots share r/h today, but stay generic).
    let RsD;
    if (dh >= dr) RsD = dr;
    else RsD = (dr * dr + dh * dh) / (2 * dh);
    const apexOffD = RsD - dh;
    const innerRD = Math.max(0, dr - rounding);
    const edgeZD = innerRD > 0
      ? Math.sqrt(Math.max(0, RsD * RsD - innerRD * innerRD)) - apexOffD : 0;
    const profD = (rho) => {
      if (rho <= innerRD) {
        return dh >= dr
          ? Math.sqrt(Math.max(0, dr * dr - rho * rho)) + (dh - dr)
          : Math.sqrt(Math.max(0, RsD * RsD - rho * rho)) - apexOffD;
      }
      if (rho <= dr && rounding > 0) {
        const t = (rho - innerRD) / rounding;
        return edgeZD * Math.sqrt(Math.max(0, 1 - t * t));
      }
      return 0;
    };

    // Ring vertices: world = center + rA·(ca + ρ·cosθ) + uA·(cb + ρ·sinθ) + nA·z.
    const ring = (rho, z) => {
      const pts = new Float32Array(SEG * 3);
      for (let k = 0; k < SEG; k++) {
        const th = k / SEG * 2 * Math.PI;
        const a = ca + rho * Math.cos(th);
        const b = cb + rho * Math.sin(th);
        pts[k * 3]     = d.center[0] + d.r[0] * a + d.u[0] * b + d.n[0] * z;
        pts[k * 3 + 1] = d.center[1] + d.r[1] * a + d.u[1] * b + d.n[1] * z;
        pts[k * 3 + 2] = d.center[2] + d.r[2] * a + d.u[2] * b + d.n[2] * z;
      }
      return pts;
    };
    const apex = [
      d.center[0] + d.r[0] * ca + d.u[0] * cb + d.n[0] * (zFloor + dh),
      d.center[1] + d.r[1] * ca + d.u[1] * cb + d.n[1] * (zFloor + dh),
      d.center[2] + d.r[2] * ca + d.u[2] * cb + d.n[2] * (zFloor + dh),
    ];

    // Cap: apex fan + ring strips down to the profile base (ρ = dr).
    for (let k = 0; k < SEG; k++) {
      const k2 = (k + 1) % SEG;
      const p1 = ring(dr * (1 / RINGS), zFloor + profD(dr / RINGS));
      push(apex[0], apex[1], apex[2], p1[k * 3], p1[k * 3 + 1], p1[k * 3 + 2], p1[k2 * 3], p1[k2 * 3 + 1], p1[k2 * 3 + 2]);
    }
    for (let j = 1; j < RINGS; j++) {
      const rhoA = dr * j / RINGS, rhoB = dr * (j + 1) / RINGS;
      const zA = zFloor + profD(rhoA), zB = zFloor + profD(rhoB);
      const RA = ring(rhoA, zA), RB = ring(rhoB, zB);
      for (let k = 0; k < SEG; k++) {
        const k2 = (k + 1) % SEG;
        // Outward winding: (upper k, lower k, lower k2) + (upper k, lower k2, upper k2)
        push(RA[k * 3], RA[k * 3 + 1], RA[k * 3 + 2], RB[k * 3], RB[k * 3 + 1], RB[k * 3 + 2], RB[k2 * 3], RB[k2 * 3 + 1], RB[k2 * 3 + 2]);
        push(RA[k * 3], RA[k * 3 + 1], RA[k * 3 + 2], RB[k2 * 3], RB[k2 * 3 + 1], RB[k2 * 3 + 2], RA[k2 * 3], RA[k2 * 3 + 1], RA[k2 * 3 + 2]);
      }
    }

    // Skirt: vertical wall from the profile base down to zBottom.
    const top = ring(dr, zFloor + 0);
    const bot = ring(dr, zBottom);
    for (let k = 0; k < SEG; k++) {
      const k2 = (k + 1) % SEG;
      push(top[k * 3], top[k * 3 + 1], top[k * 3 + 2], bot[k * 3], bot[k * 3 + 1], bot[k * 3 + 2], bot[k2 * 3], bot[k2 * 3 + 1], bot[k2 * 3 + 2]);
      push(top[k * 3], top[k * 3 + 1], top[k * 3 + 2], bot[k2 * 3], bot[k2 * 3 + 1], bot[k2 * 3 + 2], top[k2 * 3], top[k2 * 3 + 1], top[k2 * 3 + 2]);
    }

    // Bottom disk (normal = −n): reversed fan.
    const bCenter = [
      d.center[0] + d.r[0] * ca + d.u[0] * cb + d.n[0] * zBottom,
      d.center[1] + d.r[1] * ca + d.u[1] * cb + d.n[1] * zBottom,
      d.center[2] + d.r[2] * ca + d.u[2] * cb + d.n[2] * zBottom,
    ];
    for (let k = 0; k < SEG; k++) {
      const k2 = (k + 1) % SEG;
      push(bCenter[0], bCenter[1], bCenter[2], bot[k2 * 3], bot[k2 * 3 + 1], bot[k2 * 3 + 2], bot[k * 3], bot[k * 3 + 1], bot[k * 3 + 2]);
    }
  }

  return new Float32Array(out);
}

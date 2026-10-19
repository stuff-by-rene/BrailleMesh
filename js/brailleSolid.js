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

/**
 * Build one placement's black-print caption solid — the EMBOSSED caption as
 * its own printable volume, extruded from the map's glyph-coverage mask
 * (map.caption). Engraved captions are recesses in the base body and stay
 * baked there — a recess cannot be a positive volume — so the caller only
 * invokes this for embossed captions.
 * @param {object} block   pool block with .map (generateBrailleMap result incl. .caption) and .params
 * @param {object} placement { center, normal, rotation }
 * @param {object} [opts]  { embed = 0.4, threshold = 128 }
 * @returns {Float32Array} triangle soup (9 floats per triangle)
 */
export function buildCaptionSolid(block, placement, opts = {}) {
  const embed = Math.max(0.05, opts.embed ?? 0.4);
  const THRESH = opts.threshold ?? 128;

  const map = block.map;
  const cap = map?.caption;
  const params = block.params ?? {};
  if (!cap || (params.blackRelief ?? 'engrave') !== 'emboss') return new Float32Array(0);

  const d = blockDescriptor(block, placement);
  const px = map.px || (map.width / map.widthMm);
  const zTop = Math.max(0.05, cap.depth);
  const zBottom = -embed;

  // Merge the glyph mask into rectangles: per-row runs, extended downward
  // while the span repeats — a few boxes instead of thousands of pixel cells.
  const boxes = [];
  let open = new Map();                       // span key → { x0, y0, x1, y1 } (mask px)
  for (let ry = 0; ry < cap.h; ry++) {
    const row = ry * cap.w;
    const seen = new Map();
    let runStart = -1;
    for (let rx = 0; rx <= cap.w; rx++) {
      const on = rx < cap.w && cap.alpha[row + rx] > THRESH;
      if (on && runStart < 0) runStart = rx;
      if (!on && runStart >= 0) {
        const key = runStart + ':' + rx;
        const prev = open.get(key);
        if (prev) { prev.y1 = ry + 1; seen.set(key, prev); }
        else seen.set(key, { x0: runStart, y0: ry, x1: rx, y1: ry + 1 });
        open.delete(key);
        runStart = -1;
      }
    }
    for (const box of open.values()) boxes.push(box);
    open = seen;
  }
  for (const box of open.values()) boxes.push(box);

  const out = [];
  const push = (...v) => out.push(...v);
  for (const box of boxes) {
    // Mask px → block-local millimetres, same frame as the dots
    // (x from the map's left edge, y from its bottom edge, centred).
    const a0 = (cap.x0 + box.x0) / px - map.widthMm / 2;
    const a1 = (cap.x0 + box.x1) / px - map.widthMm / 2;
    const b1 = map.heightMm - (cap.y0 + box.y0) / px - map.heightMm / 2;   // top edge
    const b0 = map.heightMm - (cap.y0 + box.y1) / px - map.heightMm / 2;   // bottom edge
    const v = [
      [a0, b0, zBottom], [a1, b0, zBottom], [a1, b1, zBottom], [a0, b1, zBottom],
      [a0, b0, zTop],    [a1, b0, zTop],    [a1, b1, zTop],    [a0, b1, zTop],
    ];
    const w = (i) => {
      const [a, b, z] = v[i];
      return [
        d.center[0] + d.r[0] * a + d.u[0] * b + d.n[0] * z,
        d.center[1] + d.r[1] * a + d.u[1] * b + d.n[1] * z,
        d.center[2] + d.r[2] * a + d.u[2] * b + d.n[2] * z,
      ];
    };
    // 12 triangles, outward winding (r × u = n, like the dot solids).
    for (const q of [[4, 5, 6, 7], [0, 3, 2, 1], [1, 2, 6, 5], [0, 4, 7, 3], [3, 7, 6, 2], [0, 1, 5, 4]]) {
      const P = w(q[0]), Q = w(q[1]), R = w(q[2]), S = w(q[3]);
      push(...P, ...Q, ...R);
      push(...P, ...R, ...S);
    }
  }

  return new Float32Array(out);
}

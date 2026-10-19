/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Braille blocks — pool entries ("Wort1", "Wort2", …) with placements.
//
// A POOL BLOCK holds the text, its parameters and the generated depth map;
// every PLACEMENT pins it to ONE face of the model: a centre point, the face
// normal it was placed on and a rotation about that normal. All placements of
// a block share the block's parameters — changing e.g. the dot diameter
// updates every placed copy at once.
//
// Its own coordinate frame (right / up / normal) turns any model point into
// block-local millimetres, so the text exists exactly where it was placed, at
// its real size - no projection mapping, no tiling, no masks, no layer budget.
//
// Pure maths (no THREE / DOM) so it runs in the export worker and in tests;
// only packBlockAtlas touches the DOM.

/** Minimum cosine between the face normal and the block normal for any relief. */
export const ANCHOR_COS_LO = 0.85;
export const ANCHOR_COS_HI = 0.95;

/** Maximum placements the preview shader can show at once (export is unlimited). */
export const MAX_PREVIEW_BLOCKS = 8;

function _norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Right-handed text frame on a face with outward normal `normal`: `u` points
 * "up" (world +Z projected into the face; +Y on top/bottom faces), `r` = u x n
 * points to the reader's right when looking at the face from outside.
 * `rotationDeg` turns the text counter-clockwise about the normal.
 */
export function blockFrame(normal, rotationDeg = 0) {
  const n = _norm(normal);
  let up = Math.abs(n[2]) > 0.95 ? [0, 1, 0] : [0, 0, 1];
  const d = up[0] * n[0] + up[1] * n[1] + up[2] * n[2];
  up = _norm([up[0] - d * n[0], up[1] - d * n[1], up[2] - d * n[2]]);
  let r = [
    up[1] * n[2] - up[2] * n[1],
    up[2] * n[0] - up[0] * n[2],
    up[0] * n[1] - up[1] * n[0],
  ];
  if (rotationDeg) {
    const a = rotationDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const r2 = [r[0] * c + up[0] * s, r[1] * c + up[1] * s, r[2] * c + up[2] * s];
    const u2 = [up[0] * c - r[0] * s, up[1] * c - r[1] * s, up[2] * c - r[2] * s];
    r = r2; up = u2;
  }
  return { r, u: up, n };
}

/** How far (mm) from the block plane a point may lie and still belong to the block. */
export function blockTolerance(widthMm, heightMm) {
  return Math.max(1.5, 0.15 * Math.max(widthMm, heightMm));
}

/**
 * Everything the preview shader and the exporter need about one PLACED block.
 * `block`: { map: { widthMm, heightMm, amplitudeMm, contentRect } }
 * `placement`: { center:[x,y,z], normal:[x,y,z], rotation? }
 * `contentUV`: the relief's bounding box in map UV space (v up) — the block's
 * weight is 1 inside it, 0 outside (the map is neutral at its border, so the
 * transition is invisible).
 */
export function blockDescriptor(block, placement) {
  const fr = blockFrame(placement.normal, placement.rotation || 0);
  const map = block.map;
  const w = map.widthMm, h = map.heightMm;
  const cr = map.contentRect ?? { x0: 0, y0: 0, x1: w, y1: h };
  return {
    center: [placement.center[0], placement.center[1], placement.center[2]],
    r: fr.r, u: fr.u, n: fr.n,
    widthMm: w, heightMm: h,
    tol: blockTolerance(w, h),
    amplitudeMm: map.amplitudeMm,
    contentUV: [cr.x0 / w, cr.y0 / h, (cr.x1 - cr.x0) / w, (cr.y1 - cr.y0) / h],
  };
}

/** Block-local coordinates of a model point: { a (right, mm), b (up, mm), nd (off-plane, mm) }. */
export function blockLocal(d, x, y, z) {
  const dx = x - d.center[0], dy = y - d.center[1], dz = z - d.center[2];
  return {
    a:  dx * d.r[0] + dy * d.r[1] + dz * d.r[2],
    b:  dx * d.u[0] + dy * d.u[1] + dz * d.u[2],
    nd: dx * d.n[0] + dy * d.n[1] + dz * d.n[2],
  };
}

/** Map-UV (v up) of block-local millimetres, clamped into the map. */
export function blockMapUV(d, a, b) {
  return [
    Math.min(1, Math.max(0, (a + d.widthMm / 2) / d.widthMm)),
    Math.min(1, Math.max(0, (b + d.heightMm / 2) / d.heightMm)),
  ];
}

/** Smoothstep face anchor: 0 off the placed face, 1 on it (signed - the opposite face is NOT included). */
export function anchorFactor(cos) {
  const t = Math.min(1, Math.max(0, (cos - ANCHOR_COS_LO) / (ANCHOR_COS_HI - ANCHOR_COS_LO)));
  return t * t * (3 - 2 * t);
}

/**
 * Per-triangle flags for the export pipeline: 1 = this triangle cannot carry
 * the block (so the pipeline may leave it unrefined and pinned), 0 = it might.
 * Conservative: bounding-box overlap in block space, roughly the same plane,
 * roughly the same orientation.
 */
export function blockOffFlags(positions, d) {
  const triCount = Math.floor(positions.length / 9);
  const flags = new Uint8Array(triCount).fill(1);
  const hw = d.widthMm / 2 + 0.5, hh = d.heightMm / 2 + 0.5;
  const planeTol = d.tol * 1.5 + 1;
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const A = blockLocal(d, positions[o], positions[o + 1], positions[o + 2]);
    const B = blockLocal(d, positions[o + 3], positions[o + 4], positions[o + 5]);
    const C = blockLocal(d, positions[o + 6], positions[o + 7], positions[o + 8]);
    if (Math.max(A.a, B.a, C.a) < -hw || Math.min(A.a, B.a, C.a) > hw) continue;
    if (Math.max(A.b, B.b, C.b) < -hh || Math.min(A.b, B.b, C.b) > hh) continue;
    if (Math.min(Math.abs(A.nd), Math.abs(B.nd), Math.abs(C.nd)) > planeTol) continue;
    // Orientation: triangle normal (local frame) against the block normal.
    const e1a = B.a - A.a, e1b = B.b - A.b, e1n = B.nd - A.nd;
    const e2a = C.a - A.a, e2b = C.b - A.b, e2n = C.nd - A.nd;
    const na = e1b * e2n - e1n * e2b;
    const nb = e1n * e2a - e1a * e2n;
    const nn = e1a * e2b - e1b * e2a;
    const len = Math.hypot(na, nb, nn);
    if (len < 1e-12 || nn / len < 0.7) continue;
    flags[t] = 0;
  }
  return flags;
}

/**
 * One placement as a pseudo-layer for applyDisplacementLayers: its settings
 * carry the block frame (`block`) and amplitude 2 × depth, so the displacement
 * sampler reads the map in block space instead of projecting it. Symmetric
 * displacement turns grey g into exactly (g - 0.5) * 2 * depth = the depth the
 * map was generated from.
 */
export function blockToPipelineLayer(block, placement, positions) {
  const d = blockDescriptor(block, placement);
  return {
    imageData: block.map.imageData,
    imgWidth: block.map.width,
    imgHeight: block.map.height,
    settings: {
      mappingMode: 5, scaleU: 1, scaleV: 1, offsetU: 0, offsetV: 0, rotation: 0,
      amplitude: 2 * d.amplitudeMm, symmetricDisplacement: true,
      decal: true, noTile: true,
      mappingBlend: 0, seamBandWidth: 0.35, capAngle: 20, boundaryFalloff: 0,
      placeNormal: d.n, block: d,
    },
    exclude: null,
    hardFaces: blockOffFlags(positions, d),
    blendAdd: false,
  };
}

/**
 * Pack the blocks' maps into ONE atlas canvas (shelf packing), so the preview
 * shader reads any number of blocks through a single sampler. Returns
 * { canvas, rects: Map(id -> [u0, v0, du, dv]) } with UVs in texture space
 * (v up, matching a flipY canvas texture). Maps are downscaled uniformly when
 * they don't fit `maxSide` x `maxSide`.
 */
export function packBlockAtlas(items, maxSide = 4096) {
  const GUTTER = 2;
  if (!items.length) return null;
  let scale = 1, layout = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    layout = _shelfLayout(items, scale, maxSide, GUTTER);
    if (layout) break;
    scale *= 0.8;
  }
  if (!layout) return null;
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const rects = new Map();
  for (const p of layout.placed) {
    ctx.drawImage(p.item.canvas, p.x, p.y, p.w, p.h);
    rects.set(p.item.id, [p.x / layout.width, 1 - (p.y + p.h) / layout.height, p.w / layout.width, p.h / layout.height]);
  }
  return { canvas, rects };
}

function _shelfLayout(items, scale, maxSide, gutter) {
  const sized = items.map((item) => ({
    item,
    w: Math.max(1, Math.round(item.canvas.width * scale)),
    h: Math.max(1, Math.round(item.canvas.height * scale)),
  })).sort((a, b) => b.h - a.h);
  let x = 0, y = 0, rowH = 0, width = 0;
  const placed = [];
  for (const s of sized) {
    if (s.w > maxSide) return null;
    if (x + s.w > maxSide) { y += rowH + gutter; x = 0; rowH = 0; }
    placed.push({ item: s.item, x, y, w: s.w, h: s.h });
    x += s.w + gutter;
    rowH = Math.max(rowH, s.h);
    width = Math.max(width, x - gutter);
  }
  const height = y + rowH;
  if (height > maxSide) return null;
  return { placed, width, height };
}

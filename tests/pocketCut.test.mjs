/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cutPockets } from '../js/pocketCut.js';

/** Indexed 2×2×2 mm cube centred at the origin, as a non-indexed soup. */
function cubeSoup() {
  const V = [
    -1,-1, 1,  1,-1, 1,  1, 1, 1,  -1, 1, 1,
    -1,-1,-1,  1,-1,-1,  1, 1,-1,  -1,1,-1,
  ];
  const F = [
    [0,1,2],[0,2,3], [4,7,6],[4,6,5], [1,5,6],[1,6,2],
    [0,3,7],[0,7,4], [3,2,6],[3,6,7], [0,4,5],[0,5,1],
  ];
  const out = [];
  for (const [a, b, c] of F) out.push(...V.slice(a * 3, a * 3 + 3), ...V.slice(b * 3, b * 3 + 3), ...V.slice(c * 3, c * 3 + 3));
  return new Float32Array(out);
}

const FRAME = {
  center: [0, 0, 0], r: [1, 0, 0], u: [0, 1, 0], n: [0, 0, 1],
  widthMm: 2, heightMm: 2,
};
const RECT = { x0: 0.5, y0: 0.6, x1: 1.5, y1: 1.4, r: 0.2 };   // map mm → block-local a ∈ [−0.5, 0.5], b ∈ [−0.4, 0.4]

test('cutPockets: vertical walls and exact floor on a cube', async () => {
  const out = await cutPockets(cubeSoup(), [{ frame: FRAME, rect: RECT, depth: 0.5 }]);
  assert.ok(out.length > 0);
  const onWallPlane = (x, y) =>
    (Math.abs(Math.abs(x) - 0.5) < 1e-4 && Math.abs(y) <= 0.4 + 1e-4)
    || (Math.abs(Math.abs(y) - 0.4) < 1e-4 && Math.abs(x) <= 0.5 + 1e-4);
  let floor = 0, rim = 0, floorEdge = 0, sloped = 0;
  for (let i = 0; i < out.length; i += 3) {
    const x = out[i], y = out[i + 1], z = out[i + 2];
    if (Math.abs(z + 0.5) < 1e-5) {
      floor++;
      if (onWallPlane(x, y)) floorEdge++;
    } else if (Math.abs(z - 1) < 1e-5) {          // cube top = surface
      if (onWallPlane(x, y)) rim++;
    } else if (z > -0.5 + 1e-5 && z < 1 - 1e-5) {
      if (!onWallPlane(x, y)) sloped++;           // off the wall planes → not vertical
    }
  }
  assert.ok(floor > 0, 'pocket floor at exactly −depth');
  assert.ok(rim > 0, 'pocket rim on the wall planes at the surface');
  assert.ok(floorEdge > 0, 'pocket floor edge on the wall planes at z=−depth');
  assert.equal(sloped, 0, 'no vertex off the wall planes between surface and floor');
});

test('cutPockets: unions survive the cut (recessed dots re-added)', async () => {
  // A small box solid sitting INSIDE the pocket footprint, spanning the full
  // pocket depth and poking above the surface — must survive the cut.
  const dot = new Float32Array([
    // box a ∈ [−0.1, 0.1], b ∈ [−0.1, 0.1], z ∈ [−0.6, 0.2] (12 tris)
    ...boxSoup(-0.1, -0.1, -0.6, 0.1, 0.1, 0.2),
  ]);
  const out = await cutPockets(cubeSoup(), [{ frame: FRAME, rect: RECT, depth: 0.5 }], [dot]);
  // The dot's top (z = 0.2) must exist after cut + union.
  let above = 0;
  for (let i = 2; i < out.length; i += 3) if (out[i] > 0.19 && out[i] < 0.21) above++;
  assert.ok(above > 0, 'unioned dot top survives the pocket cut');
});

test('cutPockets: non-manifold input falls back to the unchanged soup', async () => {
  // Two disconnected triangles sharing nothing — not a closed solid.
  const bad = new Float32Array([
    0,0,0, 1,0,0, 0,1,0,
    0,0,1, 1,0,1, 0,1,1,
  ]);
  const out = await cutPockets(bad, [{ frame: FRAME, rect: RECT, depth: 0.5 }]);
  assert.equal(out.length, bad.length);
});

/** Axis-aligned closed box as a soup (12 triangles, outward winding). */
function boxSoup(ax0, b0, z0, ax1, b1, z1) {
  const v = [
    [ax0,b0,z0],[ax1,b0,z0],[ax1,b1,z0],[ax0,b1,z0],   // bottom
    [ax0,b0,z1],[ax1,b0,z1],[ax1,b1,z1],[ax0,b1,z1],   // top
  ];
  const f = [
    [4,5,6],[4,6,7],       // +z
    [1,0,3],[1,3,2],       // −z
    [0,4,7],[0,7,3],       // −x
    [5,1,2],[5,2,6],       // +x
    [3,7,6],[3,6,2],       // +y
    [0,1,5],[0,5,4],       // −y
  ];
  const out = [];
  for (const [a, b, c] of f) out.push(...v[a], ...v[b], ...v[c]);
  return out;
}

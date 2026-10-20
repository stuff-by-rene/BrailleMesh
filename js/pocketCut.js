/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Hard-walled Braille pockets — geometric boolean cut.
//
// The depth map rasterises the recessed frame only for the preview shader
// (per-pixel normals shade the 1-px cliff sharp). Displaced vertices could
// never reproduce a vertical wall from a raster, so the exports cut the same
// rounded-rect footprint geometrically instead: the displaced base mesh goes
// through a boolean difference (manifold-3d, WASM) against one prism per
// recessed placement. Recessed dots that were baked into the pocket are cut
// away with it and re-added as exact solids via the optional `unions`
// (full-baked export); the separate-part export keeps them as own volumes.

import { weldVertices } from './meshIndex.js';

let _modulePromise = null;

/** Lazily initialised manifold-3d WASM module (cached promise). */
export function manifoldModule() {
  if (!_modulePromise) {
    _modulePromise = import('manifold-3d')
      .then(mod => (mod.default ?? mod)())
      .then(inst => { if (inst.setup) inst.setup(); return inst; });
  }
  return _modulePromise;
}

/**
 * Cut hard-walled pockets out of the displaced base mesh, optionally unioning
 * solids back in (recessed dots re-added after their raster copies were cut
 * away with the pocket).
 * @param {Float32Array} positions  non-indexed triangle soup, working space
 * @param {Array<{frame, rect, depth}>} cuts  frame: blockDescriptor fields
 *        (center, r, u, n, widthMm, heightMm); rect: map.pocketRect
 *        ({x0, y0, x1, y1, r} in map mm); depth: pocket depth in mm
 * @param {Float32Array[]} [unions]  triangle soups to union back into the base
 * @returns {Promise<{positions: Float32Array, cut: boolean}>} the (possibly
 *        unchanged) soup and whether the cut actually ran — callers keep the
 *        rasterised pocket as a fallback when it didn't.
 */
export async function cutPockets(positions, cuts, unions = []) {
  if ((!cuts.length && !unions.length) || !positions.length) {
    return { positions, cut: false };
  }
  const M = await manifoldModule();

  const welded = _weldSoup(positions, 1e4);
  let base;
  try {
    base = new M.Manifold(welded);
  } catch (e) {
    // Imported meshes often carry float-noise cracks or sliver gaps that defeat
    // the tight weld — retry coarser (0.001 mm, then 0.01 mm grid) before
    // giving up; the coarse weld merges near-duplicate vertices.
    base = null;
    for (const decimals of [1e3, 1e2]) {
      try {
        base = new M.Manifold(_weldSoup(positions, decimals));
        break;
      } catch (e2) { /* try the next coarser grid */ }
    }
    if (!base) {
      console.warn(
        `pocketCut: base mesh is not watertight/manifold (${positions.length / 3} tris) — skipping cut`, e);
      return { positions, cut: false };
    }
  }

  try {
    for (const cut of cuts) {
      base = base.subtract(new M.Manifold(_prismMesh(cut)));
    }
    for (const soup of unions) {
      base = base.add(new M.Manifold(_weldSoup(soup, 1e4)));
    }
  } catch (e) {
    console.warn('pocketCut: boolean failed — skipping cut', e);
    return { positions, cut: false };
  }
  if (base.isEmpty()) return { positions, cut: false };

  const out = base.getMesh();
  const vp = out.vertProperties, tv = out.triVerts;
  const soup = new Float32Array(tv.length * 3);
  for (let t = 0; t < tv.length; t++) {
    const v = tv[t] * 3;
    soup[t * 3] = vp[v];
    soup[t * 3 + 1] = vp[v + 1];
    soup[t * 3 + 2] = vp[v + 2];
  }
  return { positions: soup, cut: true };
}

/** Weld a non-indexed soup into an indexed mesh (0.1 µm grid via the app's
 *  integer-hash welder); decimals = 1/quantum. */
function _weldSoup(positions, decimals) {
  const count = positions.length / 3;
  const { vertexId, uniqueCount } = weldVertices(positions, count, decimals);
  const vertProperties = new Float32Array(uniqueCount * 3);
  const seen = new Uint8Array(uniqueCount);
  for (let i = 0; i < count; i++) {
    const id = vertexId[i];
    if (seen[id]) continue;
    seen[id] = 1;
    vertProperties[id * 3] = positions[i * 3];
    vertProperties[id * 3 + 1] = positions[i * 3 + 1];
    vertProperties[id * 3 + 2] = positions[i * 3 + 2];
  }
  return { vertProperties, triVerts: new Uint32Array(vertexId), numProp: 3 };
}

/** CCW rounded-rect contour (block-local mm). */
function _roundedRect(x0, y0, x1, y1, rad, seg = 6) {
  const pts = [];
  const cx0 = x0 + rad, cx1 = x1 - rad, cy0 = y0 + rad, cy1 = y1 - rad;
  const arc = (cx, cy, a0, a1) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (a1 - a0) * (i / seg);
      pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
    }
  };
  arc(cx1, cy1, 0, Math.PI / 2);
  arc(cx0, cy1, Math.PI / 2, Math.PI);
  arc(cx0, cy0, Math.PI, 1.5 * Math.PI);
  arc(cx1, cy0, 1.5 * Math.PI, 2 * Math.PI);
  return pts;
}

/** One pocket prism as an indexed mesh in world coordinates (r × u = n). */
function _prismMesh(cut) {
  const { frame, rect, depth } = cut;
  const a0 = rect.x0 - frame.widthMm / 2, a1 = rect.x1 - frame.widthMm / 2;
  const b0 = rect.y0 - frame.heightMm / 2, b1 = rect.y1 - frame.heightMm / 2;
  const rad = Math.max(0, Math.min(rect.r ?? 0, (a1 - a0) / 2, (b1 - b0) / 2));
  const ring = _roundedRect(a0, b0, a1, b1, rad);
  const n = ring.length;
  const zTop = 2.5;                       // above the max texture amplitude (2 mm)
  const zBot = -Math.max(0.05, depth);

  const world = (a, b, z) => [
    frame.center[0] + frame.r[0] * a + frame.u[0] * b + frame.n[0] * z,
    frame.center[1] + frame.r[1] * a + frame.u[1] * b + frame.n[1] * z,
    frame.center[2] + frame.r[2] * a + frame.u[2] * b + frame.n[2] * z,
  ];
  const verts = [];
  for (const [a, b] of ring) verts.push(...world(a, b, zTop));
  for (const [a, b] of ring) verts.push(...world(a, b, zBot));
  let cx = 0, cy = 0;
  for (const [a, b] of ring) { cx += a; cy += b; }
  cx /= n; cy /= n;

  const tris = [];
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    tris.push(k, n + k, n + k2,   k, n + k2, k2);          // sides, outward
  }
  const cTop = verts.length / 3;
  verts.push(...world(cx, cy, zTop));
  const cBot = verts.length / 3;
  verts.push(...world(cx, cy, zBot));
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    tris.push(cTop, k, k2);                                // +n cap
    tris.push(cBot, n + k2, n + k);                        // −n cap
  }
  return { vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris), numProp: 3 };
}

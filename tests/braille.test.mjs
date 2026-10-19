/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { translateText, BRAILLE_DEFAULTS, BR_LOCK_DEPS } from '../js/braille.js';
import { blockFrame, anchorFactor, blockOffFlags, blockDescriptor, blockToPipelineLayer } from '../js/brailleBlocks.js';
import { buildBrailleSolid } from '../js/brailleSolid.js';
import { export3MFVolumes } from '../js/exporter.js';
import { applyDisplacementLayers } from '../js/displacement.js';
import { subdivide } from '../js/subdivision.js';
import { THREE } from '../js/threeCompat.js';

// ── Translation ───────────────────────────────────────────────────────────────

test('DE Vollschrift translates letters and reports unknown characters', () => {
  const r = translateText('Hallo', 'de');
  assert.equal(r.unknown.length, 0);
  const cells = r.lines[0].filter(Boolean);
  assert.equal(cells.length, 5);
  assert.deepEqual(cells[0].dots, [1, 2, 5]);            // h
  assert.deepEqual(cells[1].dots, [1]);                  // a
  assert.deepEqual(cells[2].dots, [1, 2, 3]);            // l
  assert.deepEqual(cells[4].dots, [1, 3, 5]);            // o
});

test('DE Vollschrift folds letter groups (sch, ei, st)', () => {
  const r = translateText('Schweiz', 'de');
  const cells = r.lines[0].filter(Boolean);
  // sch + w + ei + z
  assert.equal(cells.length, 4);
  assert.deepEqual(cells[0].dots, [1, 5, 6]);            // sch
  assert.deepEqual(cells[1].dots, [2, 4, 5, 6]);         // w
  assert.deepEqual(cells[2].dots, [1, 4, 6]);            // ei
  assert.deepEqual(cells[3].dots, [1, 3, 5, 6]);         // z
});

test('digits get the number sign and reuse a-j patterns', () => {
  const r = translateText('12', 'en');
  const cells = r.lines[0].filter(Boolean);
  assert.equal(cells.length, 3);
  assert.equal(cells[0].isNumberSign, true);
  assert.deepEqual(cells[0].dots, [3, 4, 5, 6]);
  assert.deepEqual(cells[1].dots, [1]);                  // 1 -> a
  assert.deepEqual(cells[2].dots, [1, 2]);               // 2 -> b
});

test('EN UEB Grade 2 uses word signs for and/the/out', () => {
  const r = translateText('and the out', 'en-g2');
  const cells = r.lines[0].filter(Boolean);
  assert.equal(cells.length, 3);
  assert.deepEqual(cells[0].dots, [1, 2, 3, 4, 6]);      // and
  assert.deepEqual(cells[1].dots, [2, 3, 4, 6]);         // the
  assert.deepEqual(cells[2].dots, [1, 2, 5, 6]);         // out
});

test('EN UEB Grade 2 folds strong groupsigns inside words', () => {
  const r = translateText('caring', 'en-g2');
  const cells = r.lines[0].filter(Boolean);
  // c + ar + ing
  assert.equal(cells.length, 3);
  assert.deepEqual(cells[1].dots, [3, 4, 5]);            // ar
  assert.deepEqual(cells[2].dots, [3, 4, 6]);            // ing
});

test('DE Kurzschrift word signs and groupsigns (simplified set)', () => {
  const word = translateText('und', 'de-kurz').lines[0].filter(Boolean);
  assert.equal(word.length, 1);
  assert.deepEqual(word[0].dots, [1, 2, 3, 4, 6]);       // und-Kürzel
  const aber = translateText('aber', 'de-kurz').lines[0].filter(Boolean);
  assert.equal(aber.length, 1);                          // aber-Kürzel
  assert.deepEqual(aber[0].dots, [1]);
  // "Preis": p + r + ei-Gruppe + s  (Vollschrift wäre p r e i s)
  const preis = translateText('Preis', 'de-kurz').lines[0].filter(Boolean);
  assert.equal(preis.length, 4);
  assert.deepEqual(preis[2].dots, [1, 4, 6]);            // ei
});

// ── Block frame math ─────────────────────────────────────────────────────────

test('blockFrame is orthonormal and honours rotation', () => {
  const f = blockFrame([0, 0, 1]);
  assert.ok(Math.abs(f.r[0] - 1) < 1e-9);                // r = +X on a +Z face
  assert.ok(Math.abs(f.u[1] - 1) < 1e-9);                // u = +Y
  assert.ok(Math.abs(f.n[2] - 1) < 1e-9);
  const g = blockFrame([0, 0, 1], 90);
  const dot = g.r[0] * f.r[0] + g.r[1] * f.r[1];         // r rotated 90° CCW -> +Y
  assert.ok(Math.abs(g.r[1] - 1) < 1e-9);
  assert.ok(Math.abs(dot) < 1e-9);
});

test('anchorFactor fades between 0.85 and 0.95 cosine', () => {
  assert.equal(anchorFactor(1), 1);
  assert.equal(anchorFactor(0.8), 0);
  assert.equal(anchorFactor(-1), 0);
  const mid = anchorFactor(0.9);
  assert.ok(mid > 0.4 && mid < 0.6);
});

// ── Off flags on a cube ──────────────────────────────────────────────────────

test('blockOffFlags pins everything except the placed face region', () => {
  const geo = new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
  const pos = geo.attributes.position.array;
  const map = { widthMm: 10, heightMm: 6, amplitudeMm: 0.5, contentRect: { x0: 1, y0: 1, x1: 9, y1: 5 } };
  const d = blockDescriptor({ map }, { center: [0, 0, 10], normal: [0, 0, 1], rotation: 0 });
  const flags = blockOffFlags(pos, d);
  const triCount = pos.length / 9;
  assert.equal(flags.length, triCount);
  let free = 0, pinned = 0;
  for (let t = 0; t < triCount; t++) (flags[t] ? pinned++ : free++);
  // Exactly the 2 top-face triangles may carry the block.
  assert.equal(free, 2);
  assert.equal(pinned, triCount - 2);
});

// ── CPU displacement with a synthetic block map ─────────────────────────────

function syntheticMap(setter, { W = 41, H = 41, pxPerMm = 20, amp = 0.5 } = {}) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 128;
    data[i * 4 + 3] = 255;
  }
  setter(data, W, H);
  const widthMm = W / pxPerMm, heightMm = H / pxPerMm;
  return {
    imageData: { data, width: W, height: H },
    width: W, height: H, widthMm, heightMm,
    amplitudeMm: amp,
    contentRect: { x0: 0, y0: 0, x1: widthMm, y1: heightMm },
    dots: [], params: {},
  };
}

async function displacedCube(block, settings) {
  const base = new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
  const { geometry: sub } = await subdivide(base, 0.5, () => {}, null);
  const positions = sub.attributes.position.array;
  const layer = blockToPipelineLayer(block, { center: [0, 0, 10], normal: [0, 0, 1], rotation: 0 }, positions);
  const bounds = {
    min: new THREE.Vector3(-10, -10, -10), max: new THREE.Vector3(10, 10, 10),
    size: new THREE.Vector3(20, 20, 20), center: new THREE.Vector3(0, 0, 0),
  };
  const out = applyDisplacementLayers(
    sub, [layer],
    { bottomAngleLimit: 0, topAngleLimit: 0, noDownwardZ: false, blendNormalSmoothing: 0 },
    bounds,
  );
  return out.attributes.position.array;
}

test('raised block: dot apex rises by dotHeight, far surface untouched', async () => {
  const map = syntheticMap((data, W) => {
    for (let y = 18; y <= 22; y++) for (let x = 18; x <= 22; x++) {
      const o = (y * W + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
    }
  });
  const block = { map, params: { ...BRAILLE_DEFAULTS, mode: 'raised' } };
  const pos = await displacedCube(block);
  let maxZ = -Infinity;
  for (let i = 2; i < pos.length; i += 3) if (pos[i] > maxZ) maxZ = pos[i];
  assert.ok(Math.abs(maxZ - 10.5) < 0.02, `apex z=${maxZ}`);
  // A corner region of the top face (outside the ~1 mm map) stays at z=10.
  let cornerOk = true;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i + 2] < 9.99) continue;                       // not the top face
    if (Math.abs(pos[i]) > 3 && Math.abs(pos[i + 1]) > 3 && Math.abs(pos[i + 2] - 10) > 1e-6) cornerOk = false;
  }
  assert.ok(cornerOk, 'surface outside the block must not move');
});

test('recessed block: pocket sinks by recessDepth', async () => {
  const map = syntheticMap((data, W) => {
    for (let y = 18; y <= 22; y++) for (let x = 18; x <= 22; x++) {
      const o = (y * W + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 0;
    }
  });
  const block = { map, params: { ...BRAILLE_DEFAULTS, mode: 'recessed', recessDepth: 0.5 } };
  const pos = await displacedCube(block);
  let minZ = Infinity;
  for (let i = 2; i < pos.length; i += 3) {
    if (pos[i] < 5) continue;                                                  // top half only
    if (Math.abs(pos[i - 2]) > 9.99 || Math.abs(pos[i - 1]) > 9.99) continue;  // top-face interior
    if (pos[i] < minZ) minZ = pos[i];
  }
  assert.ok(Math.abs(minZ - 9.5) < 0.02, `pocket floor z=${minZ}`);
});

// ── Solid geometry ───────────────────────────────────────────────────────────

test('braille solid is closed (every edge shared by exactly 2 triangles)', () => {
  const map = {
    widthMm: 20, heightMm: 10, amplitudeMm: 0.5,
    contentRect: { x0: 2, y0: 2, x1: 18, y1: 8 },
    dots: [{ x: 10, y: 5, r: 0.8, h: 0.5 }],
  };
  const block = { map, params: { mode: 'raised', dotDiameter: 1.6, dotHeight: 0.5, dotRounding: 0.75, recessDepth: 0.5 } };
  const pos = buildBrailleSolid(block, { center: [0, 0, 0], normal: [0, 0, 1], rotation: 0 });
  assert.equal(pos.length % 9, 0);
  const triCount = pos.length / 9;
  assert.ok(triCount > 20);

  // Weld identical positions and count edge incidences.
  const key = (x, y, z) => `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
  const edges = new Map();
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const v = [key(pos[o], pos[o+1], pos[o+2]), key(pos[o+3], pos[o+4], pos[o+5]), key(pos[o+6], pos[o+7], pos[o+8])];
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      const k = a < b ? a + '|' + b : b + '|' + a;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  for (const [k, n] of edges) assert.equal(n, 2, `edge ${k} incident ${n} times`);

  // z range: skirt bottom (-embed) .. dot apex (+h)
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 2; i < pos.length; i += 3) { zMin = Math.min(zMin, pos[i]); zMax = Math.max(zMax, pos[i]); }
  assert.ok(Math.abs(zMax - 0.5) < 1e-6, `apex ${zMax}`);
  assert.ok(Math.abs(zMin + 0.4) < 1e-6, `skirt bottom ${zMin}`);
});

// ── Multi-volume 3MF ─────────────────────────────────────────────────────────

function captureDownload(t) {
  let blob;
  t.mock.method(URL, 'createObjectURL', value => { blob = value; return 'blob:test'; });
  t.mock.method(globalThis, 'setTimeout', () => 0);
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ style: {}, click() {} }), body: { appendChild() {}, removeChild() {} } };
  t.after(() => { globalThis.document = previous; });
  return () => blob;
}

test('export3MFVolumes writes base + Braille as separate component volumes', async t => {
  const getBlob = captureDownload(t);
  const base = new Float32Array([
    0, 0, 0, 10, 0, 0, 0, 10, 0,
    10, 0, 0, 10, 10, 0, 0, 10, 0,
  ]);
  const braille = new Float32Array([
    1, 1, 0, 2, 1, 0, 1, 2, 0,
  ]);
  await export3MFVolumes([
    { name: 'Model', positions: base },
    { name: 'Braille', positions: braille },
  ], 'teil.3mf');
  const xml = strFromU8(unzipSync(new Uint8Array(await getBlob().arrayBuffer()))['3D/3dmodel.model']);
  assert.ok(xml.includes('<object id="1" type="model"><component objectid="2"/><component objectid="3"/></object>'));
  assert.ok(xml.includes('<object id="2" type="model" name="Model">'));
  assert.ok(xml.includes('<object id="3" type="model" name="Braille">'));
  assert.ok(xml.includes('<build>\n<item objectid="1"/>\n</build>'));
  assert.equal((xml.match(/<vertex /g) || []).length, 7);   // 4 base (welded) + 3 braille
  assert.equal((xml.match(/<triangle /g) || []).length, 3);
});

test('export3MFVolumes: one volume per Braille block', async t => {
  const getBlob = captureDownload(t);
  const base = new Float32Array([
    0, 0, 0, 10, 0, 0, 0, 10, 0,
    10, 0, 0, 10, 10, 0, 0, 10, 0,
  ]);
  await export3MFVolumes([
    { name: 'Model', positions: base },
    { name: 'Wort1', positions: new Float32Array([1, 1, 0, 2, 1, 0, 1, 2, 0]) },
    { name: 'Wort2', positions: new Float32Array([5, 5, 0, 6, 5, 0, 5, 6, 0]) },
  ], 'mehr.3mf');
  const xml = strFromU8(unzipSync(new Uint8Array(await getBlob().arrayBuffer()))['3D/3dmodel.model']);
  assert.ok(xml.includes('<component objectid="2"/><component objectid="3"/><component objectid="4"/>'));
  assert.ok(xml.includes('<object id="3" type="model" name="Wort1">'));
  assert.ok(xml.includes('<object id="4" type="model" name="Wort2">'));
});

// ── Lock dependencies: standard proportions ──────────────────────────────────

test('BR_LOCK_DEPS: the defaults already satisfy every locked ratio', () => {
  for (const [child, dep] of Object.entries(BR_LOCK_DEPS)) {
    const derived = dep.f(BRAILLE_DEFAULTS[dep.parent]);
    assert.ok(
      Math.abs(derived - BRAILLE_DEFAULTS[child]) < 1e-9,
      `${child} default (${BRAILLE_DEFAULTS[child]}) should equal ${dep.parent} derived (${derived})`,
    );
  }
});

test('BR_LOCK_DEPS: derivation follows the parent value', () => {
  assert.ok(Math.abs(BR_LOCK_DEPS.cellSpacing.f(3) - 7.2) < 1e-9);   // ×2.4
  assert.equal(BR_LOCK_DEPS.wordSpacing.f(6), 8);     // +2 mm word gap
  assert.equal(BR_LOCK_DEPS.rowSpacing.f(3), 12);     // ×4
  assert.equal(BR_LOCK_DEPS.recessDepth.f(0.8), 0.8); // flush dot tops
});

# BrailleMesh

**Live:** https://stuff-by-rene.github.io/BrailleMesh/

A browser-based tool for adding Braille reliefs and displacement textures to 3D meshes — no installation required.

> **Fork of [BumpMesh by CNC Kitchen](https://github.com/CNCKitchen/stlTexturizer)** (AGPL-3.0).
> BrailleMesh makes the Braille workspace the default and keeps the original texture
> pipeline fully intact. Original author: Stefan Hermann — `LICENSE` and all copyright
> headers remain unchanged. The base project's history: [changelog.html](changelog.html).

Load a model, type a word, place Braille on its surfaces, and export a print-ready file — or switch to the texture workspace to displace surfaces with 101 built-in textures.

## Features

### Braille (default workspace)
- **Text blocks** — type a word, pick one of 8 Braille systems and add it to the pool
- **Place on the model** — drag a block onto any face; placements keep their own position, rotation and name
- **Raised or embedded** — proud dots, or a recessed frame with flush dot tops; the pocket is cut with true vertical walls on export
- **Black-print caption** — readable print under each line, for sighted readers; embossed captions export as their own colourable volume
- **Per-block parameters** — dot size/spacing/height/rounding, alignment, raster resolution
- **Fully localized** — the whole workspace is translated in all 16 UI languages
- **Separate-part export** — the Braille is its own printable volume in the 3MF

<details>
<summary><b>More features — texture workspace, viewer & file support (BumpMesh base)</b></summary>

### Textures
- **101 built-in seamless textures** in eight categories (geometric, patterns, organic, fabric, natural, grip, molded, tires): weaves, knurling, carbon twill, chainmail, scales, bark, wood grain, cobblestone, Japandi flutes and ripples, mold grains (sand matte, VDI spark erosion, leather, haircell), tire treads (touring, mud-terrain, truck rib, tractor, loader), Hero Patterns and more
- **Texture Gallery** — browse, search and filter the full catalogue in a side panel that takes the settings sidebar's place and stays open while you try textures on the model (click or arrow keys; the model spins on a turntable while you browse); star favorites to pin them in the panel grid, which grows by a row per 4 (saved in the browser)
- **Custom textures** — upload your own image as a displacement map, or an ideaMaker `.texture` file; uploads are kept under "Your textures" in the gallery (this browser only, and the browser may clear them at any time) where you can star, re-download or delete them
- **Texture smoothing** — configurable blur to soften the displacement map before applying

### Projection Modes
- **Triplanar** (default) — blends three planar projections based on surface normals; best for complex shapes
- **Cubic (Box)** — projects from 6 box faces with edge-seam blending and smart axis dominance
- **Cylindrical** — wraps texture around a cylindrical axis with configurable cap angle
- **Spherical** — maps texture spherically around the object
- **Planar XY / XZ / YZ** — flat axis-aligned projections

### UV & Transform Controls
- **Scale U/V** — independent or locked scaling (0.05–10×, logarithmic)
- **Offset U/V** — position the texture on each axis
- **Rotation** — rotate texture before projection
- **Seam Blend Strength** — softens hard edges where Cubic/Cylindrical projection faces meet
- **Seam Band Width** — controls blending zone width at seam edges
- **Cap Angle** (Cylindrical) — threshold for switching to top/bottom cap projection

### Displacement
- **Amplitude** — scales displacement depth from 0 % to 100 %
- **Symmetric displacement** — 50 % grey stays neutral, white pushes out, black pushes in (preserves volume)
- **3D displacement preview** — real-time GPU-accelerated preview toggle showing actual vertex displacement
- **Amplitude overlap warning** — alerts when depth exceeds 10 % of the smallest model dimension

### Texture Layers
- **Several textures on one model** — up to four layers, each with its own texture, projection, size, height and painted surface; the sidebar always edits the highlighted layer, whose surfaces show in teal while everything else is grey
- **Cover or add** — a layer covers the layers below where it is painted, or adds its relief to them
- **New layers start empty** in Include Only mode with the fill tool ready: click the surfaces the texture should cover
- Layers, their paint and their textures are saved in `.bumpmesh` projects; **Bake Textures** flattens them into the mesh when needed

### Surface Masking
- **Angle masking** — suppress texture on near-horizontal top and/or bottom faces (0°–90° threshold each)
- **Surface painting** — paint surfaces to exclude (orange) or exclusively include them
  - Circle brush, **Precision** mode (default) — refines the mesh under the stroke itself (after PrusaSlicer's paint-on tool), so the stroke edge is as fine on a 12-triangle cube as on a scan; the base mesh is never modified
  - Circle brush, **Standard** mode — marks every whole triangle the brush touches (highlighted while hovering), so a quick smudge selects the flat faces of a CAD model
  - Hardness (Precision) — a soft brush fades the mask out toward the rim for gradual texture borders
  - Single-triangle brush and bucket fill — flood-fills adjacent faces up to a configurable dihedral-angle threshold
  - Erase — hold Shift to undo painted surfaces
  - Clear all — reset the layer's paint

### Mesh Processing
- **Adaptive subdivision** — subdivides edges until they are ≤ a target length; respects sharp creases (>30° dihedral)
- **QEM decimation** — simplifies the result to a target triangle count using Quadric Error Metrics with boundary protection, link-condition checks, normal-flip rejection, and crease preservation
- **Mesh diagnostics** — automatic checks for open edges and shell count, with advanced diagnostics and overlay highlights for problem areas
- **Safety cap** — hard limit of 10 M triangles during subdivision to prevent out-of-memory

### 3D Viewer
- **Orbit / pan / zoom** controls
- **3Dconnexion SpaceMouse** — fly the view with the puck in Chrome and Edge: push/pull to zoom, slide to pan, tilt and twist to orbit (connects after the first touch of the puck)
- **Wireframe toggle** — visualise mesh topology
- **Section view** — cut the model open with a plane to see which inner surfaces (holes, cavities, the inside of hollow parts) get textured, and mask them right through the cut; X/Y/Z snap, flip, and drag handles to move or tilt the cut
- **Mesh info** — live triangle count, file size, bounding-box dimensions
- **Grid & axes indicator** — X = red, Y = green, Z = blue
- **Place on Face** — click a face to orient it downward onto the print bed

### File Support
- **.STL** — binary and ASCII
- **.OBJ** — via Three.js OBJLoader
- **.3MF** — ZIP-based format (via fflate decompression)
- **.STEP / .STP** — CAD B-rep files, tessellated in-browser by [meshStep](https://github.com/CNCKitchen/meshStep) with coarse / standard / fine quality presets

### Export
- Downloads a **binary STL** with displacement baked in
- Progress reporting through subdivision → displacement → decimation → writing stages
- Configurable edge-length threshold and output triangle limit

### Other
- **Light / Dark theme** — respects OS preference, persisted per browser
- **Multilingual** — 16 languages with auto-detection

</details>

## Usage

1. Open `index.html` in a modern browser (Chrome, Edge, Firefox, Safari).
2. Drop a model onto the viewport or click **Load STL…** (supports STL, OBJ, 3MF, STEP).
3. **Braille (default workspace)** — type a text, click **Add**, drag the block onto a face of the model and fine-tune it.
4. **Textures** — switch with the header toggle, pick a preset or upload your own image, choose a projection mode and adjust UV scale, offset, rotation, and amplitude.
5. Optionally mask or exclude surfaces with the angle sliders or paint tools.
6. Export as STL or 3MF.

> **Note:** All processing runs entirely in the browser — no data is uploaded to any server.

## How the Braille workspace works

BrailleMesh opens in the Braille workspace; the header toggle switches to the texture workspace and back.

1. **Add a block** — type a word, pick the Braille system (German Vollschrift/Kurzschrift, English UEB Grade 1/2, French, Spanish, Italian, Portuguese) and click **Add**. Blocks collect in the pool; each holds its text, parameters and the generated dot layout. New blocks default to the system of the UI language — a system you pick explicitly stays.
2. **Place it** — drag a block from the pool onto any face of the model: it snaps to that face. Click a placement to swing the view to it, rename it, or drag it along the face.
3. **Tune it** — every block carries its own parameters: dot diameter, dot/cell/word/row spacing, dot height and rounding, alignment, raster resolution. Edits apply to all of the block's placements; changing a single placement detaches it into its own block. Dependent parameters carry a lock: cell/word/row spacing and pocket depth follow their parent parameter at the standard ratio while locked — click the lock to set them independently. Changed values show a small reset arrow that restores just that parameter; **Reset parameters** (editor footer) restores every default.
4. **Raised or embedded** — raised: dots stand proud of the surface. Embedded: the whole block sits in one recessed frame, dot tops flush with the surface. The pocket walls are cut geometrically with true right angles on export (not displaced from the height map).
5. **Black-print caption** — optionally write the word as readable black print under each Braille line (raised or engraved), so sighted readers can check it.
6. **Export** — in the exported 3MF the Braille is a separate printable volume beside the base body, and an embossed caption becomes its own colourable volume too (engraved captions stay in the base — a recess cannot be a separate part); STL export carries the relief in the surface.

The example cube starts without a texture; the map you had active in your last session is restored automatically.

<details>
<summary><b>Technical details — project structure, local setup, dependencies, texture credits</b></summary>

### Project Structure

```
index.html            # Main entry point
style.css             # Styles (light / dark theme)
logo.png              # Favicon & header logo
dev-server.mjs        # Dev server (Cache-Control: no-cache)
textures/             # Built-in JPG/PNG displacement map images (101 textures) + thumbs/
js/
  main.js             # App bootstrap & UI wiring
  viewer.js           # Three.js scene / camera / controls
  stlLoader.js        # Binary & ASCII STL parser
  presetTextures.js   # Built-in texture presets (categories, credits, default favorites) + custom upload
  textureGallery.js   # Favorites grid + Texture Gallery side panel
  customTextures.js   # "Your textures": uploaded maps kept in this browser (IndexedDB)
  sidebarToggle.js    # Collapse / expand tab for the right-hand sidebar (settings or gallery)
  previewMaterial.js  # Three.js material for live & displacement preview
  previewPipeline.js  # 3D-preview mesh build (runs in previewWorker.js)
  mapping.js          # UV projection logic (7 modes)
  displacement.js     # Vertex displacement baking
  subdivision.js      # Adaptive mesh subdivision
  decimation.js       # QEM mesh decimation
  meshIndex.js        # Shared vertex welding + integer-pair hash maps
  exclusion.js        # Face exclusion / inclusion painting
  exporter.js         # Binary STL export
  i18n.js             # Translations (16 languages)
  braille.js          # Braille tables + depth-map rasteriser (Braille workspace)
  brailleBlocks.js    # Braille pool / editor / placements
  brailleSolid.js     # Separate-part solid export for Braille
  pocketCut.js        # Hard-walled pocket cut (manifold-3d boolean)
```

### Run Locally

All processing runs entirely in the browser — no backend or build step is needed. You just need a local HTTP server because browsers block ES module imports and texture loading from `file://` URLs.

```bash
# Clone the repository
git clone https://github.com/stuff-by-rene/BrailleMesh.git
cd BrailleMesh
```

Then start any static file server from the project root. Pick whichever you have installed:

**Node.js (included, recommended)**
```bash
node dev-server.mjs
```
Serves on http://localhost:8791 and sends `Cache-Control: no-cache`, so a plain reload always picks up the current files.

**Python (3.x)**
```bash
python -m http.server 8000
```

**Python (2.x)**
```bash
python -m SimpleHTTPServer 8000
```

**Node.js (npx, no install needed)**
```bash
npx serve .
```

**PHP**
```bash
php -S localhost:8000
```

Open http://localhost:8000 in your browser and you're ready to go.

> **Tip:** Any static server will work — the app has no server-side dependencies. Most simple servers don't send cache headers, so after updating a local copy the browser may mix new and old files — the included `node dev-server.mjs` avoids that with `Cache-Control: no-cache`.

**Docker / Podman**
```bash
docker compose up -d      # or: podman-compose -f podman-compose.yaml up -d
```
Serves the app on http://localhost:8080. To change the port or container name, copy `.env.example` to `.env` and edit it.

### Dependencies

Loaded via CDN ([jsDelivr](https://www.jsdelivr.com/)) — no build step or npm install needed:

| Library | Version | License | Usage |
|---------|---------|---------|-------|
| [Three.js](https://threejs.org/) | 0.170.0 | MIT | 3D rendering, scene management, materials |
| — [OrbitControls](https://threejs.org/docs/#examples/en/controls/OrbitControls) | 0.170.0 | MIT | Camera orbit / pan / zoom |
| — [STLLoader](https://threejs.org/docs/#examples/en/loaders/STLLoader) | 0.170.0 | MIT | Binary & ASCII STL import |
| — [OBJLoader](https://threejs.org/docs/#examples/en/loaders/OBJLoader) | 0.170.0 | MIT | OBJ mesh import |
| — [LineSegments2 / LineSegmentsGeometry / LineMaterial](https://threejs.org/docs/#examples/en/lines/LineSegments2) | 0.170.0 | MIT | Wide-line wireframe overlay |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.2 | MIT | ZIP compression & decompression for 3MF import/export |

All dependencies are MIT-licensed.

### Texture Credits

- Textures marked **HP** in the gallery are based on [Hero Patterns](https://heropatterns.com/) by Steve Schoger, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The SVG patterns were rasterised and converted to seamless heightmaps.
- Textures marked **CC0** come from [ambientCG](https://ambientcg.com/) and [Poly Haven](https://polyhaven.com/) and are in the public domain (CC0 1.0). Thank you to both projects.
- Textures marked **FF** (Basket, Brick, Bubble, Crystal, Leather 2, Weave 3) were made with [Filter Forge](https://www.filterforge.com/).

</details>

## License

GNU AGPL v3.0 — see [LICENSE](LICENSE).

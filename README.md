# Texture Memory Measurement — Byte-per-pixel, KTX2 Transcode Target and Driver Block Verification

<!-- LINKS:BEGIN — üretildi: scripts/sync-repo-links.py · elle düzenleme -->
**▶ [Live demo](https://m2-md.github.io/ktx2-vram-measurement/)** · [Source](https://github.com/m2-md/ktx2-vram-measurement)
<!-- LINKS:END -->

> Measuring actual GPU VRAM usage of compressed textures: block alignment, mipchain overhead, cubemap multiplier, KTX2 transcoding targets, and compressedTexImage2D probes.

Working code for the article "The Shipping Box Shrank, the Shelf Didn't: A Single 4K Texture
Is ~90 MB of VRAM and What KTX2 Actually Buys You". It turns the space a texture takes **on
the shelf** (in VRAM) into a formula, proves that formula deterministically with vitest, and
has **the driver itself** verify it in the browser: `compressedTexImage2D` rejects a
wrongly-sized buffer with `INVALID_VALUE`.

Shipping box = the space the file takes on disk/over the network (PNG, WebP). Shelf = the
space the texture takes in GPU memory. The two columns do not move in the same direction; the
demo shows them side by side.

This is the asset-pipeline branch of the Three.js 3D series. It shares the same
`RendererInfoLike` contract with its sibling project `threejs-dispose-vram-audit` (testing
without a GPU via a fake renderer), but its concern is different: leaks there, format and
budget here.

Version: `three@0.185.1` (r185), classic `WebGLRenderer`. It does not go near WebGPU.

## ⚠️ KTX2 files are NOT ENCODED in this project

Encoding KTX2/Basis requires a **global CLI** such as `toktx` (KTX-Software) or `basisu`;
there is no pure-JS encoder on npm. This repo installs no global tools and downloads no
assets. Therefore:

- The KTX2 file-size cell in the tables stays as **`— (not encoded)`**. No number is invented
  there.
- What is ACTUALLY measured instead are four things: the **formula**, the **transcode
  target**, the **driver block verification**, and the **PNG/WebP file size**.
- `KTX2Loader.detectSupport(renderer)` downloads no file and does not even start the
  transcoder — it only asks the GPU which compressed texture extensions are enabled. The demo
  prints that report.

## What's inside

- **`src/texture-memory.ts`** — the formula for the shelf. A 20-entry `FORMATS` table (block
  width/height/bytes), `bytesPerPixel`, `levelBytes` (block alignment via `Math.ceil`),
  `mipLevelCount` (`32 - Math.clz32(size)` — NOT `Math.log2`), `estimateTextureMemory` (mip
  chain + `layers`). It imports nothing; everyone else takes from it.
- **`src/three-format.ts`** — the `THREE.Texture` → format/level/layer/size bridge. Compressed
  format map, mip filter set, `isDepthTexture`/`isCompressedTexture`/`isCubeTexture` branches.
- **`src/texture-budget.ts`** — `TextureBudget`, which walks the scene graph and sums it up
  with the formula. The `Map` key is the texture **object itself** → a shared atlas is counted
  once. Instead of a fixed slot list, `addMaterial` scans ALL texture fields of the material
  with `Object.entries`. `crossCheck` claims no equality, it returns
  `{ counted, gpu, delta }`.
- **`src/transcode-target.ts`** — `detectFormatSupport` (raw WebGL extensions) +
  `pickTranscodeTarget`: a portable port of the ETC1S/UASTC subset of the `FORMAT_OPTIONS`
  priority table inside three's `KTX2Loader.js` (PVRTC and UASTC_HDR rows deliberately left
  out). ETC1S's ASTC priority is `Infinity` — ETC1S will not go to ASTC even on a device that
  supports ASTC. The ETC1 row has a SINGLE element (no alpha channel) and the
  `engineFormat.length < 2` guard keeps a texture with alpha from falling into that row.
- **`src/block-probe.ts`** — `probeBlockSize`: a TWO-WAY experiment. Is the correct size
  accepted (`NO_ERROR`), and is one byte short rejected (`INVALID_VALUE`)? If you only try to
  confirm a hypothesis, you fool yourself.
- **`src/file-size.ts`** — `encodedSizes`: real PNG/WebP bytes via `canvas.toBlob`. There is a
  `blob.type === mime` check: if the browser cannot produce WebP it silently returns PNG.
- **`src/procedural-texture.ts`** — `makeRng` (mulberry32) + `drawPattern`. The pattern is
  PROCEDURAL; no asset is downloaded. The noise parameter changes entropy (→ PNG bytes), not
  size (→ VRAM).
- **`src/budget-plan.ts`** — `howManyFit`, `MOBILE_TEXTURE_BUDGET_BYTES = 268_435_456`,
  `comparisonRows`.
- **`src/ktx2.ts`** — `createKTX2Loader` + `readWorkerConfig`. The transcoder path is
  `/basis/`; the files are copied from node_modules by `npm run prepare-basis`.
- **`src/main.ts` + `src/view/stage.ts` + `index.html`** — the browser demo (dark cinematic +
  neon). The measurement renderer = the presentation renderer; one context, one scene.

## Setup

```bash
npm install
```

`prepare-basis` runs automatically before `npm run dev` and `npm run build`
(`predev`/`prebuild`); if you want to run it by hand:

```bash
npm run prepare-basis   # node_modules/three/.../libs/basis → public/basis/ (NO DOWNLOAD)
```

## Test

```bash
npm test
```

47 tests — all deterministic, **NO WebGL/GPU REQUIRED** (they run in Node). `THREE.DataTexture`,
`MeshStandardMaterial`, `Scene`, `WebGLRenderTarget`, `CompressedTexture`, `CubeTexture` are
all constructed without a WebGL context.

Expected output:

```
 ✓ test/budget-plan.test.ts       (6 tests)
 ✓ test/texture-memory.test.ts   (12 tests)
 ✓ test/transcode-target.test.ts (12 tests)
 ✓ test/three-format.test.ts     (11 tests)
 ✓ test/texture-budget.test.ts    (6 tests)

 Test Files  5 passed (5)
      Tests  47 passed (47)
```

### The deterministic numbers the tests nail down

The code is always in bytes, the tables always in MiB. All of them are the output of
`estimateTextureMemory` — none of them is "approximately":

| Texture | Format | Base (B) | + mip chain (B) | MiB |
|---|---|---|---|---|
| 4096² | RGBA16F | 134,217,728 | 178,956,968 | 170.67 |
| 4096² | RGBA8 | 67,108,864 | **89,478,484** | 85.33 |
| 4096² | BC7 / ASTC 4×4 | 16,777,216 | 22,369,648 | 21.33 |
| 4096² | BC1 / ETC1 | 8,388,608 | 11,184,824 | 10.67 |
| 2048² | RGBA8 | 16,777,216 | 22,369,620 | 21.33 |
| 2048² | BC7 | 4,194,304 | 5,592,432 | 5.33 |
| 2048² | BC1 | 2,097,152 | 2,796,216 | 2.67 |
| 1000² (NPOT) | RGBA8 | 4,000,000 | 5,332,856 | 5.09 |

- **`×4/3` is an intuition, not a budget.** For 4096² RGBA8 the real number is 89,478,484 B,
  while `4/3 × 67,108,864` is 89,478,485.33 → a **1.33 byte** difference. On NPOT the
  deviation grows (5,332,856 vs 5,333,333.33); on compressed formats it flips direction
  because of block padding.
- **4096² BC7 (22,369,648) − 2048² RGBA8 (22,369,620) = 28 bytes.** Halving the resolution
  saves you almost exactly as much shelf space as switching to BC7 at full resolution.
- **A 256 MiB (268,435,456 B) mobile budget:** as mipped 4K textures, **3** RGBA8, **11** BC7,
  **23** BC1 fit. Three RGBA8 come to exactly 268,435,452 B — leaving **4 bytes**. With BC7
  the twelfth texture overshoots the budget by **320 bytes** (block padding in the tail mips).
- **The alpha channel doubles the shelf:** 4K BC1 10.67 MiB → BC3 21.33 MiB (exactly ×2).
- Block alignment: `levelBytes(5, 5, "BC1")` = **32** (2×2 blocks), not 12.5.
  `levelBytes(1, 1, "BC7")` = **16** — exactly the same as a 4×4 mip.

## Demo (browser)

```bash
npm run dev
```

`http://localhost:5173/` → cinematic scene + glass control panel.

> The demo needs a dev server. Opening `index.html` with `file://` gives you a **blank screen**
> (Vite resolves the bare module specifiers). Always use `npm run dev`.

### Buttons

| Button / control | What it does |
|---|---|
| **Generate 1024** / **Generate 2048** | Draws the procedural pattern into a `<canvas>` and uploads it to the GPU as a `CanvasTexture` (mip chain INCLUDED). |
| **Noise (entropy)** slider | 0 → flat gradient (small PNG) · 100 → per-pixel deviation (PNG climbs into megabytes). **Does not affect the VRAM column.** |
| **Measure budget** | `TextureBudget` walks the scene, prints the table and the `crossCheck` result. |
| **Measure file size (PNG/WebP)** | Real bytes via `canvas.toBlob`. History accumulates in the table: change the noise and regenerate, PNG moves / VRAM stays put. |
| **Validate block size (GPU)** | For every supported format, a 256×256 (full block) and a 250×250 (partial block, needs `ceil`) probe. Every row should show `exactAccepted ✓` and `shortRejected ✓`. |
| **Flush (dispose)** | Detaches the textures from the material and calls `dispose()`; `renderer.info.memory.textures` **should return to the baseline**. |
| **Spin** checkbox | **OFF** by default. While off there is no animation loop, rendering is on-demand. |

### The demo is deliberately LIGHT

It would be ironic for a tool that measures budgets to leak on its own — and hammering the
machine would be even worse. So:

- At most **2** live large textures at a time. If a third is generated, the oldest is disposed
  automatically (first `material.map = null`, THEN `texture.dispose()` — in the reverse order
  three re-uploads from the canvas on the next render and the counter climbs back up).
- The procedural generation ceiling is **2048**. **4096 is never generated**; the 4K rows are
  only CALCULATED and shown in the table with a `calculated` label.
- **No automatic sweeping, no automatic measurement.** Every measurement is triggered by a
  button.
- The scene has at most 3 meshes, **no shadows**, **no post-processing**, `pixelRatio ≤ 1.5`.

### The measurement precondition (without it, you fool yourself)

`renderer.info.memory.textures` only counts textures that have been **uploaded** to the GPU. A
texture does not enter the counter until the mesh that uses it is drawn for the first time.
That is why the demo calls a single `renderer.render()` after every action and does the
`crossCheck` **after the render**. Also, `delta` is **not expected** to be zero: the renderer
counts things we do not walk (shadow maps, PMREM intermediate targets, the default 1×1 white
texture). The job of `delta` is not to prove equality, it is to raise an alarm.

Because the block probe calls raw `gl.compressedTexImage2D`, it confuses three's state cache;
the demo calls `renderer.resetState()` after the probe.

## Build

```bash
npm run build   # prepare-basis && tsc && vite build → dist/
```

## Article ↔ code parity

All 15 TypeScript blocks in the article are found verbatim in these files. The `TARGETS` table
is marked with `// prettier-ignore` because it preserves column alignment; `.prettierrc`
(`printWidth: 120`) keeps the one-line `FORMATS` entries from the article from being wrapped.
Blocks labeled `(relevant part)` / `(excerpt)` only drop the `import` lines.

## License

MIT — see `LICENSE`.

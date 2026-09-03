// main.ts — browser demo. Cannot be opened with `file://` (blank screen) → `npm run dev` (Vite).
//
// Contract (as described in the article):
//   · at most 2 live large textures at the same time; a third disposes the oldest
//   · procedural generation upper limit is 2048; 4K rows are ONLY CALCULATED
//   · no automatic garbage collection — every measurement is triggered by button
//   · "Flush" disposes textures and returns renderer.info.memory.textures to baseline
import * as THREE from "three";
import { createStage } from "./view/stage";
import { TextureBudget } from "./texture-budget";
import { estimateTextureMemory, formatBytes, type FormatKey } from "./texture-memory";
import { detectFormatSupport, pickTranscodeTarget } from "./transcode-target";
import { createKTX2Loader, readWorkerConfig } from "./ktx2";
import { availableCompressedFormats, probeBlockSize, type BlockProbeResult } from "./block-probe";
import { encodedSizes } from "./file-size";
import { drawPattern } from "./procedural-texture";
import { MOBILE_TEXTURE_BUDGET_BYTES, comparisonRows } from "./budget-plan";

const MAX_LIVE = 2; // number of large textures that can remain live concurrently
const MAX_SIZE = 2048; // upper limit for procedural generation

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
};

const stage = createStage($("stage"));
const { renderer } = stage;
const gl = renderer.getContext() as WebGL2RenderingContext;
const budget = new TextureBudget();

// Baseline: counter value when no textures have been generated. "Flush" must return here.
stage.render();
const baseline = renderer.info.memory.textures; // COUNT of textures in GPU — NOT bytes

interface LiveTexture {
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  size: number;
  noise: number;
  slot: number;
}

const live: LiveTexture[] = [];
let noise = 0;

// --- measurement history (cargo vs shelf) ---
interface SizeRow {
  size: number;
  noise: number;
  png: number;
  webp: number;
  webpSupported: boolean;
  vram: number;
}
const sizeRows: SizeRow[] = [];

// ---------------------------------------------------------------- helpers

const num = (n: number): string => n.toLocaleString("en-US");
const mark = (ok: boolean): string => (ok ? '<span class="yes">✓</span>' : '<span class="no">✗</span>');

function table(headers: string[], rows: string[][], numericFrom = 1): string {
  const head = headers.map((h) => `<th>${h}</th>`).join("");
  const body = rows
    .map((cells) => {
      const tds = cells.map((c, i) => `<td class="${i >= numericFrom ? "num" : ""}">${c}</td>`).join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function setVerdict(html: string): void {
  $("verdict").innerHTML = html;
}

function refreshStats(): void {
  const textures = renderer.info.memory.textures;
  $("statTextures").textContent = String(textures);
  $("statBaseline").textContent = String(baseline);
  $("statLive").textContent = `${live.length} / ${MAX_LIVE}`;

  const totalBytes = live.reduce(
    (sum, l) => sum + estimateTextureMemory(l.size, l.size, "RGBA8", { mipmaps: true }),
    0,
  );
  $("statBudget").textContent = totalBytes === 0 ? "0 B" : formatBytes(totalBytes);

  const el = $("statTextures");
  el.className = textures === baseline ? "v ok" : "v warn";
}

// ------------------------------------------------------------ generate / flush textures

function generate(size: number): void {
  const clamped = Math.min(size, MAX_SIZE); // 4096 IS NOT GENERATED
  if (live.length >= MAX_LIVE) disposeOne(0); // oldest gets removed

  const slot = live.length === 0 ? 0 : live[0].slot === 0 ? 1 : 0;
  const canvas = document.createElement("canvas");
  drawPattern(canvas, clamped, { seed: 1337, noise });

  // CanvasTexture default: generateMipmaps = true, minFilter = LinearMipmapLinear
  // → mip chain EXISTS, meaning ×4/3 is active.
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.name = `pattern ${clamped}² (noise ${noise})`;

  const material = stage.slots[slot];
  material.map = texture;
  material.needsUpdate = true;

  live.push({ texture, canvas, size: clamped, noise, slot });
  stage.render(); // UPLOAD to GPU — counter increments only after render

  refreshStats();
  setVerdict(
    `<b>${clamped}²</b> texture generated (noise ${noise}). On shelf: ` +
      `${formatBytes(estimateTextureMemory(clamped, clamped, "RGBA8", { mipmaps: true }))} — ` +
      `independent of file size.`,
  );
}

function disposeOne(index: number): void {
  const item = live[index];
  if (!item) return;
  // detach from material first, then dispose. In reverse order, three reloads
  // from canvas on the next render and the counter climbs back up.
  const material = stage.slots[item.slot];
  material.map = null;
  material.needsUpdate = true;
  item.texture.dispose();
  item.canvas.width = 1; // release buffer on CPU side too
  item.canvas.height = 1;
  live.splice(index, 1);
}

function flush(): void {
  while (live.length > 0) disposeOne(0);
  budget.clear();
  stage.render();
  refreshStats();
  $("budgetPanel").innerHTML = '<div class="empty">— budget flushed.</div>';

  const textures = renderer.info.memory.textures;
  setVerdict(
    textures === baseline
      ? `Flushed. <code>info.memory.textures</code> = <b>${textures}</b> — matches baseline (${baseline}). ` +
          `The budget measurement tool does not leak.`
      : `Flushed but counter is ${textures}, baseline is ${baseline}. A reference remains somewhere.`,
  );
}

// --------------------------------------------------------------- measure budget

function measureBudget(): void {
  stage.render(); // render BEFORE crossCheck: counter only sees uploaded textures
  budget.clear();
  budget.addScene(stage.scene);

  const rows = budget.table();
  const cross = budget.crossCheck(renderer);

  if (rows.length === 0) {
    $("budgetPanel").innerHTML =
      '<div class="empty">— no textures to measure in scene. First click <code>Generate 1024</code> or <code>Generate 2048</code>.</div>';
  } else {
    const html =
      table(
        ["SLOT", "SIZE", "FORMAT", "MIP", "LAYER", "BYTES", "MiB"],
        rows.map((e) => [
          e.name,
          `${e.width}×${e.height}`,
          e.format,
          String(e.levels),
          String(e.layers),
          num(e.bytes),
          (e.bytes / 1048576).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        ]),
      ) +
      `<div class="empty">TOTAL <b>${formatBytes(budget.totalBytes)}</b> · ` +
      `crossCheck: counted ${cross.counted}, GPU counter ${cross.gpu}, delta ${cross.delta} ` +
      `<span class="dim">(delta is not expected to be zero)</span></div>`;
    $("budgetPanel").innerHTML = html;
  }

  refreshStats();
  setVerdict(
    `Counter reports <b>${cross.gpu}</b> textures; formula reports <b>${formatBytes(budget.totalBytes)}</b>. ` +
      `The difference between three numbers and one number is a chasm here.`,
  );
}

// ------------------------------------------------------- measure file size

async function measureFileSize(): Promise<void> {
  const item = live[live.length - 1];
  if (!item) {
    setVerdict("Generate a texture first — no <code>&lt;canvas&gt;</code> to measure.");
    return;
  }

  const button = $("filesize") as HTMLButtonElement;
  button.disabled = true;
  try {
    const sizes = await encodedSizes(item.canvas);
    const png = sizes.find((s) => s.mime === "image/png");
    const webp = sizes.find((s) => s.mime === "image/webp");
    sizeRows.unshift({
      size: item.size,
      noise: item.noise,
      png: png?.bytes ?? 0,
      webp: webp?.bytes ?? 0,
      webpSupported: webp?.supported ?? false,
      vram: estimateTextureMemory(item.size, item.size, "RGBA8", { mipmaps: true }),
    });
    renderSizePanel();

    const vramFixed = sizeRows.every((r) => r.size !== item.size || r.vram === sizeRows[0].vram);
    setVerdict(
      `PNG <b>${num(sizeRows[0].png)} B</b>, WebP <b>${num(sizeRows[0].webp)} B</b>, VRAM ` +
        `<b>${num(sizeRows[0].vram)} B</b>. Change noise and regenerate: first two columns fluctuate, ` +
        `third ${vramFixed ? "remains fixed" : "changed (?!)"}.`,
    );
  } finally {
    button.disabled = false;
  }
}

function renderSizePanel(): void {
  const rows = sizeRows.map((r) => [
    `${r.size}²`,
    String(r.noise),
    num(r.png),
    r.webpSupported ? num(r.webp) : `${num(r.webp)} <span class="dim">(returned PNG)</span>`,
    '<span class="dim">— (not encoded)</span>',
    num(r.vram),
  ]);
  $("sizePanel").innerHTML =
    table(["TEXTURE", "NOISE", "PNG (B)", "WEBP q=0.85 (B)", "KTX2/ETC1S", "VRAM RGBA8+MIP (B)"], rows) +
    '<div class="empty">Cargo columns reflect content entropy; shelf column depends only on width, height, and format.</div>';
}

// ------------------------------------------------------ driver block validation

function runProbe(): void {
  const formats = availableCompressedFormats(gl);
  if (formats.length === 0) {
    $("probePanel").innerHTML =
      '<div class="empty">— this GPU/browser provides no compressed texture extensions. KTX2 unpacks to RGBA8 here: ZERO VRAM gain.</div>';
    return;
  }

  const results: (BlockProbeResult & { label: string })[] = [];
  for (const entry of formats) {
    for (const size of [256, 250]) {
      results.push({ ...probeBlockSize(gl, entry.key, entry.glFormat, size, size), label: entry.label });
    }
  }
  // raw GL calls confuse three's state cache; resync state.
  renderer.resetState();
  stage.render();

  const allPassed = results.every((r) => r.exactAccepted && r.shortRejected);
  $("probePanel").innerHTML =
    table(
      ["FORMAT", "SIZE", "EXPECTED BYTES", "EXACT SIZE ACCEPTED", "1 BYTE SHORT REJECTED"],
      results.map((r) => [
        r.label,
        `${r.width}×${r.height}`,
        num(r.expectedBytes),
        mark(r.exactAccepted),
        mark(r.shortRejected),
      ]),
    ) +
    `<div class="empty">${results.length} measurements · ${allPassed ? "all passed: formula matches driver exactly." : "some rows failed — check driver notes."}</div>`;

  setVerdict(
    allPassed
      ? `Driver verified the formula: in all ${results.length} measurements exact size was accepted, one byte short was rejected.`
      : `Some rows did not match expectations; see table. This is also a result — no fabricated numbers.`,
  );
}

// ------------------------------------------------------------------ GPU report

function renderGpuPanel(): void {
  const support = detectFormatSupport(gl);
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const gpuName = debug
    ? String(gl.getParameter((debug as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL))
    : "(WEBGL_debug_renderer_info disabled)";

  const loader = createKTX2Loader(renderer);
  const config = readWorkerConfig(loader);

  const supportRows: string[][] = [
    ["ASTC", mark(support.astc), config ? mark(config.astcSupported) : "—"],
    ["BPTC (BC7)", mark(support.bptc), config ? mark(config.bptcSupported) : "—"],
    ["S3TC (DXT)", mark(support.s3tc), config ? mark(config.dxtSupported) : "—"],
    ["ETC2", mark(support.etc2), config ? mark(config.etc2Supported) : "—"],
    ["ETC1", mark(support.etc1), config ? mark(config.etc1Supported) : "—"],
    ["PVRTC", mark(support.pvrtc), config ? mark(config.pvrtcSupported) : "—"],
  ];

  const choices: string[][] = (["ETC1S", "UASTC"] as const).flatMap((basisFormat) =>
    [false, true].map((hasAlpha) => {
      const choice = pickTranscodeTarget(support, basisFormat, hasAlpha);
      const bytes = estimateTextureMemory(2048, 2048, choice.format, { mipmaps: true });
      return [
        basisFormat,
        hasAlpha ? "with alpha" : "no alpha",
        choice.format,
        choice.compressed ? '<span class="yes">compressed</span>' : '<span class="no">RGBA8 — no gain</span>',
        num(bytes),
      ];
    }),
  );

  $("gpuPanel").innerHTML =
    `<div class="empty">GPU: <b>${gpuName}</b> · WebGL2: ${mark(renderer.capabilities.isWebGL2 !== false)}</div>` +
    table(["EXTENSION", "getExtension", "KTX2Loader.detectSupport"], supportRows) +
    `<div class="empty" style="margin-top:10px">Format target for a 2048² texture on this GPU:</div>` +
    table(["PAYLOAD", "ALPHA", "TARGET", "STATUS", "VRAM (B, INCL. MIP)"], choices, 2);
}

function renderPlanPanel(): void {
  const rows = comparisonRows(4096).map((r) => [
    `${r.label} <span class="tag calc">calculated</span>`,
    num(r.baseBytes),
    num(r.mippedBytes),
    (r.mippedBytes / 1048576).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    String(r.fits),
  ]);
  const demo = comparisonRows(2048).map((r) => [
    `${r.label} <span class="tag gpu">2048²</span>`,
    num(r.baseBytes),
    num(r.mippedBytes),
    (r.mippedBytes / 1048576).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    String(r.fits),
  ]);

  const bc7 = estimateTextureMemory(4096, 4096, "BC7", { mipmaps: true });
  const rgba2k = estimateTextureMemory(2048, 2048, "RGBA8", { mipmaps: true });

  $("planPanel").innerHTML =
    table(
      ["FORMAT", "4096² BASE (B)", "+ MIP CHAIN (B)", "MiB", `HOW MANY IN ${num(MOBILE_TEXTURE_BUDGET_BYTES)} B`],
      [...rows, ...demo],
    ) +
    `<div class="empty">4096² BC7 = ${num(bc7)} B · 2048² RGBA8 = ${num(rgba2k)} B · delta <b>${bc7 - rgba2k} bytes</b>. ` +
    `Halving the resolution saves nearly the exact same space on the shelf as switching to BC7 at full resolution.</div>`;
}

// ----------------------------------------------------------------------- events

$("gen1024").addEventListener("click", () => generate(1024));
$("gen2048").addEventListener("click", () => generate(2048));
$("measure").addEventListener("click", () => measureBudget());
$("flush").addEventListener("click", () => flush());
$("filesize").addEventListener("click", () => {
  void measureFileSize();
});

$("probe").addEventListener("click", () => {
  setVerdict("Querying driver…");
  // Blocking work: defer to next tick so status paints.
  // setTimeout instead of rAF — rAF halts in background tab, setTimeout runs.
  setTimeout(runProbe, 0);
});

const noiseInput = $("noise") as HTMLInputElement;
noiseInput.addEventListener("input", () => {
  noise = Number(noiseInput.value) / 100;
  $("noiseVal").textContent = noiseInput.value;
});

const spinInput = $("spin") as HTMLInputElement;
spinInput.addEventListener("change", () => stage.setSpinning(spinInput.checked));

// ------------------------------------------------------------------------- boot

renderGpuPanel();
renderPlanPanel();
refreshStats();

const FORMAT_SANITY: FormatKey[] = ["RGBA8", "BC7", "BC1"];
console.log(
  "[boot] baseline textures =",
  baseline,
  "· formula check:",
  FORMAT_SANITY.map((f) => `${f}=${estimateTextureMemory(4096, 4096, f, { mipmaps: true })}`).join(" "),
);

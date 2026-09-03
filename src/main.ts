// main.ts — tarayıcı demosu. `file://` ile AÇILMAZ (boş ekran) → `npm run dev` (Vite).
//
// Sözleşme (makale bunu tarif ediyor):
//   · aynı anda EN FAZLA 2 canlı büyük doku, üçüncüsü en eskisini dispose eder
//   · prosedürel üretim üst sınırı 2048; 4K satırları yalnızca HESAPLANIR
//   · otomatik süpürme YOK — her ölçüm düğmeyle tetiklenir
//   · "Boşalt" dokuları dispose eder ve renderer.info.memory.textures baseline'a döner
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

const MAX_LIVE = 2; // aynı anda canlı kalabilen büyük doku sayısı
const MAX_SIZE = 2048; // prosedürel üretim üst sınırı

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} yok`);
  return el;
};

const stage = createStage($("stage"));
const { renderer } = stage;
const gl = renderer.getContext() as WebGL2RenderingContext;
const budget = new TextureBudget();

// Baseline: hiç doku üretilmemişken sayaç kaç? "Boşalt" buraya dönmeli.
stage.render();
const baseline = renderer.info.memory.textures; // GPU'da duran doku SAYISI — bayt DEĞİL

interface LiveTexture {
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  size: number;
  noise: number;
  slot: number;
}

const live: LiveTexture[] = [];
let noise = 0;

// --- ölçüm geçmişi (kargo vs raf) ---
interface SizeRow {
  size: number;
  noise: number;
  png: number;
  webp: number;
  webpSupported: boolean;
  vram: number;
}
const sizeRows: SizeRow[] = [];

// ---------------------------------------------------------------- yardımcılar

const num = (n: number): string => n.toLocaleString("tr-TR");
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

// ------------------------------------------------------------ doku üret / boşalt

function generate(size: number): void {
  const clamped = Math.min(size, MAX_SIZE); // 4096 ÜRETİLMEZ
  if (live.length >= MAX_LIVE) disposeOne(0); // en eskisi gider

  const slot = live.length === 0 ? 0 : live[0].slot === 0 ? 1 : 0;
  const canvas = document.createElement("canvas");
  drawPattern(canvas, clamped, { seed: 1337, noise });

  // CanvasTexture varsayılanı: generateMipmaps = true, minFilter = LinearMipmapLinear
  // → mip zinciri VAR, yani ×4/3 devrede.
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.name = `desen ${clamped}² (gürültü ${noise})`;

  const material = stage.slots[slot];
  material.map = texture;
  material.needsUpdate = true;

  live.push({ texture, canvas, size: clamped, noise, slot });
  stage.render(); // GPU'ya YÜKLE — sayaç ancak render'dan sonra artar

  refreshStats();
  setVerdict(
    `<b>${clamped}²</b> doku üretildi (gürültü ${noise}). Rafta ` +
      `${formatBytes(estimateTextureMemory(clamped, clamped, "RGBA8", { mipmaps: true }))} — ` +
      `dosya boyutundan bağımsız.`,
  );
}

function disposeOne(index: number): void {
  const item = live[index];
  if (!item) return;
  // ÖNCE materyalden kopar, SONRA dispose et. Ters sırada yapılırsa three bir
  // sonraki render'da canvas'tan yeniden yükler ve sayaç geri tırmanır.
  const material = stage.slots[item.slot];
  material.map = null;
  material.needsUpdate = true;
  item.texture.dispose();
  item.canvas.width = 1; // CPU tarafındaki tamponu da bırak
  item.canvas.height = 1;
  live.splice(index, 1);
}

function flush(): void {
  while (live.length > 0) disposeOne(0);
  budget.clear();
  stage.render();
  refreshStats();
  $("budgetPanel").innerHTML = '<div class="empty">— bütçe boşaltıldı.</div>';

  const textures = renderer.info.memory.textures;
  setVerdict(
    textures === baseline
      ? `Boşaltıldı. <code>info.memory.textures</code> = <b>${textures}</b> — baseline (${baseline}) ile aynı. ` +
          `Bütçe ölçen araç kendi kendine sızdırmıyor.`
      : `Boşaltıldı ama sayaç ${textures}, baseline ${baseline}. Bir yerde referans kalmış.`,
  );
}

// --------------------------------------------------------------- bütçeyi ölç

function measureBudget(): void {
  stage.render(); // crossCheck'ten ÖNCE render: sayaç ancak yüklenmiş dokuları görür
  budget.clear();
  budget.addScene(stage.scene);

  const rows = budget.table();
  const cross = budget.crossCheck(renderer);

  if (rows.length === 0) {
    $("budgetPanel").innerHTML =
      '<div class="empty">— sahnede ölçülecek doku yok. Önce <code>1024 üret</code> ya da <code>2048 üret</code>.</div>';
  } else {
    const html =
      table(
        ["SLOT", "BOYUT", "FORMAT", "MIP", "KATMAN", "BAYT", "MiB"],
        rows.map((e) => [
          e.name,
          `${e.width}×${e.height}`,
          e.format,
          String(e.levels),
          String(e.layers),
          num(e.bytes),
          (e.bytes / 1048576).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        ]),
      ) +
      `<div class="empty">TOPLAM <b>${formatBytes(budget.totalBytes)}</b> · ` +
      `crossCheck: sayılan ${cross.counted}, GPU sayacı ${cross.gpu}, delta ${cross.delta} ` +
      `<span class="dim">(delta'nın sıfır olması beklenmez)</span></div>`;
    $("budgetPanel").innerHTML = html;
  }

  refreshStats();
  setVerdict(
    `Sayaç <b>${cross.gpu}</b> doku diyor; formül <b>${formatBytes(budget.totalBytes)}</b> diyor. ` +
      `Üç sayı ile bir sayı arasındaki fark burada uçurum.`,
  );
}

// ------------------------------------------------------- dosya boyutunu ölç

async function measureFileSize(): Promise<void> {
  const item = live[live.length - 1];
  if (!item) {
    setVerdict("Önce bir doku üretin — ölçülecek <code>&lt;canvas&gt;</code> yok.");
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
        `<b>${num(sizeRows[0].vram)} B</b>. Gürültüyü değiştirip yeniden üretin: ilk iki sütun oynar, ` +
        `üçüncüsü ${vramFixed ? "kıpırdamaz" : "değişti (?!)"}.`,
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
    r.webpSupported ? num(r.webp) : `${num(r.webp)} <span class="dim">(PNG döndü)</span>`,
    '<span class="dim">— (encode edilmedi)</span>',
    num(r.vram),
  ]);
  $("sizePanel").innerHTML =
    table(["DOKU", "GÜRÜLTÜ", "PNG (B)", "WEBP q=0.85 (B)", "KTX2/ETC1S", "VRAM RGBA8+MIP (B)"], rows) +
    '<div class="empty">Kargo sütunları içeriğin entropisine bakar; raf sütunu yalnızca genişlik, yükseklik ve formata.</div>';
}

// ------------------------------------------------------ sürücü blok doğrulaması

function runProbe(): void {
  const formats = availableCompressedFormats(gl);
  if (formats.length === 0) {
    $("probePanel").innerHTML =
      '<div class="empty">— bu GPU/tarayıcı hiçbir sıkıştırılmış doku uzantısı vermiyor. KTX2 burada RGBA8\'e açılır: VRAM kazancı SIFIR.</div>';
    return;
  }

  const results: (BlockProbeResult & { label: string })[] = [];
  for (const entry of formats) {
    for (const size of [256, 250]) {
      results.push({ ...probeBlockSize(gl, entry.key, entry.glFormat, size, size), label: entry.label });
    }
  }
  // Ham GL çağrıları three'nin state cache'ini şaşırtır; senkronu geri al.
  renderer.resetState();
  stage.render();

  const allPassed = results.every((r) => r.exactAccepted && r.shortRejected);
  $("probePanel").innerHTML =
    table(
      ["FORMAT", "BOYUT", "BEKLENEN BAYT", "TAM BOYUT KABUL", "1 BAYT EKSİK RED"],
      results.map((r) => [
        r.label,
        `${r.width}×${r.height}`,
        num(r.expectedBytes),
        mark(r.exactAccepted),
        mark(r.shortRejected),
      ]),
    ) +
    `<div class="empty">${results.length} ölçüm · ${allPassed ? "hepsi geçti: formül sürücüyle birebir." : "bazı satırlar geçmedi — sürücü notuna bakın."}</div>`;

  setVerdict(
    allPassed
      ? `Sürücü hesabı onayladı: ${results.length} ölçümün tamamında doğru boyut kabul edildi, bir bayt eksiği reddedildi.`
      : `Bazı satırlar beklendiği gibi çıkmadı; tabloya bakın. Bu da bir sonuçtur — uydurmuyoruz.`,
  );
}

// ------------------------------------------------------------------ GPU raporu

function renderGpuPanel(): void {
  const support = detectFormatSupport(gl);
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const gpuName = debug
    ? String(gl.getParameter((debug as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL))
    : "(WEBGL_debug_renderer_info kapalı)";

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
        hasAlpha ? "alfalı" : "alfasız",
        choice.format,
        choice.compressed ? '<span class="yes">sıkıştırılmış</span>' : '<span class="no">RGBA8 — kazanç yok</span>',
        num(bytes),
      ];
    }),
  );

  $("gpuPanel").innerHTML =
    `<div class="empty">GPU: <b>${gpuName}</b> · WebGL2: ${mark(renderer.capabilities.isWebGL2 !== false)}</div>` +
    table(["UZANTI", "getExtension", "KTX2Loader.detectSupport"], supportRows) +
    `<div class="empty" style="margin-top:10px">Bu GPU'da 2048² bir doku hangi formata açılır:</div>` +
    table(["YÜK", "ALFA", "HEDEF", "DURUM", "VRAM (B, MIP DÂHİL)"], choices, 2);
}

function renderPlanPanel(): void {
  const rows = comparisonRows(4096).map((r) => [
    `${r.label} <span class="tag calc">hesaplandı</span>`,
    num(r.baseBytes),
    num(r.mippedBytes),
    (r.mippedBytes / 1048576).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    String(r.fits),
  ]);
  const demo = comparisonRows(2048).map((r) => [
    `${r.label} <span class="tag gpu">2048²</span>`,
    num(r.baseBytes),
    num(r.mippedBytes),
    (r.mippedBytes / 1048576).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    String(r.fits),
  ]);

  const bc7 = estimateTextureMemory(4096, 4096, "BC7", { mipmaps: true });
  const rgba2k = estimateTextureMemory(2048, 2048, "RGBA8", { mipmaps: true });

  $("planPanel").innerHTML =
    table(
      ["FORMAT", "4096² TABAN (B)", "+ MİP ZİNCİRİ (B)", "MiB", `${num(MOBILE_TEXTURE_BUDGET_BYTES)} B'A KAÇ TANE`],
      [...rows, ...demo],
    ) +
    `<div class="empty">4096² BC7 = ${num(bc7)} B · 2048² RGBA8 = ${num(rgba2k)} B · fark <b>${bc7 - rgba2k} bayt</b>. ` +
    `Çözünürlüğü yarıya indirmek, tam çözünürlükte BC7'ye geçmekle rafta neredeyse birebir aynı yeri kazandırıyor.</div>`;
}

// ----------------------------------------------------------------------- olaylar

$("gen1024").addEventListener("click", () => generate(1024));
$("gen2048").addEventListener("click", () => generate(2048));
$("measure").addEventListener("click", () => measureBudget());
$("flush").addEventListener("click", () => flush());
$("filesize").addEventListener("click", () => {
  void measureFileSize();
});

$("probe").addEventListener("click", () => {
  setVerdict("Sürücüye soruluyor…");
  // Bloke edici iş: status'ün boyanması için bir sonraki tick'e bırak.
  // rAF DEĞİL setTimeout — arka plan sekmede rAF durur, setTimeout çalışır.
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
  "· formül kontrolü:",
  FORMAT_SANITY.map((f) => `${f}=${estimateTextureMemory(4096, 4096, f, { mipmaps: true })}`).join(" "),
);

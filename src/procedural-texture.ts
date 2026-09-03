// procedural-texture.ts — desen PROSEDÜREL üretilir; hiçbir varlık indirilmez.
// Tek amaç: kargo sütununu (PNG/WebP baytı) oynatırken raf sütununun (VRAM)
// kıpırdamadığını göstermek. Gürültü entropiyi değiştirir, boyutu değiştirmez.

/** mulberry32 — serideki diğer projelerle birebir aynı; seed sabit → desen deterministik. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PatternOptions {
  seed?: number;
  /** 0 → düz radyal gradyan (PNG küçük) · 1 → piksel başına rastgele sapma (PNG büyük) */
  noise?: number;
}

/**
 * `canvas`'ı `size × size` yapar ve deseni çizer. Gradyan + neon halkalar 2D bağlamda,
 * gürültü ise tek bir `ImageData` geçişinde uygulanır (piksel başına TEK RNG çağrısı;
 * aynı sapma R/G/B'ye farklı katsayılarla dağıtılır — kanal başına ayrı çağrı yok).
 */
export function drawPattern(canvas: HTMLCanvasElement, size: number, options: PatternOptions = {}): void {
  const { seed = 1337, noise = 0 } = options;
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D context alınamadı");

  // Düşük entropili taban: radyal gradyan + birkaç neon halka.
  const g = ctx.createRadialGradient(size * 0.42, size * 0.36, 0, size * 0.5, size * 0.5, size * 0.78);
  g.addColorStop(0, "#1b2740");
  g.addColorStop(0.45, "#0d1526");
  g.addColorStop(1, "#05070d");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const rings = 7;
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    ctx.strokeStyle = `rgba(${34 + t * 200}, ${211 - t * 60}, ${238 - t * 40}, ${0.5 - t * 0.35})`;
    ctx.lineWidth = Math.max(1, size / 256);
    ctx.beginPath();
    ctx.arc(size * 0.5, size * 0.5, size * (0.08 + t * 0.42), 0, Math.PI * 2);
    ctx.stroke();
  }

  if (noise <= 0) return;

  // Gürültü: entropiyi yükseltir → PNG/WebP büyür. VRAM'e etkisi SIFIR.
  const rng = makeRng(seed);
  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;
  const amount = Math.min(1, noise) * 255;
  for (let i = 0; i < data.length; i += 4) {
    const d = (rng() - 0.5) * amount;
    data[i] = clamp255(data[i] + d);
    data[i + 1] = clamp255(data[i + 1] + d * 0.85);
    data[i + 2] = clamp255(data[i + 2] + d * 1.15);
  }
  ctx.putImageData(image, 0, 0);
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

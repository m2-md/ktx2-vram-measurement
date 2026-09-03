// texture-memory.ts
export interface FormatSpec {
  label: string;
  blockWidth: number; // sıkıştırılmamış formatlarda 1
  blockHeight: number;
  blockBytes: number; // bir bloğun bayt karşılığı
  compressed: boolean;
}

export const FORMATS = {
  RGBA8: { label: "RGBA8", blockWidth: 1, blockHeight: 1, blockBytes: 4, compressed: false },
  RGB565: { label: "RGB565", blockWidth: 1, blockHeight: 1, blockBytes: 2, compressed: false },
  RGBA4444: { label: "RGBA4444", blockWidth: 1, blockHeight: 1, blockBytes: 2, compressed: false },
  R8: { label: "R8", blockWidth: 1, blockHeight: 1, blockBytes: 1, compressed: false },
  RG8: { label: "RG8", blockWidth: 1, blockHeight: 1, blockBytes: 2, compressed: false },
  RGBA16F: { label: "RGBA16F", blockWidth: 1, blockHeight: 1, blockBytes: 8, compressed: false },
  RGBA32F: { label: "RGBA32F", blockWidth: 1, blockHeight: 1, blockBytes: 16, compressed: false },
  DEPTH16: { label: "DEPTH16", blockWidth: 1, blockHeight: 1, blockBytes: 2, compressed: false },
  DEPTH24_STENCIL8: { label: "DEPTH24_STENCIL8", blockWidth: 1, blockHeight: 1, blockBytes: 4, compressed: false },

  BC1: { label: "BC1 (DXT1)", blockWidth: 4, blockHeight: 4, blockBytes: 8, compressed: true },
  BC2: { label: "BC2 (DXT3)", blockWidth: 4, blockHeight: 4, blockBytes: 16, compressed: true },
  BC3: { label: "BC3 (DXT5)", blockWidth: 4, blockHeight: 4, blockBytes: 16, compressed: true },
  BC5: { label: "BC5", blockWidth: 4, blockHeight: 4, blockBytes: 16, compressed: true },
  BC7: { label: "BC7 (BPTC)", blockWidth: 4, blockHeight: 4, blockBytes: 16, compressed: true },
  ETC1: { label: "ETC1", blockWidth: 4, blockHeight: 4, blockBytes: 8, compressed: true },
  ETC2_RGB: { label: "ETC2 RGB", blockWidth: 4, blockHeight: 4, blockBytes: 8, compressed: true },
  ETC2_RGBA: { label: "ETC2 RGBA (EAC)", blockWidth: 4, blockHeight: 4, blockBytes: 16, compressed: true },
  ASTC_4x4: { label: "ASTC 4x4", blockWidth: 4, blockHeight: 4, blockBytes: 16, compressed: true },
  ASTC_6x6: { label: "ASTC 6x6", blockWidth: 6, blockHeight: 6, blockBytes: 16, compressed: true },
  ASTC_8x8: { label: "ASTC 8x8", blockWidth: 8, blockHeight: 8, blockBytes: 16, compressed: true },
} as const satisfies Record<string, FormatSpec>;

export type FormatKey = keyof typeof FORMATS;

export function bytesPerPixel(format: FormatKey): number {
  const f = FORMATS[format];
  return f.blockBytes / (f.blockWidth * f.blockHeight);
}

export function levelBytes(width: number, height: number, format: FormatKey): number {
  const f = FORMATS[format];
  const cols = Math.ceil(Math.max(1, width) / f.blockWidth);
  const rows = Math.ceil(Math.max(1, height) / f.blockHeight);
  return cols * rows * f.blockBytes;
}

/** floor(log2(max(w,h))) + 1 — kayan nokta hatasına açık olmayan hâli. */
export function mipLevelCount(width: number, height: number): number {
  const size = Math.max(1, Math.max(width, height) | 0);
  return 32 - Math.clz32(size);
}

export interface MemoryOptions {
  mipmaps?: boolean;
  levels?: number; // hazır bir mip zinciri varsa (CompressedTexture.mipmaps.length)
  layers?: number; // cubemap = 6, array texture = katman sayısı
}

export function estimateTextureMemory(
  width: number,
  height: number,
  format: FormatKey,
  options: MemoryOptions = {},
): number {
  const { mipmaps = false, layers = 1 } = options;
  const levels = options.levels ?? (mipmaps ? mipLevelCount(width, height) : 1);
  let bytes = 0;
  for (let i = 0; i < levels; i++) {
    bytes += levelBytes(Math.max(1, width >> i), Math.max(1, height >> i), format);
  }
  return bytes * layers;
}

// --- sunum yardımcısı (makalede geçmez; paneller ve tablolar için) ---

/** Bayt → "89.478.484 B (85,33 MiB)". Kod hep bayt, ekran hep MiB. */
export function formatBytes(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  const mibText = mib.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${bytes.toLocaleString("tr-TR")} B (${mibText} MiB)`;
}

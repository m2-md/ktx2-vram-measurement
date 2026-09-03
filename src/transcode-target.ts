// transcode-target.ts
import { FORMATS, type FormatKey } from "./texture-memory";

export interface FormatSupport {
  astc: boolean;
  bptc: boolean;
  s3tc: boolean;
  etc2: boolean;
  etc1: boolean;
  pvrtc: boolean;
}

export const EXTENSION_NAMES = {
  astc: "WEBGL_compressed_texture_astc",
  bptc: "EXT_texture_compression_bptc",
  s3tc: "WEBGL_compressed_texture_s3tc",
  etc2: "WEBGL_compressed_texture_etc",
  etc1: "WEBGL_compressed_texture_etc1",
  pvrtc: "WEBGL_compressed_texture_pvrtc",
} as const;

export function detectFormatSupport(gl: WebGLRenderingContext | WebGL2RenderingContext): FormatSupport {
  const has = (name: string) => gl.getExtension(name) !== null;
  return {
    astc: has(EXTENSION_NAMES.astc),
    bptc: has(EXTENSION_NAMES.bptc),
    s3tc: has(EXTENSION_NAMES.s3tc),
    etc2: has(EXTENSION_NAMES.etc2),
    etc1: has(EXTENSION_NAMES.etc1),
    pvrtc: has(EXTENSION_NAMES.pvrtc) || has("WEBKIT_WEBGL_compressed_texture_pvrtc"),
  };
}

type BasisFormat = "ETC1S" | "UASTC";

interface TargetOption {
  requires: keyof FormatSupport | null;
  /** `[alfasız, alfalı]`. TEK elemanlı satır = o format alfa taşıyamaz. */
  engineFormat: readonly FormatKey[];
  priorityETC1S: number;
  priorityUASTC: number;
  needsPowerOfTwo: boolean;
}

// three'nin KTX2Loader.js dosyasındaki FORMAT_OPTIONS tablosunun ETC1S/UASTC alt kümesi
// (PVRTC ve UASTC_HDR satırları bilerek dışarıda — bu projede o formatlar yok)
//
// Dizi UZUNLUKLARI da tablonun bir parçası: ETC1'in alfa kanalı yoktur, o yüzden
// three'de o satır tek elemanlıdır ve alfa istendiğinde atlanır. Satırı ["ETC1","ETC1"]
// diye doldurmak alfayı bedava gösterir ve VRAM'i 2×–8× EKSİK tahmin ettirir.
// prettier-ignore
const TARGETS: readonly TargetOption[] = [
  { requires: "astc",  engineFormat: ["ASTC_4x4", "ASTC_4x4"],  priorityETC1S: Infinity, priorityUASTC: 1, needsPowerOfTwo: false },
  { requires: "bptc",  engineFormat: ["BC7", "BC7"],            priorityETC1S: 3,        priorityUASTC: 2, needsPowerOfTwo: false },
  { requires: "s3tc",  engineFormat: ["BC1", "BC3"],            priorityETC1S: 4,        priorityUASTC: 5, needsPowerOfTwo: false },
  { requires: "etc2",  engineFormat: ["ETC2_RGB", "ETC2_RGBA"], priorityETC1S: 1,        priorityUASTC: 3, needsPowerOfTwo: false },
  { requires: "etc1",  engineFormat: ["ETC1"],                  priorityETC1S: 2,        priorityUASTC: 4, needsPowerOfTwo: false },
  { requires: null,    engineFormat: ["RGBA8", "RGBA8"],        priorityETC1S: 100,      priorityUASTC: 100, needsPowerOfTwo: false },
];

export interface TranscodeChoice {
  format: FormatKey;
  compressed: boolean;
}

export function pickTranscodeTarget(
  support: FormatSupport,
  basisFormat: BasisFormat,
  hasAlpha: boolean,
): TranscodeChoice {
  const key = basisFormat === "ETC1S" ? "priorityETC1S" : "priorityUASTC";
  const sorted = [...TARGETS].sort((a, b) => a[key] - b[key]);
  for (const opt of sorted) {
    if (opt.requires && !support[opt.requires]) continue;
    if (basisFormat === "ETC1S" && opt.priorityETC1S === Infinity) continue;
    // three'nin koruması: alfa isteniyorsa alfa taşıyamayan satırı atla.
    // ETC1-var / ETC2-yok bir GPU'da alfalı doku ETC1'e DEĞİL, bir sonraki
    // uygun hedefe (BC3/BC7) ya da RGBA8'e gider.
    if (hasAlpha && opt.engineFormat.length < 2) continue;
    const format = opt.engineFormat[hasAlpha ? 1 : 0];
    return { format, compressed: FORMATS[format].compressed };
  }
  return { format: "RGBA8", compressed: false };
}

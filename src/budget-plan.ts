// budget-plan.ts
import { estimateTextureMemory, type FormatKey } from "./texture-memory";

export function howManyFit(budgetBytes: number, perTextureBytes: number): number {
  return Math.floor(budgetBytes / perTextureBytes);
}

/**
 * Orta seviye bir mobil cihazda doku için ayırabileceğiniz gerçekçi pay: 256 MiB.
 * Spesifikasyon değil, saha kuralı — ama hesap yapmak için bir sayı gerekiyor.
 */
export const MOBILE_TEXTURE_BUDGET_BYTES = 268_435_456;

export interface ComparisonRow {
  format: FormatKey;
  label: string;
  /** Taban seviye (mip yok) */
  baseBytes: number;
  /** Tam mip zinciriyle */
  mippedBytes: number;
  /** 256 MiB bütçeye kaç tane sığar (mip dâhil) */
  fits: number;
}

/** Makaledeki karşılaştırma tablosunun tek kaynağı: aynı doku, dört formatta. */
export function comparisonRows(size: number, budgetBytes = MOBILE_TEXTURE_BUDGET_BYTES): ComparisonRow[] {
  const formats: { format: FormatKey; label: string }[] = [
    { format: "RGBA16F", label: "RGBA16F" },
    { format: "RGBA8", label: "RGBA8" },
    { format: "BC7", label: "BC7 / ASTC 4×4" },
    { format: "BC1", label: "BC1 / ETC1S" },
  ];

  return formats.map(({ format, label }) => {
    const mippedBytes = estimateTextureMemory(size, size, format, { mipmaps: true });
    return {
      format,
      label,
      baseBytes: estimateTextureMemory(size, size, format),
      mippedBytes,
      fits: howManyFit(budgetBytes, mippedBytes),
    };
  });
}

// budget-plan.ts
import { estimateTextureMemory, type FormatKey } from "./texture-memory";

export function howManyFit(budgetBytes: number, perTextureBytes: number): number {
  return Math.floor(budgetBytes / perTextureBytes);
}

/**
 * Realistic texture budget share for a mid-range mobile device: 256 MiB.
 * Not a specification, but a field rule of thumb — yet a number is needed for calculation.
 */
export const MOBILE_TEXTURE_BUDGET_BYTES = 268_435_456;

export interface ComparisonRow {
  format: FormatKey;
  label: string;
  /** Base level (no mips) */
  baseBytes: number;
  /** With full mip chain */
  mippedBytes: number;
  /** How many fit into 256 MiB budget (including mips) */
  fits: number;
}

/** Single source of truth for the article's comparison table: same texture in four formats. */
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

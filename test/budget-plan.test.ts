// budget-plan.test.ts
import { describe, expect, it } from "vitest";
import { MOBILE_TEXTURE_BUDGET_BYTES, comparisonRows, howManyFit } from "../src/budget-plan";

const BUDGET = MOBILE_TEXTURE_BUDGET_BYTES;

describe("256 MiB'lık rafa ne sığar", () => {
  it("bütçe 256 MiB = 268.435.456 bayt", () => {
    expect(BUDGET).toBe(268_435_456);
    expect(BUDGET / (1024 * 1024)).toBe(256);
  });

  it("mip'li 4K RGBA8 → 3 tane, bütçeden 4 bayt artar", () => {
    expect(howManyFit(BUDGET, 89_478_484)).toBe(3);
    expect(BUDGET - 3 * 89_478_484).toBe(4);
  });

  it("mip'li 4K BC7 → 11 tane; 12'nci bütçeyi 320 baytla aşar", () => {
    expect(howManyFit(BUDGET, 22_369_648)).toBe(11);
    expect(12 * 22_369_648 - BUDGET).toBe(320);
  });

  it("mip'li 4K BC1 → 23 tane", () => {
    expect(howManyFit(BUDGET, 11_184_824)).toBe(23);
  });

  it("comparisonRows(4096) makaledeki tabloyu birebir üretir", () => {
    const rows = comparisonRows(4096);
    expect(rows.map((r) => [r.label, r.baseBytes, r.mippedBytes, r.fits])).toEqual([
      ["RGBA16F", 134_217_728, 178_956_968, 1],
      ["RGBA8", 67_108_864, 89_478_484, 3],
      ["BC7 / ASTC 4×4", 16_777_216, 22_369_648, 11],
      ["BC1 / ETC1S", 8_388_608, 11_184_824, 23],
    ]);
  });

  it("comparisonRows(2048) demo satırlarını üretir", () => {
    const rows = comparisonRows(2048);
    const byFormat = new Map(rows.map((r) => [r.format, r]));
    expect(byFormat.get("RGBA8")?.mippedBytes).toBe(22_369_620);
    expect(byFormat.get("BC7")?.mippedBytes).toBe(5_592_432);
    expect(byFormat.get("BC1")?.mippedBytes).toBe(2_796_216);
  });
});

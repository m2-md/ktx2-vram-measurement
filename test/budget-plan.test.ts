// budget-plan.test.ts
import { describe, expect, it } from "vitest";
import { MOBILE_TEXTURE_BUDGET_BYTES, comparisonRows, howManyFit } from "../src/budget-plan";

const BUDGET = MOBILE_TEXTURE_BUDGET_BYTES;

describe("what fits on a 256 MiB shelf", () => {
  it("budget 256 MiB = 268,435,456 bytes", () => {
    expect(BUDGET).toBe(268_435_456);
    expect(BUDGET / (1024 * 1024)).toBe(256);
  });

  it("mipped 4K RGBA8 → 3 textures, 4 bytes remain from budget", () => {
    expect(howManyFit(BUDGET, 89_478_484)).toBe(3);
    expect(BUDGET - 3 * 89_478_484).toBe(4);
  });

  it("mipped 4K BC7 → 11 textures; 12th exceeds budget by 320 bytes", () => {
    expect(howManyFit(BUDGET, 22_369_648)).toBe(11);
    expect(12 * 22_369_648 - BUDGET).toBe(320);
  });

  it("mipped 4K BC1 → 23 textures", () => {
    expect(howManyFit(BUDGET, 11_184_824)).toBe(23);
  });

  it("comparisonRows(4096) reproduces the article table exactly", () => {
    const rows = comparisonRows(4096);
    expect(rows.map((r) => [r.label, r.baseBytes, r.mippedBytes, r.fits])).toEqual([
      ["RGBA16F", 134_217_728, 178_956_968, 1],
      ["RGBA8", 67_108_864, 89_478_484, 3],
      ["BC7 / ASTC 4×4", 16_777_216, 22_369_648, 11],
      ["BC1 / ETC1S", 8_388_608, 11_184_824, 23],
    ]);
  });

  it("comparisonRows(2048) produces demo rows", () => {
    const rows = comparisonRows(2048);
    const byFormat = new Map(rows.map((r) => [r.format, r]));
    expect(byFormat.get("RGBA8")?.mippedBytes).toBe(22_369_620);
    expect(byFormat.get("BC7")?.mippedBytes).toBe(5_592_432);
    expect(byFormat.get("BC1")?.mippedBytes).toBe(2_796_216);
  });
});

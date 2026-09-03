// texture-memory.test.ts
import { describe, expect, it } from "vitest";
import { estimateTextureMemory, levelBytes, mipLevelCount } from "../src/texture-memory";

describe("bytes-per-pixel formula", () => {
  it("4096² RGBA8, no mipmaps → 67,108,864 bytes (64 MiB)", () => {
    expect(estimateTextureMemory(4096, 4096, "RGBA8")).toBe(67_108_864);
  });

  it("4096² RGBA8, with mip chain → 89,478,484 bytes", () => {
    const bytes = estimateTextureMemory(4096, 4096, "RGBA8", { mipmaps: true });
    expect(bytes).toBe(89_478_484);
    // ×4/3 is an UPPER BOUND, not exact equality
    expect(bytes).toBeLessThan((67_108_864 * 4) / 3);
    expect(bytes / 67_108_864).toBeCloseTo(4 / 3, 6);
  });

  it("mip chain length: 4096→13, 1024→11, 1→1, NPOT 1000→10", () => {
    expect(mipLevelCount(4096, 4096)).toBe(13);
    expect(mipLevelCount(1024, 256)).toBe(11); // long edge determines
    expect(mipLevelCount(1, 1)).toBe(1);
    expect(mipLevelCount(1000, 1000)).toBe(10);
  });

  it("NPOT 1000² RGBA8 mip chain remains BELOW ×4/3 approximation", () => {
    expect(estimateTextureMemory(1000, 1000, "RGBA8", { mipmaps: true })).toBe(5_332_856);
  });

  it("compressed format block alignment: partial block counts as full block", () => {
    expect(levelBytes(4, 4, "BC1")).toBe(8); // one full block
    expect(levelBytes(5, 5, "BC1")).toBe(32); // 2×2 blocks — NOT 12.5
    expect(levelBytes(1, 1, "BC7")).toBe(16); // even 1×1 mip is a full block
    expect(levelBytes(250, 250, "BC7")).toBe(63 * 63 * 16);
    expect(levelBytes(1024, 1024, "ASTC_8x8")).toBe(128 * 128 * 16);
  });

  it("cubemap multiplier ×6, each layer carries its own mip chain", () => {
    const face = estimateTextureMemory(512, 512, "RGBA8", { mipmaps: true });
    const cube = estimateTextureMemory(512, 512, "RGBA8", { mipmaps: true, layers: 6 });
    expect(cube).toBe(face * 6);
  });

  it("4K BC7 and 2K RGBA8 occupy same shelf space (28 bytes difference)", () => {
    const bc7 = estimateTextureMemory(4096, 4096, "BC7", { mipmaps: true });
    const rgba2k = estimateTextureMemory(2048, 2048, "RGBA8", { mipmaps: true });
    expect(bc7).toBe(22_369_648);
    expect(rgba2k).toBe(22_369_620);
    expect(bc7 - rgba2k).toBe(28);
  });
});

describe("formula — other cells mentioned as a table in article", () => {
  it("4096² RGBA16F mipped → 178,956,968 bytes (170.67 MiB)", () => {
    expect(estimateTextureMemory(4096, 4096, "RGBA16F")).toBe(134_217_728);
    expect(estimateTextureMemory(4096, 4096, "RGBA16F", { mipmaps: true })).toBe(178_956_968);
  });

  it("4096² BC1/ETC1 mipped → 11,184,824 bytes (10.67 MiB)", () => {
    expect(estimateTextureMemory(4096, 4096, "BC1")).toBe(8_388_608);
    expect(estimateTextureMemory(4096, 4096, "BC1", { mipmaps: true })).toBe(11_184_824);
    expect(estimateTextureMemory(4096, 4096, "ETC1", { mipmaps: true })).toBe(11_184_824);
  });

  it("2048² demo texture: BC7 5,592,432 · BC1 2,796,216 · RGBA8 without mips 16,777,216", () => {
    expect(estimateTextureMemory(2048, 2048, "RGBA8")).toBe(16_777_216);
    expect(estimateTextureMemory(2048, 2048, "BC7", { mipmaps: true })).toBe(5_592_432);
    expect(estimateTextureMemory(2048, 2048, "BC1", { mipmaps: true })).toBe(2_796_216);
  });

  it("alpha channel doubles shelf size: 4K BC1 10.67 MiB → BC3 21.33 MiB", () => {
    const noAlpha = estimateTextureMemory(4096, 4096, "BC1", { mipmaps: true });
    const withAlpha = estimateTextureMemory(4096, 4096, "BC3", { mipmaps: true });
    expect(noAlpha / (1024 * 1024)).toBeCloseTo(10.67, 2);
    expect(withAlpha / (1024 * 1024)).toBeCloseTo(21.33, 2);
    expect(withAlpha).toBe(noAlpha * 2);
  });

  it("if levels is given mipmaps is ignored; in compressed format no level can be smaller than a block", () => {
    expect(estimateTextureMemory(64, 64, "RGBA8", { mipmaps: true, levels: 1 })).toBe(64 * 64 * 4);
    // 4×4 mip and 1×1 mip are identical: both are single block = 16 bytes
    expect(levelBytes(4, 4, "BC7")).toBe(levelBytes(1, 1, "BC7"));
  });
});

// transcode-target.test.ts
import { expect, it } from "vitest";
import { pickTranscodeTarget } from "../src/transcode-target";
import { bytesPerPixel } from "../src/texture-memory";

const NONE = { astc: false, bptc: false, s3tc: false, etc2: false, etc1: false, pvrtc: false };

it("UASTC + mobile with ASTC support → ASTC 4x4", () => {
  expect(pickTranscodeTarget({ ...NONE, astc: true, etc2: true }, "UASTC", false).format).toBe("ASTC_4x4");
});

it("ETC1S NEVER goes to ASTC, prefers ETC2", () => {
  expect(pickTranscodeTarget({ ...NONE, astc: true, etc2: true }, "ETC1S", false).format).toBe("ETC2_RGB");
});

it("alpha channel increases target from 0.5 bpp to 1.0 bpp", () => {
  const s3tc = { ...NONE, s3tc: true };
  expect(pickTranscodeTarget(s3tc, "ETC1S", false).format).toBe("BC1"); // 0.5
  expect(pickTranscodeTarget(s3tc, "ETC1S", true).format).toBe("BC3"); // 1.0
});

it("falls back to RGBA8 when no format is supported — zero VRAM gain", () => {
  const choice = pickTranscodeTarget(NONE, "UASTC", true);
  expect(choice.format).toBe("RGBA8");
  expect(choice.compressed).toBe(false);
});

// --- additional coverage not in article ---

it("UASTC selects BC7 on desktop (priority 2 < 3 < 5)", () => {
  const desktop = { ...NONE, bptc: true, s3tc: true, etc2: true };
  expect(pickTranscodeTarget(desktop, "UASTC", false).format).toBe("BC7");
  expect(pickTranscodeTarget(desktop, "UASTC", true).format).toBe("BC7");
});

it("in ETC1S BC7 (3) comes before S3TC (4)", () => {
  expect(pickTranscodeTarget({ ...NONE, bptc: true, s3tc: true }, "ETC1S", false).format).toBe("BC7");
  // S3TC if no BPTC: BC1 without alpha, BC3 with alpha
  expect(pickTranscodeTarget({ ...NONE, s3tc: true }, "ETC1S", true).format).toBe("BC3");
});

it("ETC1S ranking is ETC2 → ETC1 → BC7 → S3TC", () => {
  expect(pickTranscodeTarget({ ...NONE, etc1: true, etc2: true }, "ETC1S", false).format).toBe("ETC2_RGB");
  expect(pickTranscodeTarget({ ...NONE, etc1: true, s3tc: true }, "ETC1S", false).format).toBe("ETC1");
});

it("returns compressed flag true if chosen target is compressed", () => {
  expect(pickTranscodeTarget({ ...NONE, astc: true }, "UASTC", true)).toEqual({
    format: "ASTC_4x4",
    compressed: true,
  });
});

it("PVRTC support not in TARGETS: falls back to RGBA8 by itself", () => {
  // FormatSupport.pvrtc exists to remain in parity with detectSupport,
  // but has no entry in the priority table (article does not count it either).
  expect(pickTranscodeTarget({ ...NONE, pvrtc: true }, "ETC1S", false).format).toBe("RGBA8");
});

// ETC1 has no alpha channel. Three implements this with `hasAlpha && transcoderFormat.length < 2 →
// continue`; port carries same guard with `engineFormat.length < 2`.
// Without these tests the bug remains silent: alpha appears free, tool underestimates VRAM.
it("ETC1 is skipped when alpha is requested: GPU with only ETC1 falls back to RGBA8", () => {
  const etc1Only = { ...NONE, etc1: true };
  expect(pickTranscodeTarget(etc1Only, "ETC1S", false).format).toBe("ETC1");
  expect(pickTranscodeTarget(etc1Only, "ETC1S", true)).toEqual({
    format: "RGBA8",
    compressed: false,
  });
  expect(pickTranscodeTarget(etc1Only, "UASTC", true).format).toBe("RGBA8");
});

it("alpha causes fallback from ETC1 to target with lower priority but with alpha", () => {
  // ETC1S: etc1(2) < s3tc(4). ETC1 wins without alpha, falls back to BC3 with alpha.
  const etc1AndS3tc = { ...NONE, etc1: true, s3tc: true };
  expect(pickTranscodeTarget(etc1AndS3tc, "ETC1S", false).format).toBe("ETC1");
  expect(pickTranscodeTarget(etc1AndS3tc, "ETC1S", true).format).toBe("BC3");
  // UASTC: etc1(4) < s3tc(5). same result.
  expect(pickTranscodeTarget(etc1AndS3tc, "UASTC", false).format).toBe("ETC1");
  expect(pickTranscodeTarget(etc1AndS3tc, "UASTC", true).format).toBe("BC3");
});

it("padding ETC1 would underestimate VRAM: target with alpha is at least 2× more expensive", () => {
  const etc1Only = { ...NONE, etc1: true };
  const noAlpha = pickTranscodeTarget(etc1Only, "ETC1S", false).format;
  const withAlpha = pickTranscodeTarget(etc1Only, "ETC1S", true).format;
  expect(bytesPerPixel(noAlpha)).toBe(0.5);
  expect(bytesPerPixel(withAlpha)).toBe(4);
  expect(bytesPerPixel(withAlpha) / bytesPerPixel(noAlpha)).toBe(8);
});

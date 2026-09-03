// transcode-target.test.ts (ilgili kısım)
import { expect, it } from "vitest";
import { pickTranscodeTarget } from "../src/transcode-target";
import { bytesPerPixel } from "../src/texture-memory";

const NONE = { astc: false, bptc: false, s3tc: false, etc2: false, etc1: false, pvrtc: false };

it("UASTC + ASTC destekli mobil → ASTC 4x4", () => {
  expect(pickTranscodeTarget({ ...NONE, astc: true, etc2: true }, "UASTC", false).format).toBe("ASTC_4x4");
});

it("ETC1S ASTC'ye ASLA gitmez, ETC2'yi tercih eder", () => {
  expect(pickTranscodeTarget({ ...NONE, astc: true, etc2: true }, "ETC1S", false).format).toBe("ETC2_RGB");
});

it("alfa kanalı hedefi 0,5 bpp'den 1,0 bpp'ye çıkarır", () => {
  const s3tc = { ...NONE, s3tc: true };
  expect(pickTranscodeTarget(s3tc, "ETC1S", false).format).toBe("BC1"); // 0,5
  expect(pickTranscodeTarget(s3tc, "ETC1S", true).format).toBe("BC3"); // 1,0
});

it("hiç destek yoksa RGBA8'e düşer — VRAM kazancı sıfır", () => {
  const choice = pickTranscodeTarget(NONE, "UASTC", true);
  expect(choice.format).toBe("RGBA8");
  expect(choice.compressed).toBe(false);
});

// --- makalede geçmeyen ek kapsam ---

it("UASTC masaüstünde BC7'yi seçer (öncelik 2 < 3 < 5)", () => {
  const desktop = { ...NONE, bptc: true, s3tc: true, etc2: true };
  expect(pickTranscodeTarget(desktop, "UASTC", false).format).toBe("BC7");
  expect(pickTranscodeTarget(desktop, "UASTC", true).format).toBe("BC7");
});

it("ETC1S'te BC7 (3) S3TC'den (4) önce gelir", () => {
  expect(pickTranscodeTarget({ ...NONE, bptc: true, s3tc: true }, "ETC1S", false).format).toBe("BC7");
  // BPTC yoksa S3TC: alfasız BC1, alfalı BC3
  expect(pickTranscodeTarget({ ...NONE, s3tc: true }, "ETC1S", true).format).toBe("BC3");
});

it("ETC1S sıralaması ETC2 → ETC1 → BC7 → S3TC", () => {
  expect(pickTranscodeTarget({ ...NONE, etc1: true, etc2: true }, "ETC1S", false).format).toBe("ETC2_RGB");
  expect(pickTranscodeTarget({ ...NONE, etc1: true, s3tc: true }, "ETC1S", false).format).toBe("ETC1");
});

it("seçilen hedef sıkıştırılmışsa compressed bayrağı true döner", () => {
  expect(pickTranscodeTarget({ ...NONE, astc: true }, "UASTC", true)).toEqual({
    format: "ASTC_4x4",
    compressed: true,
  });
});

it("PVRTC desteği TARGETS'ta yok: tek başına RGBA8'e düşer", () => {
  // FormatSupport.pvrtc alanı detectSupport ile paritede kalmak için VAR,
  // ama öncelik tablosunda karşılığı yok (makale de saymıyor).
  expect(pickTranscodeTarget({ ...NONE, pvrtc: true }, "ETC1S", false).format).toBe("RGBA8");
});

// ETC1'in alfa kanalı YOK. three bunu `hasAlpha && transcoderFormat.length < 2 →
// continue` ile uygular; port aynı korumayı `engineFormat.length < 2` ile taşır.
// Bu testler olmadan hata sessiz kalır: alfa bedava görünür, araç VRAM'i eksik sayar.
it("alfa istenirken ETC1 atlanır: tek başına ETC1'li GPU RGBA8'e düşer", () => {
  const etc1Only = { ...NONE, etc1: true };
  expect(pickTranscodeTarget(etc1Only, "ETC1S", false).format).toBe("ETC1");
  expect(pickTranscodeTarget(etc1Only, "ETC1S", true)).toEqual({
    format: "RGBA8",
    compressed: false,
  });
  expect(pickTranscodeTarget(etc1Only, "UASTC", true).format).toBe("RGBA8");
});

it("alfa, ETC1'i önceliği daha düşük ama alfalı hedefe bıraktırır", () => {
  // ETC1S: etc1(2) < s3tc(4). Alfasız ETC1 kazanır, alfalı BC3'e düşer.
  const etc1AndS3tc = { ...NONE, etc1: true, s3tc: true };
  expect(pickTranscodeTarget(etc1AndS3tc, "ETC1S", false).format).toBe("ETC1");
  expect(pickTranscodeTarget(etc1AndS3tc, "ETC1S", true).format).toBe("BC3");
  // UASTC: etc1(4) < s3tc(5). Aynı sonuç.
  expect(pickTranscodeTarget(etc1AndS3tc, "UASTC", false).format).toBe("ETC1");
  expect(pickTranscodeTarget(etc1AndS3tc, "UASTC", true).format).toBe("BC3");
});

it("ETC1 dolgusu VRAM'i eksik gösterirdi: alfalı hedef en az 2× pahalı", () => {
  const etc1Only = { ...NONE, etc1: true };
  const alfasiz = pickTranscodeTarget(etc1Only, "ETC1S", false).format;
  const alfali = pickTranscodeTarget(etc1Only, "ETC1S", true).format;
  expect(bytesPerPixel(alfasiz)).toBe(0.5);
  expect(bytesPerPixel(alfali)).toBe(4);
  expect(bytesPerPixel(alfali) / bytesPerPixel(alfasiz)).toBe(8);
});

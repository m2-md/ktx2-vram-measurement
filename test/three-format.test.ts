// three-format.test.ts
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { formatOfTexture, layersOfTexture, levelsOfTexture, sizeOfTexture } from "../src/three-format";

describe("formatOfTexture", () => {
  it("default DataTexture → RGBA8 (no RGBFormat since r137)", () => {
    expect(formatOfTexture(new THREE.DataTexture(new Uint8Array(4), 1, 1))).toBe("RGBA8");
  });

  it("HalfFloatType → RGBA16F, FloatType → RGBA32F", () => {
    const half = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
    const full = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    expect(formatOfTexture(half)).toBe("RGBA16F");
    expect(formatOfTexture(full)).toBe("RGBA32F");
  });

  it("RedFormat → R8, RGFormat → RG8", () => {
    const r = new THREE.DataTexture(new Uint8Array(1), 1, 1, THREE.RedFormat);
    const rg = new THREE.DataTexture(new Uint8Array(2), 1, 1, THREE.RGFormat);
    expect(formatOfTexture(r)).toBe("R8");
    expect(formatOfTexture(rg)).toBe("RG8");
  });

  it("DepthTexture: UnsignedShortType → DEPTH16, otherwise DEPTH24_STENCIL8", () => {
    const d16 = new THREE.DepthTexture(64, 64, THREE.UnsignedShortType);
    const d24 = new THREE.DepthTexture(64, 64);
    expect(formatOfTexture(d16)).toBe("DEPTH16");
    expect(formatOfTexture(d24)).toBe("DEPTH24_STENCIL8");
  });
});

describe("levelsOfTexture", () => {
  it("default DataTexture does NOT carry mip chain → 1", () => {
    const texture = new THREE.DataTexture(new Uint8Array(256 * 256 * 4), 256, 256);
    expect(texture.generateMipmaps).toBe(false);
    expect(levelsOfTexture(texture)).toBe(1);
  });

  it("256² texture with generateMipmaps + mipmapped minFilter → 9 levels", () => {
    const texture = new THREE.DataTexture(new Uint8Array(256 * 256 * 4), 256, 256);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    expect(levelsOfTexture(texture)).toBe(9);
  });

  it("generateMipmaps on but minFilter without mipmap → no mips generated, 1 level", () => {
    const texture = new THREE.DataTexture(new Uint8Array(256 * 256 * 4), 256, 256);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearFilter;
    expect(levelsOfTexture(texture)).toBe(1);
  });

  it("CompressedTexture reports length of existing mip chain", () => {
    const mipmaps = [
      { data: new Uint8Array(16), width: 4, height: 4 },
      { data: new Uint8Array(16), width: 2, height: 2 },
      { data: new Uint8Array(16), width: 1, height: 1 },
    ];
    const texture = new THREE.CompressedTexture(mipmaps, 4, 4, THREE.RGBA_BPTC_Format);
    expect(formatOfTexture(texture)).toBe("BC7");
    expect(levelsOfTexture(texture)).toBe(3);
  });
});

describe("sizeOfTexture / layersOfTexture", () => {
  it("CubeTexture → 6 layers, dimensions read from first face", () => {
    const faces = Array.from({ length: 6 }, () => ({ width: 64, height: 64 }));
    const cube = new THREE.CubeTexture(faces);
    expect(layersOfTexture(cube)).toBe(6);
    expect(sizeOfTexture(cube)).toEqual({ width: 64, height: 64 });
  });

  it("2D texture → 1 layer; size is 0x0 if no image", () => {
    expect(layersOfTexture(new THREE.DataTexture(new Uint8Array(4), 1, 1))).toBe(1);
    expect(sizeOfTexture(new THREE.Texture())).toEqual({ width: 0, height: 0 });
  });

  it("array texture with image.depth > 1 reports layer count", () => {
    const texture = new THREE.DataArrayTexture(new Uint8Array(8 * 8 * 4 * 4), 8, 8, 4);
    expect(layersOfTexture(texture)).toBe(4);
    expect(sizeOfTexture(texture)).toEqual({ width: 8, height: 8 });
  });
});

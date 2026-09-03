// three-format.ts (özet)
import * as THREE from "three";
import { mipLevelCount, type FormatKey } from "./texture-memory";

const COMPRESSED: ReadonlyMap<number, FormatKey> = new Map([
  [THREE.RGB_S3TC_DXT1_Format, "BC1"],
  [THREE.RGBA_S3TC_DXT1_Format, "BC1"],
  [THREE.RGBA_S3TC_DXT3_Format, "BC2"],
  [THREE.RGBA_S3TC_DXT5_Format, "BC3"],
  [THREE.RGBA_BPTC_Format, "BC7"],
  [THREE.RGB_ETC1_Format, "ETC1"],
  [THREE.RGB_ETC2_Format, "ETC2_RGB"],
  [THREE.RGBA_ETC2_EAC_Format, "ETC2_RGBA"],
  [THREE.RGBA_ASTC_4x4_Format, "ASTC_4x4"],
  [THREE.RGBA_ASTC_6x6_Format, "ASTC_6x6"],
  [THREE.RGBA_ASTC_8x8_Format, "ASTC_8x8"],
]);

const MIP_FILTERS: ReadonlySet<number> = new Set([
  THREE.NearestMipmapNearestFilter,
  THREE.NearestMipmapLinearFilter,
  THREE.LinearMipmapNearestFilter,
  THREE.LinearMipmapLinearFilter,
]);

export function formatOfTexture(texture: THREE.Texture): FormatKey {
  if ((texture as THREE.DepthTexture).isDepthTexture) {
    return texture.type === THREE.UnsignedShortType ? "DEPTH16" : "DEPTH24_STENCIL8";
  }
  const compressed = COMPRESSED.get(texture.format as number);
  if (compressed) return compressed;
  if (texture.type === THREE.FloatType) return "RGBA32F";
  if (texture.type === THREE.HalfFloatType) return "RGBA16F";
  if (texture.format === THREE.RedFormat) return "R8";
  if (texture.format === THREE.RGFormat) return "RG8";
  return "RGBA8"; // three r137'den beri RGBFormat yok: RGB kaynak da RGBA8 olarak yatar
}

export function levelsOfTexture(texture: THREE.Texture): number {
  const { width, height } = sizeOfTexture(texture);
  if ((texture as THREE.CompressedTexture).isCompressedTexture) {
    return Math.max(1, texture.mipmaps?.length ?? 1);
  }
  const wantsMips = texture.generateMipmaps && MIP_FILTERS.has(texture.minFilter as number);
  return wantsMips ? mipLevelCount(width, height) : 1;
}

// --- boyut ve katman köprüleri (makalede "özet" olarak kısaltıldı) ---

/** `texture.image` bir ImageBitmap, canvas, {width,height,depth} ya da bunların dizisi olabilir. */
interface ImageLike {
  width?: number;
  height?: number;
  depth?: number;
}

function imageOf(texture: THREE.Texture): ImageLike | undefined {
  const image = texture.image as ImageLike | ImageLike[] | null | undefined;
  if (!image) return undefined;
  return Array.isArray(image) ? image[0] : image; // CubeTexture → altı yüzün ilki
}

export function sizeOfTexture(texture: THREE.Texture): { width: number; height: number } {
  const image = imageOf(texture);
  return { width: image?.width ?? 0, height: image?.height ?? 0 };
}

export function layersOfTexture(texture: THREE.Texture): number {
  if ((texture as THREE.CubeTexture).isCubeTexture) return 6;
  const depth = imageOf(texture)?.depth ?? 1;
  return depth > 1 ? depth : 1;
}

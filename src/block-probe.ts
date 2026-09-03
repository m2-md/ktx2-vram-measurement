// block-probe.ts
import { levelBytes, type FormatKey } from "./texture-memory";

export interface BlockProbeResult {
  format: FormatKey;
  width: number;
  height: number;
  expectedBytes: number;
  exactAccepted: boolean; // bytes calculated by formula → did the driver accept?
  shortRejected: boolean; // one byte short → did the driver reject?
}

export function probeBlockSize(
  gl: WebGL2RenderingContext,
  format: FormatKey,
  glFormat: number,
  width: number,
  height: number,
): BlockProbeResult {
  const expectedBytes = levelBytes(width, height, format);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  while (gl.getError() !== gl.NO_ERROR) {
    /* flush previous errors from the queue */
  }

  gl.compressedTexImage2D(gl.TEXTURE_2D, 0, glFormat, width, height, 0, new Uint8Array(expectedBytes));
  const exactAccepted = gl.getError() === gl.NO_ERROR;

  gl.compressedTexImage2D(gl.TEXTURE_2D, 0, glFormat, width, height, 0, new Uint8Array(expectedBytes - 1));
  const shortRejected = gl.getError() === gl.INVALID_VALUE;

  gl.deleteTexture(texture);
  return { format, width, height, expectedBytes, exactAccepted, shortRejected };
}

export interface CompressedFormatEntry {
  key: FormatKey;
  glFormat: number;
  label: string;
}

export function availableCompressedFormats(gl: WebGL2RenderingContext): CompressedFormatEntry[] {
  const out: CompressedFormatEntry[] = [];

  const s3tc = gl.getExtension("WEBGL_compressed_texture_s3tc");
  if (s3tc) {
    out.push({ key: "BC1", glFormat: s3tc.COMPRESSED_RGB_S3TC_DXT1_EXT, label: "BC1 (DXT1)" });
    out.push({ key: "BC3", glFormat: s3tc.COMPRESSED_RGBA_S3TC_DXT5_EXT, label: "BC3 (DXT5)" });
  }

  const bptc = gl.getExtension("EXT_texture_compression_bptc") as { COMPRESSED_RGBA_BPTC_UNORM_EXT: number } | null;
  if (bptc) out.push({ key: "BC7", glFormat: bptc.COMPRESSED_RGBA_BPTC_UNORM_EXT, label: "BC7 (BPTC)" });

  const astc = gl.getExtension("WEBGL_compressed_texture_astc");
  if (astc) out.push({ key: "ASTC_4x4", glFormat: astc.COMPRESSED_RGBA_ASTC_4x4_KHR, label: "ASTC 4x4" });

  const etc = gl.getExtension("WEBGL_compressed_texture_etc") as { COMPRESSED_RGB8_ETC2: number } | null;
  if (etc) out.push({ key: "ETC2_RGB", glFormat: etc.COMPRESSED_RGB8_ETC2, label: "ETC2 RGB" });

  return out;
}

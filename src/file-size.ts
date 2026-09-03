// file-size.ts
export interface EncodedSize {
  mime: string;
  bytes: number;
  supported: boolean;
}

export async function encodedSizes(
  canvas: HTMLCanvasElement,
  mimes: readonly string[] = ["image/png", "image/webp"],
  quality = 0.85,
): Promise<EncodedSize[]> {
  const out: EncodedSize[] = [];
  for (const mime of mimes) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
    // Tarayıcı istenen formatı üretemezse sessizce PNG döner — type kontrolü şart
    out.push({ mime, bytes: blob?.size ?? 0, supported: blob?.type === mime });
  }
  return out;
}

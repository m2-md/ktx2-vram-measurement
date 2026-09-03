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
    // If browser cannot produce requested format, it silently returns PNG — type check is required
    out.push({ mime, bytes: blob?.size ?? 0, supported: blob?.type === mime });
  }
  return out;
}

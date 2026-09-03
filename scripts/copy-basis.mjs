// copy-basis.mjs — three'nin Basis transcoder'ını node_modules'tan public/basis/'e KOPYALAR.
// İNDİRME YOK: dosyalar zaten node_modules/three içinde geliyor. KTX2Loader
// setTranscoderPath("/basis/") ile buradan okur.
import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, "node_modules", "three", "examples", "jsm", "libs", "basis");
const to = join(root, "public", "basis");
const FILES = ["basis_transcoder.js", "basis_transcoder.wasm"];

try {
  await stat(from);
} catch {
  console.error(`[copy-basis] Kaynak klasör yok: ${from}\n  → önce "npm install" koşun.`);
  process.exit(1);
}

await mkdir(to, { recursive: true });

for (const file of FILES) {
  const src = join(from, file);
  try {
    await stat(src);
  } catch {
    console.error(`[copy-basis] Dosya bulunamadı: ${src}\n  → three sürümü transcoder'ı taşımış olabilir.`);
    process.exit(1);
  }
  await copyFile(src, join(to, file));
  const { size } = await stat(join(to, file));
  console.log(`[copy-basis] ${file} → public/basis/ (${size.toLocaleString("tr-TR")} B)`);
}

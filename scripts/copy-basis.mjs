// copy-basis.mjs — Copies Three's Basis transcoder from node_modules to public/basis/.
// NO DOWNLOAD: files already come inside node_modules/three. KTX2Loader
// reads from here via setTranscoderPath("/basis/").
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
  console.error(`[copy-basis] Source folder missing: ${from}\n  → run "npm install" first.`);
  process.exit(1);
}

await mkdir(to, { recursive: true });

for (const file of FILES) {
  const src = join(from, file);
  try {
    await stat(src);
  } catch {
    console.error(`[copy-basis] File not found: ${src}\n  → three version might have moved the transcoder.`);
    process.exit(1);
  }
  await copyFile(src, join(to, file));
  const { size } = await stat(join(to, file));
  console.log(`[copy-basis] ${file} → public/basis/ (${size.toLocaleString("en-US")} B)`);
}

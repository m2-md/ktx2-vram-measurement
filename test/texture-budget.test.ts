// texture-budget.test.ts (ilgili kısım)
import { expect, it } from "vitest";
import * as THREE from "three";
import { TextureBudget } from "../src/texture-budget";

it("paylaşılan doku bir kez sayılır", () => {
  const shared = new THREE.DataTexture(new Uint8Array(64 * 64 * 4), 64, 64);
  const a = new THREE.MeshStandardMaterial({ map: shared });
  const b = new THREE.MeshStandardMaterial({ map: shared });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), a));
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), b));

  const budget = new TextureBudget();
  budget.addScene(scene);

  expect(budget.count).toBe(1); // iki materyal, TEK doku
  expect(budget.totalBytes).toBe(64 * 64 * 4); // DataTexture varsayılanı: mipmap YOK
});

it("crossCheck sahte renderer'ın sayacıyla karşılaştırır", () => {
  const budget = new TextureBudget();
  budget.addTexture(new THREE.DataTexture(new Uint8Array(4), 1, 1));
  const fake = { info: { memory: { textures: 3, geometries: 0 } } };
  expect(budget.crossCheck(fake)).toEqual({ counted: 1, gpu: 3, delta: 2 });
});

// --- makalede geçmeyen ek kapsam ---

it("addRenderTarget grafik dışındaki hedefi de bütçeye yazar", () => {
  const rt = new THREE.WebGLRenderTarget(256, 256);
  const budget = new TextureBudget();
  budget.addRenderTarget(rt, "postFX");

  expect(budget.count).toBe(1);
  // render target dokusu varsayılan olarak mipmap ÜRETMEZ → taban seviye kadar
  expect(budget.totalBytes).toBe(256 * 256 * 4);
  expect(budget.table()[0].name).toBe("postFX.texture");
  rt.dispose();
});

it("addScene background ve environment dokularını da toplar", () => {
  const scene = new THREE.Scene();
  scene.background = new THREE.DataTexture(new Uint8Array(32 * 32 * 4), 32, 32);
  scene.environment = new THREE.DataTexture(new Uint8Array(16 * 16 * 4), 16, 16);

  const budget = new TextureBudget();
  budget.addScene(scene);

  expect(budget.count).toBe(2);
  expect(budget.totalBytes).toBe(32 * 32 * 4 + 16 * 16 * 4);
  expect(budget.table().map((e) => e.name)).toEqual(["scene.background", "scene.environment"]);
});

it("kaynağı yüklenmemiş doku bütçeye girmez, clear() sıfırlar", () => {
  const budget = new TextureBudget();
  expect(budget.addTexture(new THREE.Texture())).toBeNull(); // image yok → 0×0
  expect(budget.count).toBe(0);

  budget.addTexture(new THREE.DataTexture(new Uint8Array(8 * 8 * 4), 8, 8), "küçük");
  expect(budget.count).toBe(1);

  budget.clear();
  expect(budget.count).toBe(0);
  expect(budget.totalBytes).toBe(0);
});

it("mip'li 2048² doku bütçede 22.369.620 bayt tutar", () => {
  const texture = new THREE.DataTexture(new Uint8Array(4), 2048, 2048);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;

  const budget = new TextureBudget();
  const entry = budget.addTexture(texture, "demo.map");

  expect(entry?.levels).toBe(12);
  expect(entry?.bytes).toBe(22_369_620);
});

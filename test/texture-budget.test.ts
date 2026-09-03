// texture-budget.test.ts
import { expect, it } from "vitest";
import * as THREE from "three";
import { TextureBudget } from "../src/texture-budget";

it("shared texture is counted once", () => {
  const shared = new THREE.DataTexture(new Uint8Array(64 * 64 * 4), 64, 64);
  const a = new THREE.MeshStandardMaterial({ map: shared });
  const b = new THREE.MeshStandardMaterial({ map: shared });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), a));
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), b));

  const budget = new TextureBudget();
  budget.addScene(scene);

  expect(budget.count).toBe(1); // two materials, SINGLE texture
  expect(budget.totalBytes).toBe(64 * 64 * 4); // DataTexture default: NO mipmaps
});

it("crossCheck compares with fake renderer counter", () => {
  const budget = new TextureBudget();
  budget.addTexture(new THREE.DataTexture(new Uint8Array(4), 1, 1));
  const fake = { info: { memory: { textures: 3, geometries: 0 } } };
  expect(budget.crossCheck(fake)).toEqual({ counted: 1, gpu: 3, delta: 2 });
});

// --- additional coverage not in article ---

it("addRenderTarget writes targets outside scene graph to budget", () => {
  const rt = new THREE.WebGLRenderTarget(256, 256);
  const budget = new TextureBudget();
  budget.addRenderTarget(rt, "postFX");

  expect(budget.count).toBe(1);
  // render target texture does not produce mipmaps by default → equal to base level
  expect(budget.totalBytes).toBe(256 * 256 * 4);
  expect(budget.table()[0].name).toBe("postFX.texture");
  rt.dispose();
});

it("addScene also collects background and environment textures", () => {
  const scene = new THREE.Scene();
  scene.background = new THREE.DataTexture(new Uint8Array(32 * 32 * 4), 32, 32);
  scene.environment = new THREE.DataTexture(new Uint8Array(16 * 16 * 4), 16, 16);

  const budget = new TextureBudget();
  budget.addScene(scene);

  expect(budget.count).toBe(2);
  expect(budget.totalBytes).toBe(32 * 32 * 4 + 16 * 16 * 4);
  expect(budget.table().map((e) => e.name)).toEqual(["scene.background", "scene.environment"]);
});

it("unloaded texture is not added to budget, clear() resets", () => {
  const budget = new TextureBudget();
  expect(budget.addTexture(new THREE.Texture())).toBeNull(); // no image → 0×0
  expect(budget.count).toBe(0);

  budget.addTexture(new THREE.DataTexture(new Uint8Array(8 * 8 * 4), 8, 8), "small");
  expect(budget.count).toBe(1);

  budget.clear();
  expect(budget.count).toBe(0);
  expect(budget.totalBytes).toBe(0);
});

it("mipped 2048² texture takes 22,369,620 bytes in budget", () => {
  const texture = new THREE.DataTexture(new Uint8Array(4), 2048, 2048);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;

  const budget = new TextureBudget();
  const entry = budget.addTexture(texture, "demo.map");

  expect(entry?.levels).toBe(12);
  expect(entry?.bytes).toBe(22_369_620);
});

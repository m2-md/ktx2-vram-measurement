// texture-budget.ts
import * as THREE from "three";
import { estimateTextureMemory, type FormatKey } from "./texture-memory";
import { formatOfTexture, layersOfTexture, levelsOfTexture, sizeOfTexture } from "./three-format";

export interface BudgetEntry {
  name: string;
  width: number;
  height: number;
  format: FormatKey;
  levels: number;
  layers: number;
  bytes: number;
}

export interface RendererInfoLike {
  info: { memory: { textures: number; geometries: number } };
}

export class TextureBudget {
  // Anahtar Texture nesnesinin KENDİSİ → paylaşılan atlas bir kez sayılır
  private readonly entries = new Map<THREE.Texture, BudgetEntry>();

  addTexture(texture: THREE.Texture, name?: string): BudgetEntry | null {
    const existing = this.entries.get(texture);
    if (existing) return existing;

    const { width, height } = sizeOfTexture(texture);
    if (width === 0 || height === 0) return null; // kaynağı henüz yüklenmemiş

    const format = formatOfTexture(texture);
    const levels = levelsOfTexture(texture);
    const layers = layersOfTexture(texture);
    const entry: BudgetEntry = {
      name: name ?? texture.name ?? "(isimsiz)",
      width,
      height,
      format,
      levels,
      layers,
      bytes: estimateTextureMemory(width, height, format, { levels, layers }),
    };
    this.entries.set(texture, entry);
    return entry;
  }

  addMaterial(material: THREE.Material, owner: string): void {
    // 7 slotluk sabit liste değil: materyalin BÜTÜN doku alanlarını tara
    for (const [slot, value] of Object.entries(material)) {
      if (value instanceof THREE.Texture) this.addTexture(value, `${owner}.${slot}`);
    }
  }

  addScene(scene: THREE.Object3D): void {
    scene.traverse((obj) => {
      const material = (obj as THREE.Mesh).material;
      if (!material) return;
      const list = Array.isArray(material) ? material : [material];
      for (const m of list) this.addMaterial(m, obj.name || obj.type);
    });

    const s = scene as THREE.Scene;
    if (s.background instanceof THREE.Texture) this.addTexture(s.background, "scene.background");
    if (s.environment instanceof THREE.Texture) this.addTexture(s.environment, "scene.environment");
  }

  addRenderTarget(rt: THREE.WebGLRenderTarget, name = "renderTarget"): void {
    this.addTexture(rt.texture, `${name}.texture`);
    if (rt.depthTexture) this.addTexture(rt.depthTexture, `${name}.depthTexture`);
  }

  get totalBytes(): number {
    let sum = 0;
    for (const e of this.entries.values()) sum += e.bytes;
    return sum;
  }

  get count(): number {
    return this.entries.size;
  }

  table(): BudgetEntry[] {
    return [...this.entries.values()].sort((a, b) => b.bytes - a.bytes);
  }

  crossCheck(renderer: RendererInfoLike): { counted: number; gpu: number; delta: number } {
    const gpu = renderer.info.memory.textures;
    return { counted: this.count, gpu, delta: gpu - this.count };
  }

  clear(): void {
    this.entries.clear();
  }
}

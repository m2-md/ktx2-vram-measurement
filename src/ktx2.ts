// ktx2.ts
import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

export function createKTX2Loader(renderer: THREE.WebGLRenderer): KTX2Loader {
  const loader = new KTX2Loader();
  // basis_transcoder.js + .wasm → copied from node_modules/three/examples/jsm/libs/basis/ to public/basis/
  loader.setTranscoderPath("/basis/");
  loader.detectSupport(renderer); // Queries GPU and determines transcode target
  return loader;
}

export interface WorkerConfig {
  astcSupported: boolean;
  bptcSupported: boolean;
  dxtSupported: boolean;
  etc1Supported: boolean;
  etc2Supported: boolean;
  pvrtcSupported: boolean;
}

/** Makes the result collected by detectSupport from the GPU readable. */
export function readWorkerConfig(loader: KTX2Loader): WorkerConfig | null {
  return (loader as unknown as { workerConfig?: WorkerConfig }).workerConfig ?? null;
}

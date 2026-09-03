// ktx2.ts
import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

export function createKTX2Loader(renderer: THREE.WebGLRenderer): KTX2Loader {
  const loader = new KTX2Loader();
  // basis_transcoder.js + .wasm → node_modules/three/examples/jsm/libs/basis/'ten public/basis/'e kopyalanır
  loader.setTranscoderPath("/basis/");
  loader.detectSupport(renderer); // GPU'ya sorar, transcode hedefini belirler
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

/** detectSupport'un GPU'dan topladığı sonucu okunur hâle getirir. */
export function readWorkerConfig(loader: KTX2Loader): WorkerConfig | null {
  return (loader as unknown as { workerConfig?: WorkerConfig }).workerConfig ?? null;
}

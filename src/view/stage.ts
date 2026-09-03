// view/stage.ts — presentation layer: dark cinematic + neon, but DELIBERATELY LIGHTWEIGHT.
// No shadows, no post-process, at most 3 meshes. Render on-demand: animation loop
// only runs if "Spin" is checked. Measured renderer is this renderer —
// `renderer.info.memory.textures` is read from here.
import * as THREE from "three";

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Two box materials where textures can be slotted (third box remains textureless as reference). */
  slots: THREE.MeshStandardMaterial[];
  render(): void;
  setSpinning(on: boolean): void;
}

export function createStage(container: HTMLElement): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // lightweight: cap at 1.5
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x05060b, 1);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x05060b, 7, 18);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 1.5, 6.4);
  camera.lookAt(0, 0.1, 0);

  // Neon light — no shadow map, therefore no extra texture either.
  scene.add(new THREE.AmbientLight(0x24304a, 1.4));
  const cyan = new THREE.PointLight(0x22d3ee, 55, 22, 2);
  cyan.position.set(-3.2, 2.6, 3.2);
  const magenta = new THREE.PointLight(0xf472b6, 42, 22, 2);
  magenta.position.set(3.4, 1.4, -1.8);
  const rim = new THREE.DirectionalLight(0xa78bfa, 0.7);
  rim.position.set(0.5, 3, -4);
  scene.add(cyan, magenta, rim);

  // Ground: single quad, no texture, no reflection.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x0a0f1a, roughness: 0.92, metalness: 0.1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.05;
  scene.add(floor);

  const grid = new THREE.GridHelper(40, 40, 0x1b2740, 0x121a2b);
  grid.position.y = -1.04;
  scene.add(grid);

  // Three boxes: first two are texture slots, third is textureless reference.
  const slots: THREE.MeshStandardMaterial[] = [];
  const group = new THREE.Group();
  const positions = [-1.85, 0, 1.85];
  for (let i = 0; i < 3; i++) {
    const material = new THREE.MeshStandardMaterial({
      color: i === 2 ? 0x2a3550 : 0x9aa8c7,
      roughness: 0.5,
      metalness: 0.22,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), material);
    mesh.name = i === 2 ? "reference" : `slot${i}`;
    mesh.position.set(positions[i], 0, i === 1 ? -0.35 : 0);
    mesh.rotation.y = (i - 1) * 0.42;
    group.add(mesh);
    if (i < 2) slots.push(material);
  }
  scene.add(group);

  function resize(): void {
    const width = Math.max(320, container.clientWidth);
    const height = Math.max(320, container.clientHeight);
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function render(): void {
    renderer.render(scene, camera);
  }

  let spinning = false;
  function setSpinning(on: boolean): void {
    spinning = on;
    if (on) {
      renderer.setAnimationLoop(() => {
        group.rotation.y += 0.004;
        render();
      });
    } else {
      renderer.setAnimationLoop(null);
      render();
    }
  }

  new ResizeObserver(() => {
    resize();
    if (!spinning) render();
  }).observe(container);

  resize();
  render();

  return { renderer, scene, camera, slots, render, setSpinning };
}

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/**
 * A turntable for one component model: the same meshopt-packed Blender exports the deck's cutaway
 * draws, lit by a studio environment, turning slowly until the user takes hold of it. Loaded only
 * when the landing page's 3D section comes into view.
 */
export interface Viewer { load(url: string): Promise<void>; dispose(): void }

export function createViewer(canvas: HTMLCanvasElement, options: { readonly turn: boolean }): Viewer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  // A key light, and two rims in the deck's violet and cyan.
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(3, 5, 4); scene.add(key);
  const violet = new THREE.DirectionalLight(0x8b6cff, 2.2); violet.position.set(-4, 2, -3); scene.add(violet);
  const cyan = new THREE.DirectionalLight(0x22d3ee, 1.4); cyan.position.set(4, 1, -4); scene.add(cyan);

  // A soft contact shadow under the part.
  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = shadowCanvas.height = 128;
  const context = shadowCanvas.getContext("2d")!;
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(0,0,0,0.55)"); gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.autoRotate = options.turn;
  controls.autoRotateSpeed = 1.4;

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  let model: THREE.Object3D | null = null;
  let token = 0;

  const resize = () => {
    const { clientWidth: width, clientHeight: height } = canvas;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  let frame = 0;
  const loop = () => { frame = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
  loop();

  const release = (object: THREE.Object3D) => object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    for (const material of ([] as THREE.Material[]).concat(mesh.material ?? [])) material.dispose();
  });

  return {
    async load(url) {
      const mine = ++token;
      const gltf = await loader.loadAsync(url);
      if (mine !== token) { release(gltf.scene); return; }
      if (model) { scene.remove(model); release(model); }
      model = gltf.scene;
      // Centre it, stand it on the shadow, and frame it whatever its size.
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
      model.position.sub(new THREE.Vector3(centre.x, box.min.y, centre.z));
      scene.add(model);
      const span = Math.max(size.x, size.y, size.z);
      shadow.scale.setScalar(Math.max(size.x, size.z) * 1.8 + span * 0.2);
      const distance = span / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) * 1.55;
      controls.target.set(0, size.y / 2, 0);
      camera.position.set(distance * 0.55, size.y / 2 + distance * 0.32, distance * 0.82);
      camera.near = distance / 100; camera.far = distance * 20; camera.updateProjectionMatrix();
      controls.minDistance = distance * 0.35; controls.maxDistance = distance * 2.5;
      controls.update();
    },
    dispose() {
      token++;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      if (model) release(model);
      shadow.geometry.dispose(); (shadow.material as THREE.Material).dispose(); shadowTexture.dispose();
      environment.dispose(); pmrem.dispose();
      renderer.dispose();
    },
  };
}

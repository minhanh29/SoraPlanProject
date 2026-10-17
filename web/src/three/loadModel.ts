// Shared GLB loading for every 3D view: meshopt-compressed catalog files, cached per URL,
// normalized so the model's bbox is centered on X/Z with its bottom at y = 0.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export interface LoadedModel {
  /** Normalized template: bottom-center at the origin. Clone it (`model.scene.clone(true)`) before adding to a scene. */
  scene: THREE.Group;
  /** Native bbox size (x = width, y = height, z = depth) in model units. */
  size: THREE.Vector3;
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<LoadedModel>>();

function loadOne(url: string): Promise<LoadedModel> {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url).then((gltf) => {
      const root = gltf.scene;
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const group = new THREE.Group();
      root.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
      group.add(root);
      return { scene: group, size };
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

/** Try URLs in order (optimized web GLB first, original second). */
export async function loadModel(urls: string[]): Promise<LoadedModel> {
  let lastError: unknown = new Error("No model URL");
  for (const url of urls) {
    try {
      return await loadOne(url);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/** Scale factors that make a model of native `size` fill `dims` (meters; w = x, d = z, h = y). */
export function fitScale(size: THREE.Vector3, dims: { w: number; d: number; h: number }): THREE.Vector3 {
  const safe = (v: number) => (v > 1e-6 ? v : 1);
  return new THREE.Vector3(dims.w / safe(size.x), dims.h / safe(size.y), dims.d / safe(size.z));
}

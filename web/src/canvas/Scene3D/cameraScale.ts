// Screen ↔ world scale helpers that work for both orthographic and perspective cameras.
import * as THREE from "three";

/** World units covered by one CSS pixel at `at` (constant for orthographic, grows with depth for perspective). */
export function worldPerPixel(camera: THREE.Camera, at: THREE.Vector3, viewportHeight: number): number {
  const ortho = camera as THREE.OrthographicCamera;
  if (ortho.isOrthographicCamera) return 1 / Math.max(ortho.zoom, 1e-3); // R3F's ortho frustum is in px / zoom
  const persp = camera as THREE.PerspectiveCamera;
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const depth = Math.max(at.clone().sub(camera.position).dot(forward), 1e-3);
  return (2 * depth * Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2)) / (Math.max(viewportHeight, 1) * persp.zoom);
}

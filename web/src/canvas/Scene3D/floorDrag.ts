import * as THREE from "three";
import { worldPerPixel } from "./cameraScale";

export interface FloorDrag {
  origin: THREE.Vector3;
  right: THREE.Vector3;
  forward: THREE.Vector3;
  x: number;
  y: number;
  metersPerPx: number;
}

/** At eye level a horizontal ray/plane intersection becomes unstable near the horizon.
 * Use a fixed screen scale and camera-relative floor axes throughout the gesture instead. */
export function startFloorDrag(camera: THREE.Camera, origin: THREE.Vector3, pointer: { clientX: number; clientY: number }, viewportHeight: number): FloorDrag {
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
  const forward = new THREE.Vector3(right.z, 0, -right.x);
  return { origin: origin.clone(), right, forward, x: pointer.clientX, y: pointer.clientY, metersPerPx: worldPerPixel(camera, origin, viewportHeight) };
}

export function floorDragPoint(drag: FloorDrag, x: number, y: number): THREE.Vector3 {
  return drag.origin.clone()
    .addScaledVector(drag.right, (x - drag.x) * drag.metersPerPx)
    .addScaledVector(drag.forward, (drag.y - y) * drag.metersPerPx);
}

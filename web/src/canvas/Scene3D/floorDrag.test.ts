import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { floorDragPoint, startFloorDrag } from "./floorDrag";

function camera(yaw = 0, pitch = 0) {
  const cam = new THREE.PerspectiveCamera(72, 1.5, 0.03, 1000);
  cam.position.set(0, 1.65, 0);
  cam.rotation.set(pitch, yaw, 0, "YXZ");
  cam.updateMatrixWorld();
  return cam;
}

describe("direct furniture drags at eye level", () => {
  it("maps sideways and vertical pointer movement to the floor while preserving elevation", () => {
    const origin = new THREE.Vector3(0, 0.3, -3);
    const drag = startFloorDrag(camera(), origin, { clientX: 100, clientY: 200 }, 800);
    expect(floorDragPoint(drag, 100, 200).toArray()).toEqual(origin.toArray());
    const moved = floorDragPoint(drag, 180, 160);
    expect(moved.x).toBeGreaterThan(0);
    expect(moved.z).toBeLessThan(-3);
    expect(moved.y).toBe(0.3);
    expect(origin.toArray()).toEqual([0, 0.3, -3]);
  });

  it("follows camera yaw and stays stable at the horizon and above the viewer", () => {
    for (const height of [0, 1.65, 2.5]) {
      const drag = startFloorDrag(camera(Math.PI / 2), new THREE.Vector3(-3, height, 0), { clientX: 100, clientY: 200 }, 800);
      const moved = floorDragPoint(drag, 180, 160);
      expect(moved.x).toBeLessThan(-3);
      expect(moved.z).toBeLessThan(0);
      expect(moved.y).toBe(height);
      expect(moved.toArray().every(Number.isFinite)).toBe(true);
      expect(moved.distanceTo(drag.origin)).toBeLessThan(1);
    }
  });

  it("keeps the drag anchored when the camera is pitched", () => {
    const cam = camera(0, -0.6);
    const drag = startFloorDrag(cam, new THREE.Vector3(0, 0.8, -3), { clientX: 100, clientY: 200 }, 800);
    cam.position.set(8, 1.65, 8);
    cam.rotation.y = 1;
    cam.updateMatrixWorld();
    const moved = floorDragPoint(drag, 100, 100);
    expect(moved.x).toBe(0);
    expect(moved.y).toBe(0.8);
    expect(moved.z).toBeLessThan(-3);
  });
});

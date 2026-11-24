import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { getLoadedModel, loadModel } from "./loadModel";

const load = vi.hoisted(() => vi.fn());
vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({ GLTFLoader: class {
  setMeshoptDecoder() {}
  loadAsync(url: string) { return load(url); }
} }));
function gltf() {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), new THREE.MeshStandardMaterial()));
  return { scene };
}
beforeEach(() => load.mockReset().mockImplementation(async () => gltf()));

describe("parsed model cache", () => {
  it("deduplicates in-flight loads and exposes warmed models synchronously", async () => {
    expect(getLoadedModel(["shared.glb"])).toBeNull();
    const [a, b] = await Promise.all([loadModel(["shared.glb"]), loadModel(["shared.glb"])]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(getLoadedModel(["shared.glb"])).toBe(a);
    expect(a.size.toArray()).toEqual([2, 1, 1]);
    expect(await loadModel(["shared.glb"])).toBe(a);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps fallback models available when an optimized download fails", async () => {
    load.mockRejectedValueOnce(new Error("not found")).mockResolvedValueOnce(gltf());
    const model = await loadModel(["missing.glb", "fallback.glb"]);
    expect(getLoadedModel(["missing.glb", "fallback.glb"])).toBe(model);
  });

  it("allows retrying a failed model", async () => {
    load.mockRejectedValueOnce(new Error("offline"));
    await expect(loadModel(["retry.glb"])).rejects.toThrow("offline");
    expect(getLoadedModel(["retry.glb"])).toBeNull();
    expect(await loadModel(["retry.glb"])).toBe(getLoadedModel(["retry.glb"]));
    expect(load).toHaveBeenCalledTimes(2);
  });
});

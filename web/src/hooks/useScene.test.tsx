import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneDoc } from "../lib/types";
import { useScene, type SceneStore } from "./useScene";
import { api } from "../lib/api";

const live = vi.hoisted(() => ({ value: undefined as SceneDoc | null | undefined }));
vi.mock("./useFirestore", () => ({ useDoc: () => live.value }));
vi.mock("../lib/api", () => ({
  api: { applyOps: vi.fn(), undo: vi.fn(), redo: vi.fn() },
  ApiError: class extends Error {},
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
let store: SceneStore;
function snapshot(version: number, style: "Japandi" | "Industrial" = "Japandi", projectId = "p1"): SceneDoc {
  return { version, undoStack: version > 1 ? ["style-batch"] : [], redoStack: [], graph: {
    schemaVersion: "1.0", id: `scene-${projectId}`, projectId, version, units: "m",
    meta: { style, palette: { wall: "#ffffff", floor: "#cccccc", accent: "#222222" }, bounds: { minX: 0, minZ: 0, maxX: 8, maxZ: 6 } },
    levels: [{ id: "ground", name: "Ground", elevation: 0, ceilingHeight: 2.7, walls: [], openings: [], rooms: [], items: [{ id: "sofa", assetId: null, label: "Sofa", category: "Sofa", position: [1, 0, 1], dims: { w: 2, d: 1, h: 1 }, rotationY: 0, scaleMode: "uniform", addedBy: "parser" }] }],
  } };
}
function Probe({ projectId }: { projectId: string }) { store = useScene(projectId); return null; }
function render(projectId = "p1") { act(() => root.render(<Probe projectId={projectId} />)); }
beforeEach(() => {
  live.value = snapshot(1);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.mocked(api.applyOps).mockReset();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("displaying committed style responses", () => {
  it("shows the saved API result immediately and lets newer live updates take over", () => {
    render();
    act(() => store.acceptScene(snapshot(2, "Industrial")));
    expect(store.graph?.meta.style).toBe("Industrial");
    expect(store.version).toBe(2);
    expect(store.canUndo).toBe(true);
    live.value = snapshot(1); render();
    expect(store.graph?.meta.style).toBe("Industrial");
    live.value = snapshot(3, "Japandi"); render();
    expect(store.version).toBe(3);
    expect(store.graph?.meta.style).toBe("Japandi");
    act(() => store.acceptScene(snapshot(2, "Industrial")));
    expect(store.version).toBe(3);
  });

  it("isolates API results when changing projects", () => {
    render();
    act(() => store.acceptScene(snapshot(2, "Industrial")));
    live.value = snapshot(1, "Japandi", "p2"); render("p2");
    expect(store.graph?.projectId).toBe("p2");
    act(() => store.acceptScene(snapshot(8, "Industrial", "p1")));
    expect(store.graph?.projectId).toBe("p2");
    expect(store.graph?.meta.style).toBe("Japandi");
  });

  it("sends subsequent furniture edits against the acknowledged version", () => {
    vi.mocked(api.applyOps).mockReturnValue(new Promise(() => {}));
    render();
    act(() => store.acceptScene(snapshot(2, "Industrial")));
    act(() => store.apply([{ op: "item.move", id: "sofa", position: [3, 0, 2] }]));
    expect(api.applyOps).toHaveBeenCalledWith("p1", expect.objectContaining({ baseVersion: 2 }));
    expect(store.graph?.levels[0].items[0].position).toEqual([3, 0, 2]);
    expect(store.graph?.meta.style).toBe("Industrial");
  });
});

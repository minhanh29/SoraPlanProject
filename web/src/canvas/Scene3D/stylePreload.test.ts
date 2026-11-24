import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset, SceneGraph } from "../../lib/types";
import type { LoadedModel } from "../../three/loadModel";
import { getLoadedModel, loadModel } from "../../three/loadModel";
import { preloadStyleModels, styleModelUrls } from "./stylePreload";

vi.mock("../../three/loadModel", () => ({ getLoadedModel: vi.fn(), loadModel: vi.fn() }));
const model = {} as LoadedModel;
beforeEach(() => { vi.mocked(getLoadedModel).mockReset().mockReturnValue(null); vi.mocked(loadModel).mockReset().mockResolvedValue(model); });
const asset = (id: string, extra: Partial<Asset> = {}): Asset => ({
  id, ownerUid: null, isSystem: true, name: id, category: "Sofa", style: "Industrial", status: "ready", progress: 100,
  imagePath: null, glbPath: null, glbWebPath: null, imageUrl: null, glbUrl: `/original/${id}.glb`, glbWebUrl: `/optimized/${id}.glb`, dims: null, frontAxis: "+z", ...extra,
});
function graph(): SceneGraph {
  return { schemaVersion: "1.0", id: "s1", projectId: "p1", version: 1, units: "m",
    meta: { style: "Japandi", palette: { wall: "#ffffff", floor: "#cccccc", accent: "#222222" }, bounds: { minX: 0, minZ: 0, maxX: 8, maxZ: 6 } },
    levels: [{ id: "ground", name: "Ground", elevation: 0, ceilingHeight: 2.7, walls: [], openings: [], rooms: [], items: [
      { id: "sofa", assetId: "current", label: "Sofa", category: "Sofa", position: [1, 0, 1], rotationY: 0, dims: { w: 2, d: 1, h: 1 }, scaleMode: "uniform", addedBy: "parser" },
    ] }],
  };
}

describe("alternate style preloading", () => {
  it("limits warming to optimized alternate catalog models used by this home", () => {
    const list = [asset("current", { style: "Japandi" }), asset("target"), asset("bed", { category: "Bed" }),
      asset("personal", { isSystem: false }), asset("failed", { status: "failed" }), asset("large-original", { glbWebUrl: null })];
    const assets = Object.fromEntries(list.map((a) => [a.id, a]));
    expect(styleModelUrls(graph(), assets)).toEqual([["/optimized/target.glb"]]);
    assets.current = asset("current", { isSystem: false });
    expect(styleModelUrls(graph(), assets)).toEqual([]);
    expect(styleModelUrls(null, assets)).toEqual([]);
  });

  it("caps decoded background models and deduplicates shared URLs", () => {
    const assets = Object.fromEntries(Array.from({ length: 30 }, (_, i) => { const a = asset(`sofa-${i}`); return [a.id, a]; }));
    expect(styleModelUrls(graph(), assets)).toHaveLength(16);
    Object.values(assets).forEach((a) => { a.glbWebUrl = "/shared.glb"; });
    expect(styleModelUrls(graph(), assets)).toEqual([["/shared.glb"]]);
  });

  it("runs at most two background loads and stops queued work when canceled", async () => {
    const complete: (() => void)[] = [];
    vi.mocked(loadModel).mockImplementation(() => new Promise((resolve) => complete.push(() => resolve(model))));
    const abort = new AbortController();
    const pending = preloadStyleModels([["a"], ["b"], ["c"], ["d"]], abort.signal);
    expect(loadModel).toHaveBeenCalledTimes(2);
    abort.abort();
    complete.forEach((resolve) => resolve());
    await pending;
    expect(loadModel).toHaveBeenCalledTimes(2);
  });

  it("skips warm models and tolerates a failed download", async () => {
    vi.mocked(getLoadedModel).mockImplementation((urls) => urls[0] === "warm" ? model : null);
    vi.mocked(loadModel).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(model);
    await expect(preloadStyleModels([["warm"], ["failed"], ["ready"]], new AbortController().signal)).resolves.toBeUndefined();
    expect(loadModel).toHaveBeenCalledTimes(2);
  });

  it("warms bath sink counterparts in both directions without warming kitchen sinks", () => {
    const home = graph();
    home.levels[0].items[0].category = "Sink";
    const assets = {
      current: asset("current", { category: "Sink", style: "Japandi" }),
      industrial: asset("industrial", { category: "Bathroom Vanity" }),
      kitchen: asset("kitchen", { category: "Kitchen Sink" }),
    };
    expect(styleModelUrls(home, assets)).toEqual([["/optimized/industrial.glb"]]);
    home.meta.style = "Industrial";
    home.levels[0].items[0].assetId = "industrial";
    // The model's category takes precedence over a stale scene category.
    home.levels[0].items[0].category = "Kitchen Sink";
    expect(styleModelUrls(home, assets)).toEqual([["/optimized/current.glb"]]);
  });
});

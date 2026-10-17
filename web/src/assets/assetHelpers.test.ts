import { describe, expect, it } from "vitest";
import type { Asset } from "../lib/types";
import { filterAssets, nameFromFile, sortAssets, statusLabel, validatePhoto } from "./assetHelpers";

const mk = (p: Partial<Asset>): Asset => ({
  id: "a",
  ownerUid: null,
  isSystem: true,
  name: "Sofa",
  category: "Sofa",
  style: "Industrial",
  imagePath: null,
  glbPath: null,
  glbWebPath: null,
  imageUrl: null,
  glbUrl: null,
  glbWebUrl: null,
  dims: null,
  frontAxis: "+z",
  status: "ready",
  progress: 100,
  ...p,
});

describe("filterAssets", () => {
  const list = [
    mk({ id: "1", name: "Industrial Sofa", category: "Sofa", style: "Industrial" }),
    mk({ id: "2", name: "Japandi Bed", category: "Bed", style: "Japandi" }),
    mk({ id: "3", name: "Oak thing", category: "Dining Table", style: "Japandi" }),
  ];
  it("matches name or category case-insensitively", () => {
    expect(filterAssets(list, "SOFA").map((a) => a.id)).toEqual(["1"]);
    expect(filterAssets(list, "dining").map((a) => a.id)).toEqual(["3"]);
  });
  it("applies the style filter", () => {
    expect(filterAssets(list, "", "Japandi").map((a) => a.id)).toEqual(["2", "3"]);
    expect(filterAssets(list, "  ", "all")).toHaveLength(3);
  });
});

describe("statusLabel", () => {
  it("hides ready, shows progress and failure", () => {
    expect(statusLabel({ status: "ready", progress: 100 })).toBeNull();
    expect(statusLabel({ status: "generating_3d", progress: 41.6 })).toEqual({ text: "Generating 3D 42%", tone: "accent" });
    expect(statusLabel({ status: "failed", progress: 0 })?.tone).toBe("danger");
    expect(statusLabel({ status: "uploaded", progress: 0 })?.text).toBe("Uploaded");
  });
});

describe("misc", () => {
  it("sorts newest first", () => {
    const a = mk({ id: "old", createdAt: new Date(2020, 1, 1) });
    const b = mk({ id: "new", createdAt: new Date(2024, 1, 1) });
    expect(sortAssets([a, b]).map((x) => x.id)).toEqual(["new", "old"]);
  });
  it("validates photos and derives names", () => {
    expect(validatePhoto({ type: "image/gif", size: 10 })).toMatch(/PNG/);
    expect(validatePhoto({ type: "image/png", size: 30 * 1024 * 1024 })).toMatch(/25 MB/);
    expect(validatePhoto({ type: "image/webp", size: 10 })).toBeNull();
    expect(nameFromFile("my-oak_chair.jpg")).toBe("My oak chair");
  });
});

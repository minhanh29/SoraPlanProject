import { describe, expect, it } from "vitest";
import type { ItemInstance } from "../../lib/types";
import { furnitureDraft, furnitureTransform } from "./furnitureTransform";

const item: ItemInstance = { id: "sofa", assetId: null, label: "Sofa", category: null, position: [2.123456, 0, 3], dims: { w: 2.123456, d: 0.05, h: 0.8 }, rotationY: Math.PI / 7, scaleMode: "uniform", addedBy: "parser" };

describe("furniture form edits", () => {
  it("leaves untouched precise values unchanged in meters and feet", () => {
    expect(furnitureTransform(item, furnitureDraft(item, "m"), "m")).toEqual([]);
    expect(furnitureTransform(item, furnitureDraft(item, "ft"), "ft")).toEqual([]);
  });

  it("batches relocation, independent dimensions and rotation for one undo", () => {
    const draft = { ...furnitureDraft(item, "m"), x: "-1.5", y: "0.2", z: "4", w: "3", h: "1", angle: "450" };
    expect(furnitureTransform(item, draft, "m")).toEqual([
      { op: "item.move", id: item.id, position: [-1.5, 0.2, 4] },
      { op: "item.resize", id: item.id, dims: { w: 3, d: 0.05, h: 1 } },
      { op: "item.rotate", id: item.id, rotationY: Math.PI / 2 },
    ]);
  });

  it("converts decimal feet to stored meters", () => {
    const ops = furnitureTransform(item, { ...furnitureDraft(item, "ft"), w: "6", x: "10" }, "ft");
    expect(ops).toEqual([
      { op: "item.move", id: item.id, position: [3.048, 0, 3] },
      { op: "item.resize", id: item.id, dims: { w: 1.8288, d: 0.05, h: 0.8 } },
    ]);
  });

  it("rejects blank, non-finite, out-of-range and below-floor input", () => {
    for (const changes of [{ w: "" }, { x: "Infinity" }, { x: "1e308" }, { w: "0.049" }, { h: "12.01" }, { y: "-0.1" }, { angle: "NaN" }]) {
      expect(() => furnitureTransform(item, { ...furnitureDraft(item, "m"), ...changes }, "m")).toThrow();
    }
  });
});

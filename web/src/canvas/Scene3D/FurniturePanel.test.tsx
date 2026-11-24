import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemInstance, SceneRoom } from "../../lib/types";
import FurniturePanel from "./FurniturePanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const items: ItemInstance[] = [
  { id: "sofa", assetId: null, label: "Sofa", category: "Sofa", position: [1, 0, 1], dims: { w: 2, d: 1, h: 0.8 }, rotationY: 0, scaleMode: "uniform", addedBy: "parser" },
  { id: "chair", assetId: null, label: "Chair", category: "Chair", roomId: "stale-room", position: [6, 0, 1], dims: { w: 0.6, d: 0.6, h: 1 }, rotationY: 0, scaleMode: "uniform", addedBy: "user" },
];
const rooms: SceneRoom[] = [{ id: "living", name: "Living room", type: "living", area: 16, polygon: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }] }];
let host: HTMLDivElement;
let root: Root;
const apply = vi.fn();
const select = vi.fn();

beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); apply.mockReset(); select.mockReset(); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
function render(selectedId: string | null = "sofa") {
  act(() => root.render(<FurniturePanel items={items} rooms={rooms} selectedId={selectedId} units="m" onSelect={select} onApply={apply} onClose={() => undefined} />));
}
function input(label: string, value: string) {
  const el = Array.from(host.querySelectorAll("label")).find((l) => l.textContent?.includes(label))?.querySelector("input") || host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function submit() { act(() => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); }

describe("furniture editor", () => {
  it("can select every item, including furniture outside the current room view", () => {
    render(null);
    const chair = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Chair"))!;
    act(() => chair.click());
    expect(select).toHaveBeenCalledWith("chair");
    render("chair");
    expect(host.querySelector("form strong")?.textContent).toBe("Chair");
  });

  it("submits size, position and rotation together without saving incomplete typing", () => {
    render();
    input("Width", "3"); input("X", "2.5"); input("Rotation", "90");
    expect(apply).not.toHaveBeenCalled();
    submit();
    expect(apply).toHaveBeenCalledWith([
      { op: "item.move", id: "sofa", position: [2.5, 0, 1] },
      { op: "item.resize", id: "sofa", dims: { w: 3, d: 1, h: 0.8 } },
      { op: "item.rotate", id: "sofa", rotationY: Math.PI / 2 },
    ], "Edit Sofa");
  });

  it("shows invalid input and lets the user reset it", () => {
    render(); input("Width", "0"); submit();
    expect(apply).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("0.05 and 12 m");
    act(() => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Reset")!.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });

  it("filters by the actual room and handles a removed selection", () => {
    render("removed-item"); input("Find furniture", "Living room");
    const list = host.querySelector('[aria-label="Furniture in your home"]')!;
    expect(list.textContent).toContain("Sofa");
    expect(list.textContent).not.toContain("Chair");
    expect(host.querySelector("form")).toBeNull();
  });
});

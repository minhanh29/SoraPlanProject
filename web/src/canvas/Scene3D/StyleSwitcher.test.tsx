import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StyleSwitcher from "./StyleSwitcher";
import type { SceneDoc, StyleId } from "../../lib/types";
import { api } from "../../lib/api";

vi.mock("../../lib/api", () => ({ api: { switchSceneStyle: vi.fn() } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); vi.mocked(api.switchSceneStyle).mockReset(); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
function render(style: StyleId = "Japandi", version = 1, disabled = false) {
  act(() => root.render(<StyleSwitcher projectId="project-1" style={style} version={version} disabled={disabled} />));
}
const button = (name: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === name)!;

describe("project style switch", () => {
  it("shows both collections and keeps the current style selected", () => {
    render();
    expect(button("Japandi").getAttribute("aria-pressed")).toBe("true");
    expect(button("Industrial").getAttribute("aria-pressed")).toBe("false");
    expect(button("Industrial").disabled).toBe(false);
  });

  it("switches the project once and waits for its saved scene snapshot", async () => {
    let resolve!: (r: { newVersion: number; retainedItems: number }) => void;
    vi.mocked(api.switchSceneStyle).mockReturnValue(new Promise((r) => { resolve = r; }));
    render();
    act(() => { button("Industrial").click(); button("Industrial").click(); });
    expect(api.switchSceneStyle).toHaveBeenCalledTimes(1);
    expect(api.switchSceneStyle).toHaveBeenCalledWith("project-1", "Industrial", 1);
    expect(button("Japandi").disabled).toBe(true);
    expect(button("Industrial").disabled).toBe(true);
    await act(async () => resolve({ newVersion: 2, retainedItems: 0 }));
    expect(button("Industrial").disabled).toBe(true);
    render("Industrial", 2);
    expect(button("Industrial").getAttribute("aria-pressed")).toBe("true");
    expect(button("Japandi").disabled).toBe(false);
    vi.mocked(api.switchSceneStyle).mockResolvedValue({ newVersion: 3, retainedItems: 0 });
    await act(async () => button("Japandi").click());
    expect(api.switchSceneStyle).toHaveBeenLastCalledWith("project-1", "Japandi", 2);
  });

  it("keeps the original selection and allows retry after a failed request", async () => {
    vi.mocked(api.switchSceneStyle).mockRejectedValue(new Error("The scene changed. Try again."));
    render();
    await act(async () => button("Industrial").click());
    expect(button("Japandi").getAttribute("aria-pressed")).toBe("true");
    expect(button("Industrial").disabled).toBe(false);
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("waits for outstanding furniture saves before switching styles", () => {
    render("Japandi", 1, true);
    act(() => button("Industrial").click());
    expect(api.switchSceneStyle).not.toHaveBeenCalled();
  });

  it("passes the committed scene directly to the viewer without waiting for Firestore", async () => {
    const scene = { version: 2, graph: { meta: { style: "Industrial" } }, undoStack: ["style"], redoStack: [] } as unknown as SceneDoc;
    const applied = vi.fn();
    vi.mocked(api.switchSceneStyle).mockResolvedValue({ newVersion: 2, retainedItems: 0, scene });
    act(() => root.render(<StyleSwitcher projectId="project-1" style="Japandi" version={1} disabled={false} onApplied={applied} />));
    await act(async () => button("Industrial").click());
    expect(applied).toHaveBeenCalledWith(scene);
  });
});

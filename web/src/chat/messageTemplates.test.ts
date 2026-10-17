import { describe, expect, it } from "vitest";
import type { MessageKind } from "../lib/types";
import { renderTemplate, templates } from "./messageTemplates";

describe("message templates", () => {
  it("has copy for every predefined card kind", () => {
    const kinds: MessageKind[] = ["crop_request", "parse_started", "plan_ready", "plan_failed", "style_picker", "mapping_result", "scene_ready"];
    for (const k of kinds) expect(renderTemplate(k, {}).length, k).toBeGreaterThan(10);
  });

  it("pluralizes plan stats", () => {
    expect(renderTemplate("plan_ready", { stats: { rooms: 1, walls: 12, items: 0 } })).toContain("1 room, 12 walls and 0 objects");
  });

  it("describes mapping results with and without missing objects", () => {
    const some = renderTemplate("mapping_result", { style: "Japandi", matched: 9, missing: [{ componentId: "a", label: "Desk", category: null }] });
    expect(some).toContain("**9 pieces** from the Japandi collection");
    expect(some).toContain("**1 object** has no match yet");
    const none = renderTemplate("mapping_result", { style: "Industrial", matched: 1, missing: [] });
    expect(none).toContain("Everything has a model");
  });

  it("text kinds have no template (Gemini writes them)", () => {
    expect(templates.text).toBeUndefined();
    expect(renderTemplate("text", {})).toBe("");
  });

  it("scene_ready mentions the style", () => {
    expect(renderTemplate("scene_ready", { style: "Industrial", sceneVersion: 1 })).toContain("in Industrial style");
  });
});

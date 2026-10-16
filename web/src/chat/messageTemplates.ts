// The ONE place for predefined chat copy. The backend writes only `kind` + `payload`.
import type {
  MappingResultPayload,
  MessageKind,
  PlanFailedPayload,
  PlanReadyPayload,
  SceneReadyPayload,
} from "../lib/types";

type Payload = Record<string, any>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const templates: Partial<Record<MessageKind, (p: Payload) => string>> = {
  crop_request: () =>
    "**Let's crop your plan.** Drag the handles so the box hugs the outer walls and leaves out titles, margins " +
    "and dimension text. A tight crop gives me the right scale. Press **Confirm crop** — or just tell me you're done.",
  parse_started: () => "**Reading your floor plan…** This takes about a minute.",
  plan_ready: (p) => {
    const s = (p as PlanReadyPayload).stats || { rooms: 0, walls: 0, items: 0 };
    return (
      `**Your plan is ready.** I found ${plural(s.rooms, "room")}, ${plural(s.walls, "wall")} and ${plural(s.items, "object")}. ` +
      "Check it on the right: fix anything I got wrong, or draw missing furniture with **Add box**. Say *looks right* when you're happy."
    );
  },
  plan_failed: (p) =>
    `**I couldn't read that plan.** ${(p as PlanFailedPayload).error ? "Try again, or crop tighter around the walls." : ""}`,
  style_picker: () => "**Pick a style** for your home. I'll furnish every room from that collection.",
  mapping_result: (p) => {
    const m = p as MappingResultPayload;
    const missing = m.missing?.length || 0;
    return (
      `I placed **${plural(m.matched || 0, "piece")}** from the ${m.style} collection. ` +
      (missing
        ? `**${plural(missing, "object")}** ${missing === 1 ? "has" : "have"} no match yet — upload a photo to turn it into 3D, or skip ${missing === 1 ? "it" : "them"}. ` +
          "You can also resize any placed model before we build the 3D home."
        : "Everything has a model.")
    );
  },
  scene_ready: (p) => {
    const s = p as SceneReadyPayload & { items?: number };
    return (
      `**Your 3D home is ready**${s.style ? ` in ${s.style} style` : ""}. Drag furniture to move it, use the ring to rotate, ` +
      "or just ask me — e.g. *move the sofa 50 cm left* or *paint the walls sage green*."
    );
  },
};

export function renderTemplate(kind: MessageKind, payload: Payload): string {
  return templates[kind]?.(payload || {}) ?? "";
}

/** Human labels for worker job stages (parse progress card). */
export const PARSE_STAGES: { key: string; label: string }[] = [
  { key: "queued", label: "Queued" },
  { key: "downloading_image", label: "Fetching your plan" },
  { key: "analyzing_with_ai", label: "Finding walls, rooms and furniture" },
  { key: "saving_results", label: "Building the 2D plan" },
];

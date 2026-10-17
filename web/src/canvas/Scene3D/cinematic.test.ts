import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { SceneGraph } from "../../lib/types";
import { EYE_HEIGHT, planTour, sampleTour } from "./cinematic";
import { pointInPolygon } from "./geometry";

// The backend's golden scene (floorplan_1, Japandi): real rooms, walls and furniture.
const graph: SceneGraph = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../../backend/api/tests/fixtures/floorplan_1.scene.json"), "utf8"),
);

describe("cinematic tour", () => {
  const tour = planTour(graph, { title: "Test home", subtitle: "Japandi" });
  const level = graph.levels[0];

  it("opens and closes with aerial shots around one interior shot per eligible room", () => {
    expect(tour.shots[0].kind).toBe("aerial");
    expect(tour.shots[tour.shots.length - 1].kind).toBe("aerial");
    const interiors = tour.shots.filter((s) => s.kind === "interior");
    expect(interiors.length).toBeGreaterThan(0);
    expect(new Set(interiors.map((s) => s.roomId)).size).toBe(interiors.length);
    expect(tour.duration).toBeCloseTo(tour.shots.reduce((s, x) => s + x.duration, 0));
  });

  it("keeps interior cameras inside their room at eye height for the whole move", () => {
    for (const shot of tour.shots.filter((s) => s.kind === "interior")) {
      const room = level.rooms.find((r) => r.id === shot.roomId)!;
      for (const pose of [shot.from, shot.to]) {
        expect(pointInPolygon(pose.pos[0], pose.pos[2], room.polygon)).toBe(true);
        expect(Math.abs(pose.pos[1] - EYE_HEIGHT)).toBeLessThan(0.11);
      }
    }
  });

  it("samples continuously with dips to black at cuts and captions in between", () => {
    const start = sampleTour(tour, 0);
    expect(start.fade).toBe(1); // opens from black
    expect(sampleTour(tour, tour.duration).fade).toBe(1); // ends on black
    const mid = sampleTour(tour, tour.shots[0].duration / 2);
    expect(mid.fade).toBe(0);
    expect(mid.captionAlpha).toBe(1);
    expect(mid.caption?.title).toBe("Test home");
    const cut = sampleTour(tour, tour.shots[0].duration); // first frame of shot 2
    expect(cut.shotIndex).toBe(1);
    expect(cut.fade).toBeGreaterThan(0.9);
    expect(cut.interior).toBe(tour.shots[1].kind === "interior");
  });

  it("moves smoothly within a shot (no jumps between consecutive frames)", () => {
    const fps = 30;
    for (let f = 1; f < tour.duration * fps; f++) {
      const a = sampleTour(tour, (f - 1) / fps);
      const b = sampleTour(tour, f / fps);
      if (a.shotIndex !== b.shotIndex) continue; // cuts are allowed to jump
      expect(Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1], b.position[2] - a.position[2])).toBeLessThan(0.5);
    }
  });
});

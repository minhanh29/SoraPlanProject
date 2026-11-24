import type { ItemInstance, PlanUnits, SceneOp, Vec3 } from "../../lib/types";
import { FT_TO_M } from "../../lib/units";
import { normalizeAngle } from "./geometry";

export type FurnitureDraft = Record<"w" | "d" | "h" | "x" | "y" | "z" | "angle", string>;

export function furnitureDraft(item: ItemInstance, units: PlanUnits): FurnitureDraft {
  const factor = units === "ft" ? FT_TO_M : 1;
  const length = (v: number) => String(Number((v / factor).toFixed(4)));
  return {
    w: length(item.dims.w), d: length(item.dims.d), h: length(item.dims.h),
    x: length(item.position[0]), y: length(item.position[1]), z: length(item.position[2]),
    angle: String(Number(((item.rotationY * 180) / Math.PI).toFixed(2))),
  };
}

/** One batch means an entire form edit is saved and undone together. */
export function furnitureTransform(item: ItemInstance, draft: FurnitureDraft, units: PlanUnits): SceneOp[] {
  if (Object.values(draft).some((v) => !v.trim() || !Number.isFinite(Number(v)))) throw new Error("Enter a valid number in every field.");
  const original = furnitureDraft(item, units);
  const factor = units === "ft" ? FT_TO_M : 1;
  // Retain exact stored values for untouched fields, including dimensions displayed in feet.
  const length = (key: keyof FurnitureDraft, value: number) => draft[key] === original[key] ? value : Math.round(Number(draft[key]) * factor * 10000) / 10000;
  const dims = { w: length("w", item.dims.w), d: length("d", item.dims.d), h: length("h", item.dims.h) };
  if (Object.values(dims).some((v) => v < 0.05 || v > 12)) {
    throw new Error(units === "ft" ? "Each dimension must be between 0.1641 and 39.3701 ft." : "Each dimension must be between 0.05 and 12 m.");
  }
  const position: Vec3 = [length("x", item.position[0]), length("y", item.position[1]), length("z", item.position[2])];
  if (position.some((v) => !Number.isFinite(v))) throw new Error("Enter a finite position.");
  if (position[1] < 0) throw new Error("Elevation must be zero or above the floor.");
  const rotationY = draft.angle === original.angle ? item.rotationY : normalizeAngle(((Number(draft.angle) % 360) * Math.PI) / 180);
  const ops: SceneOp[] = [];
  if (position.some((v, i) => v !== item.position[i])) ops.push({ op: "item.move", id: item.id, position });
  if (Object.entries(dims).some(([k, v]) => v !== item.dims[k as keyof typeof dims])) ops.push({ op: "item.resize", id: item.id, dims });
  if (Math.abs(rotationY - item.rotationY) > 1e-8) ops.push({ op: "item.rotate", id: item.id, rotationY });
  return ops;
}

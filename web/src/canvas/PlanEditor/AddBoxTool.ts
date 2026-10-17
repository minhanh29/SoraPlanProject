// Add-box tool helpers: turn a dragged rectangle + category/label into a plan box.
import { newBoxId, rectFromDrag, type BoxObj } from "./model";

export const MIN_NEW_BOX = 0.3; // plan units; smaller drags are treated as clicks

export function boxFromDrag(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  bounds: { w: number; h: number },
): { x: number; y: number; w: number; h: number } | null {
  const r = rectFromDrag(
    Math.max(0, Math.min(bounds.w, ax)),
    Math.max(0, Math.min(bounds.h, ay)),
    Math.max(0, Math.min(bounds.w, bx)),
    Math.max(0, Math.min(bounds.h, by)),
  );
  if (r.w < MIN_NEW_BOX || r.h < MIN_NEW_BOX) return null;
  return r;
}

export function makeUserBox(
  rect: { x: number; y: number; w: number; h: number },
  category: string,
  label: string,
): BoxObj {
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    id: newBoxId(),
    type: "furniture",
    name: label.trim() || category,
    subtype: "unknown", // the catalog category drives mapping for user boxes
    category,
    x: r(rect.x),
    y: r(rect.y),
    w: r(rect.w),
    h: r(rect.h),
    rotation: 0,
    confidence: 1,
    addedBy: "user",
  };
}

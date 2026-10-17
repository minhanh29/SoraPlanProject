import type { FloorPlan, PlanUnits } from "./types";

export const FT_TO_M = 0.3048;
export const DEFAULT_NORMALIZED_WIDTH_M = 10;

/** Plan-unit → meter factor k (same rule as backend scene_builder.plan_scale). */
export function planScale(plan: Pick<FloorPlan, "units" | "width" | "height">): number {
  if (plan.units === "m") return 1;
  if (plan.units === "ft") return FT_TO_M;
  const longer = Math.max(plan.width || 1, plan.height || 1);
  return DEFAULT_NORMALIZED_WIDTH_M / longer;
}

/** Show lengths as cm, or ft-in when the plan was drawn in feet. */
export function formatLength(meters: number, units: PlanUnits = "m"): string {
  if (units === "ft") {
    const totalIn = meters / 0.0254;
    let ft = Math.floor(totalIn / 12);
    let inch = Math.round(totalIn - ft * 12);
    if (inch === 12) {
      ft += 1;
      inch = 0;
    }
    return `${ft}′${inch}″`;
  }
  return `${Math.round(meters * 100)} cm`;
}

export function formatDims(d: { w: number; d: number; h: number }, units: PlanUnits = "m"): string {
  return `${formatLength(d.w, units)} × ${formatLength(d.d, units)} × ${formatLength(d.h, units)}`;
}

/** Plan-unit length label ("12.5′" / "3.8 m"). */
export function formatPlanLength(v: number, units: PlanUnits): string {
  return units === "ft" ? `${v.toFixed(1)}′` : `${v.toFixed(2)} m`;
}

export const deg2rad = (d: number) => (d * Math.PI) / 180;
export const rad2deg = (r: number) => (r * 180) / Math.PI;

export function relativeTime(date: Date | null | undefined, now = Date.now()): string {
  if (!date) return "";
  const s = Math.max(0, (now - date.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function shortDate(date: Date | null | undefined): string {
  return date ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}

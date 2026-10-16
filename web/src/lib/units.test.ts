import { describe, expect, it } from "vitest";
import { formatLength, planScale } from "./units";

describe("planScale", () => {
  it("converts feet and meters", () => {
    expect(planScale({ units: "ft", width: 40, height: 30 })).toBeCloseTo(0.3048);
    expect(planScale({ units: "m", width: 12, height: 9 })).toBe(1);
  });
  it("scales normalized plans so the longer side is 10 m", () => {
    expect(planScale({ units: "normalized", width: 100, height: 50 })).toBeCloseTo(0.1);
    expect(planScale({ units: "normalized", width: 1, height: 2 })).toBeCloseTo(5);
  });
});

describe("formatLength", () => {
  it("formats cm", () => {
    expect(formatLength(2.104)).toBe("210 cm");
  });
  it("formats ft-in with carry", () => {
    expect(formatLength(1.8796, "ft")).toBe("6′2″");
    expect(formatLength(0.3045, "ft")).toBe("1′0″");
  });
});

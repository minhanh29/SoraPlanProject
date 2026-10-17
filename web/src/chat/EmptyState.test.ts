import { describe, expect, it } from "vitest";
import { titleFromFilename } from "./EmptyState";

describe("titleFromFilename (mirrors backend title_from_filename)", () => {
  it("turns a file name into a project name", () => {
    expect(titleFromFilename("my_new-house.plan.png")).toBe("My new house.plan");
    expect(titleFromFilename("C:\\plans\\floor_1.pdf")).toBe("Floor 1");
    expect(titleFromFilename(".png")).toBe("New project");
  });
});

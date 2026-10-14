import { describe, expect, it } from "vitest";
import { defaultConsoleSkillSlug } from "./skillContract.js";

describe("defaultConsoleSkillSlug", () => {
  it("matches the from-<alias> freeze", () => {
    expect(defaultConsoleSkillSlug("demo")).toBe("from-demo");
    expect(defaultConsoleSkillSlug("Demo_App")).toBe("from-demo-app");
  });
});

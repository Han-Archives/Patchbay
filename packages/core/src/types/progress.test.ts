import { describe, expect, it } from "vitest";
import { progressSchema } from "./progress.js";

describe("Progress", () => {
  it("parses with current set to null and empty history", () => {
    const result = progressSchema.safeParse({ current: null, history: [] });
    expect(result.success).toBe(true);
  });

  it("parses with a current entry and history", () => {
    const result = progressSchema.safeParse({
      current: {
        project: "patchbay",
        skill: "map-project",
        step: "scan",
        summary: "Scanning repo for ports",
        timestamp: "2026-09-13T00:00:00Z",
      },
      history: [
        {
          project: "patchbay",
          summary: "Bootstrapped the workspace",
          timestamp: "2026-09-12T00:00:00Z",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing current field", () => {
    expect(progressSchema.safeParse({ history: [] }).success).toBe(false);
  });

  it("rejects a history entry missing a summary", () => {
    const result = progressSchema.safeParse({
      current: null,
      history: [{ project: "patchbay", timestamp: "2026-09-12T00:00:00Z" }],
    });
    expect(result.success).toBe(false);
  });
});

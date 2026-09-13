import { describe, expect, it } from "vitest";
import { studioSchema } from "./studio.js";

describe("Studio", () => {
  it("parses a studio with no registered projects", () => {
    const result = studioSchema.safeParse({ name: "My Studio" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.projects).toEqual([]);
    }
  });

  it("parses a studio with a registered local_repo project", () => {
    const result = studioSchema.safeParse({
      name: "My Studio",
      projects: [{ alias: "patchbay", kind: "local_repo", path: "/Users/me/code/patchbay" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a registered project kind other than local_repo", () => {
    const result = studioSchema.safeParse({
      name: "My Studio",
      projects: [{ alias: "patchbay", kind: "remote_repo", path: "/tmp/patchbay" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a registered project missing a path", () => {
    const result = studioSchema.safeParse({
      name: "My Studio",
      projects: [{ alias: "patchbay", kind: "local_repo" }],
    });
    expect(result.success).toBe(false);
  });
});

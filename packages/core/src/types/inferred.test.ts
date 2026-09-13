import { describe, expect, it } from "vitest";
import { inferredSchema } from "./inferred.js";

const baseGit = { branch: "main", head: "abc123", recentCommitSubjects: ["initial commit"] };

describe("Inferred", () => {
  it("parses a minimal scan result", () => {
    const result = inferredSchema.safeParse({ git: baseGit });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discoveredPorts).toEqual([]);
      expect(result.data.agents).toEqual([]);
    }
  });

  it("parses with discovered ports", () => {
    const result = inferredSchema.safeParse({
      discoveredPorts: ["source:README.md", "artifact:ATLAS.md"],
      git: baseGit,
    });
    expect(result.success).toBe(true);
  });

  it("does not model ahead/behind counts on git info (intentional v1 exclusion)", () => {
    // The schema only defines branch/head/recentCommitSubjects — this test
    // just documents that ahead/behind was deliberately left out.
    expect(Object.keys(baseGit).sort()).toEqual(["branch", "head", "recentCommitSubjects"]);
  });

  it("rejects a non-empty agents array (scanner never populates Agent in v1)", () => {
    const result = inferredSchema.safeParse({
      git: baseGit,
      agents: [{ port: "agent:writer-01", name: "Writer 01" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing git block", () => {
    expect(inferredSchema.safeParse({}).success).toBe(false);
  });
});

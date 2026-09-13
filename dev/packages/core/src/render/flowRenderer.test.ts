import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inferredSchema } from "../types/inferred.js";
import { overlaySchema } from "../types/overlay.js";
import { renderFlow } from "./flowRenderer.js";

const baseGit = { branch: "main", head: "a".repeat(40), recentCommitSubjects: [] };
const emptyOverlay = overlaySchema.parse({});

function expectedNodeId(portId: string): string {
  return `n${createHash("sha1").update(portId).digest("hex").slice(0, 12)}`;
}

describe("renderFlow", () => {
  it("produces a valid, non-throwing mermaid block with zero ports and zero patches/wires", () => {
    const inferred = inferredSchema.parse({ discoveredPorts: [], git: baseGit });
    const md = renderFlow(inferred, emptyOverlay);
    expect(md).toContain("```mermaid");
    expect(md).toContain("flowchart TD");
    expect(md.trim().endsWith("```")).toBe(true);
  });

  it("emits one node per discovered port, with the exact n+sha1[0..12] node id and quoted label", () => {
    const inferred = inferredSchema.parse({
      discoveredPorts: ["skill:map-project", "source:README.md"],
      git: baseGit,
    });
    const md = renderFlow(inferred, emptyOverlay);

    const idA = expectedNodeId("skill:map-project");
    const idB = expectedNodeId("source:README.md");

    expect(idA).toMatch(/^n[0-9a-f]{12}$/);
    expect(md).toContain(`${idA}["skill:map-project"]`);
    expect(md).toContain(`${idB}["source:README.md"]`);
  });

  it("emits an edge per patch and per wire, labeled with kind, declaring endpoints not in discoveredPorts", () => {
    const inferred = inferredSchema.parse({ discoveredPorts: ["skill:map-project"], git: baseGit });
    const overlay = overlaySchema.parse({
      patches: [{ project: "demo", from: "skill:map-project", to: "artifact:ATLAS.md", kind: "produces" }],
      wires: [
        {
          project: "demo",
          from: "skill:map-project",
          to: "artifact:FLOW.md",
          kind: "produces",
          install: "symlink",
        },
      ],
    });
    const md = renderFlow(inferred, overlay);

    const fromId = expectedNodeId("skill:map-project");
    const atlasId = expectedNodeId("artifact:ATLAS.md");
    const flowId = expectedNodeId("artifact:FLOW.md");

    expect(md).toContain(`${fromId} -->|produces| ${atlasId}`);
    expect(md).toContain(`${fromId} -->|produces| ${flowId}`);
    // artifact: targets aren't in discoveredPorts but must still be declared as nodes.
    expect(md).toContain(`${atlasId}["artifact:ATLAS.md"]`);
    expect(md).toContain(`${flowId}["artifact:FLOW.md"]`);
  });

  it("phase 3 typical case: overlay has no patches/wires yet -> zero edges (not a bug)", () => {
    const inferred = inferredSchema.parse({ discoveredPorts: ["skill:map-project"], git: baseGit });
    const md = renderFlow(inferred, emptyOverlay);
    expect(md).not.toContain("-->");
  });
});

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inferredSchema } from "../types/inferred.js";
import { overlaySchema } from "../types/overlay.js";
import { renderFlow, renderFlowFile, renderFlowProgress } from "./flowRenderer.js";

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

describe("renderFlowProgress (Phase 5: progress mode)", () => {
  it("produces a valid, non-throwing mermaid block with zero commits", () => {
    const inferred = inferredSchema.parse({ discoveredPorts: [], git: baseGit });
    const md = renderFlowProgress(inferred);
    expect(md).toContain("```mermaid");
    expect(md).toContain("flowchart TD");
    expect(md.trim().endsWith("```")).toBe(true);
    expect(md).not.toContain("-->");
  });

  it("orders nodes oldest-first (reversing the most-recent-first recentCommitSubjects array) and chains them in sequence", () => {
    const inferred = inferredSchema.parse({
      discoveredPorts: [],
      git: { ...baseGit, recentCommitSubjects: ["third (newest)", "second", "first (oldest)"] },
    });
    const md = renderFlowProgress(inferred);

    // Oldest-first: c0 is the oldest commit, chained forward to the newest.
    expect(md).toContain('c0["first (oldest)"]');
    expect(md).toContain('c1["second"]');
    expect(md).toContain('c2["third (newest)"]');
    expect(md).toContain("c0 --> c1");
    expect(md).toContain("c1 --> c2");

    const oldestIndex = md.indexOf("c0[");
    const middleIndex = md.indexOf("c1[");
    const newestIndex = md.indexOf("c2[");
    expect(oldestIndex).toBeLessThan(middleIndex);
    expect(middleIndex).toBeLessThan(newestIndex);
  });

  it("sanitizes commit subjects for Mermaid label safety (no raw double quotes, no embedded newlines)", () => {
    const inferred = inferredSchema.parse({
      discoveredPorts: [],
      git: { ...baseGit, recentCommitSubjects: ['fix: handle "quoted" edge\ncase'] },
    });
    const md = renderFlowProgress(inferred);
    expect(md).not.toMatch(/\["[^"]*"[^"]*"/); // no unescaped internal quote breaking the label
    expect(md).not.toContain("case\ncase"); // no literal newline surviving into a node line
  });
});

describe("renderFlowFile (Phase 5: combined FLOW.md content)", () => {
  it("architecture-mode content is byte-identical to renderFlow's own output for existing callers", () => {
    const inferred = inferredSchema.parse({
      discoveredPorts: ["skill:map-project"],
      git: { ...baseGit, recentCommitSubjects: ["only commit"] },
    });
    const overlay = overlaySchema.parse({
      patches: [{ project: "demo", from: "skill:map-project", to: "artifact:ATLAS.md", kind: "produces" }],
    });

    const combined = renderFlowFile(inferred, overlay);
    const architectureOnly = renderFlow(inferred, overlay);

    expect(combined.startsWith(architectureOnly)).toBe(true);
  });

  it("appends a ## Progress heading and the progress-mode block after the architecture block", () => {
    const inferred = inferredSchema.parse({
      discoveredPorts: [],
      git: { ...baseGit, recentCommitSubjects: ["did the thing"] },
    });
    const combined = renderFlowFile(inferred, emptyOverlay);

    expect(combined).toContain("## Progress");
    expect(combined.indexOf("## Progress")).toBeGreaterThan(combined.indexOf("flowchart TD"));
    expect(combined).toContain('c0["did the thing"]');
    // Two separate mermaid blocks: architecture, then progress.
    expect(combined.match(/```mermaid/g)?.length).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import { inferredSchema } from "../types/inferred.js";
import { overlaySchema } from "../types/overlay.js";
import { renderAtlas } from "./atlasRenderer.js";
import { computeAtlasCounts, computeAtlasSections, renderAtlasDigest } from "./layers.js";

const baseGit = { branch: "main", head: "a".repeat(40), recentCommitSubjects: [] };

/** Counts the "- " bullet lines under a `## Heading` in a rendered ATLAS.md, up to the next `## `. */
function countBulletsUnderHeading(markdown: string, heading: string): number {
  const afterHeading = markdown.split(heading)[1] ?? "";
  const section = afterHeading.split(/\n## /)[0] ?? "";
  const bulletLines = section.split("\n").filter((line) => line.startsWith("- "));
  return bulletLines.length;
}

describe("layers.ts: L1/L2 shared aggregation", () => {
  it("computeAtlasSections takes Inferred/Overlay, not a rendered string (type-level: no string param)", () => {
    // This is enforced by the compiler (computeAtlasSections's signature),
    // but assert here too that it returns raw PortId arrays, not markdown.
    const inferred = inferredSchema.parse({ discoveredPorts: [], git: baseGit });
    const overlay = overlaySchema.parse({});
    const sections = computeAtlasSections(inferred, overlay);
    expect(Array.isArray(sections.skills)).toBe(true);
    expect(Array.isArray(sections.rules)).toBe(true);
    expect(Array.isArray(sections.unlabeledPorts)).toBe(true);
  });

  it("core regression: L1 digest counts exactly match L2 ATLAS.md's rendered bullet counts, non-trivial input", () => {
    const inferred = inferredSchema.parse({
      discoveredPorts: [
        "skill:src/nested/SKILL.md",
        "skill:src/other/SKILL.md",
        "source:AGENTS.md",
        "source:README.md",
        "source:.cursor/rules/style.md",
      ],
      git: baseGit,
    });
    const overlay = overlaySchema.parse({
      patches: [
        { project: "demo", from: "skill:map-project", to: "artifact:ATLAS.md", kind: "produces" },
        { project: "demo", from: "skill:map-project", to: "artifact:FLOW.md", kind: "produces" },
        { project: "demo", from: "skill:another-bay-skill", to: "artifact:ATLAS.md", kind: "produces" },
        { project: "demo", from: "source:README.md", to: "artifact:ATLAS.md", kind: "reads" },
      ],
    });

    const l2 = renderAtlas(inferred, overlay);
    const sections = computeAtlasSections(inferred, overlay);
    const counts = computeAtlasCounts(sections);
    const l1 = renderAtlasDigest(counts);

    const l2SkillsBullets = countBulletsUnderHeading(l2, "## Skills");
    const l2RulesBullets = countBulletsUnderHeading(l2, "## Rules");
    const l2UnlabeledBullets = countBulletsUnderHeading(l2, "## Unlabeled ports");

    // The core regression test for this phase: L1's counts must exactly
    // equal L2's rendered bullet counts for the same input.
    expect(counts.skills).toBe(l2SkillsBullets);
    expect(counts.rules).toBe(l2RulesBullets);
    expect(counts.unlabeledPorts).toBe(l2UnlabeledBullets);

    // Sanity: these aren't all trivially zero, and skills/rules/unlabeled
    // differ from each other (so a copy-paste bug swapping buckets would fail).
    expect(counts.skills).toBe(2);
    expect(counts.rules).toBe(3);
    expect(counts.unlabeledPorts).toBe(2);

    expect(l1).toContain("Skills: 2");
    expect(l1).toContain("Rules: 3");
    expect(l1).toContain("Unlabeled ports: 2");
  });

  it("empty input: L1 counts are all 0, matching L2's three 없음 sections", () => {
    const inferred = inferredSchema.parse({ discoveredPorts: [], git: baseGit });
    const overlay = overlaySchema.parse({});

    const l2 = renderAtlas(inferred, overlay);
    const counts = computeAtlasCounts(computeAtlasSections(inferred, overlay));

    expect(countBulletsUnderHeading(l2, "## Skills")).toBe(counts.skills);
    expect(countBulletsUnderHeading(l2, "## Rules")).toBe(counts.rules);
    expect(countBulletsUnderHeading(l2, "## Unlabeled ports")).toBe(counts.unlabeledPorts);
    expect(counts).toEqual({ skills: 0, rules: 0, unlabeledPorts: 0 });
  });

  it("renderAtlasDigest fits in one screen (short, no markdown headings beyond one h1)", () => {
    const digest = renderAtlasDigest({ skills: 0, rules: 0, unlabeledPorts: 0 });
    expect(digest.split("\n").length).toBeLessThanOrEqual(10);
    expect((digest.match(/^#/gm) ?? []).length).toBe(1);
  });
});

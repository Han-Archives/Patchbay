import { describe, expect, it } from "vitest";
import { inferredSchema } from "../types/inferred.js";
import { overlaySchema } from "../types/overlay.js";
import { renderAtlas } from "./atlasRenderer.js";
import { computeAtlasCounts, computeAtlasSections, renderAtlasDigest } from "./layers.js";

const baseGit = { branch: "main", head: "a".repeat(40), recentCommitSubjects: [] };

/**
 * Counts the "- " bullet lines under a `## Heading` or `### Sub-heading` in
 * a rendered ATLAS.md, up to the next heading of any level. Generalized
 * (Phase 5) from a `## `-only stop pattern to `#+ ` so it also works for
 * Gaps's `### Patches without a wire` / `### Wires without a patch`
 * sub-sections -- this doesn't change behavior for the pre-existing flat
 * Skills/Rules/Unlabeled-ports sections, which never contain a nested
 * heading.
 */
function countBulletsUnderHeading(markdown: string, heading: string): number {
  const afterHeading = markdown.split(heading)[1] ?? "";
  const section = afterHeading.split(/\n#+ /)[0] ?? "";
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
    expect(Array.isArray(sections.patchesWithoutWire)).toBe(true);
    expect(Array.isArray(sections.wiresWithoutPatch)).toBe(true);
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
      // One wire matches the first patch exactly (from, to, kind) -- that
      // pair should NOT show up in either Gaps bucket. The other three
      // patches have no matching wire (patchesWithoutWire), and this extra
      // wire has no matching patch (wiresWithoutPatch, normal/not a bug).
      wires: [
        {
          project: "demo",
          from: "skill:map-project",
          to: "artifact:ATLAS.md",
          kind: "produces",
          install: "symlink",
        },
        {
          project: "demo",
          from: "skill:extra-skill",
          to: "artifact:EXTRA.md",
          kind: "uses",
          install: "copy",
        },
      ],
    });

    const l2 = renderAtlas(inferred, overlay);
    const sections = computeAtlasSections(inferred, overlay);
    const counts = computeAtlasCounts(sections);
    const l1 = renderAtlasDigest(counts);

    const l2SkillsBullets = countBulletsUnderHeading(l2, "## Skills");
    const l2RulesBullets = countBulletsUnderHeading(l2, "## Rules");
    const l2UnlabeledBullets = countBulletsUnderHeading(l2, "## Unlabeled ports");
    const l2PatchesWithoutWireBullets = countBulletsUnderHeading(l2, "### Patches without a wire");
    const l2WiresWithoutPatchBullets = countBulletsUnderHeading(l2, "### Wires without a patch");

    // The core regression test for this phase: L1's counts must exactly
    // equal L2's rendered bullet counts for the same input -- now covering
    // the Gaps fields too.
    expect(counts.skills).toBe(l2SkillsBullets);
    expect(counts.rules).toBe(l2RulesBullets);
    expect(counts.unlabeledPorts).toBe(l2UnlabeledBullets);
    expect(counts.patchesWithoutWire).toBe(l2PatchesWithoutWireBullets);
    expect(counts.wiresWithoutPatch).toBe(l2WiresWithoutPatchBullets);

    // Sanity: these aren't all trivially zero, and skills/rules/unlabeled
    // differ from each other (so a copy-paste bug swapping buckets would fail).
    expect(counts.skills).toBe(2);
    expect(counts.rules).toBe(3);
    expect(counts.unlabeledPorts).toBe(2);
    expect(counts.patchesWithoutWire).toBe(3);
    expect(counts.wiresWithoutPatch).toBe(1);

    expect(l1).toContain("Skills: 2");
    expect(l1).toContain("Rules: 3");
    expect(l1).toContain("Unlabeled ports: 2");
    expect(l1).toContain("Patches without a wire: 3");
    expect(l1).toContain("Wires without a patch: 1");
  });

  it("empty input: L1 counts are all 0, matching L2's five 없음 sections", () => {
    const inferred = inferredSchema.parse({ discoveredPorts: [], git: baseGit });
    const overlay = overlaySchema.parse({});

    const l2 = renderAtlas(inferred, overlay);
    const counts = computeAtlasCounts(computeAtlasSections(inferred, overlay));

    expect(countBulletsUnderHeading(l2, "## Skills")).toBe(counts.skills);
    expect(countBulletsUnderHeading(l2, "## Rules")).toBe(counts.rules);
    expect(countBulletsUnderHeading(l2, "## Unlabeled ports")).toBe(counts.unlabeledPorts);
    expect(countBulletsUnderHeading(l2, "### Patches without a wire")).toBe(counts.patchesWithoutWire);
    expect(countBulletsUnderHeading(l2, "### Wires without a patch")).toBe(counts.wiresWithoutPatch);
    expect(counts).toEqual({
      skills: 0,
      rules: 0,
      unlabeledPorts: 0,
      patchesWithoutWire: 0,
      wiresWithoutPatch: 0,
    });
  });

  it("renderAtlasDigest fits in one screen (short, no markdown headings beyond one h1)", () => {
    const digest = renderAtlasDigest({
      skills: 0,
      rules: 0,
      unlabeledPorts: 0,
      patchesWithoutWire: 0,
      wiresWithoutPatch: 0,
    });
    expect(digest.split("\n").length).toBeLessThanOrEqual(10);
    expect((digest.match(/^#/gm) ?? []).length).toBe(1);
  });
});

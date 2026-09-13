import { describe, expect, it } from "vitest";
import { inferredSchema } from "../types/inferred.js";
import { overlaySchema } from "../types/overlay.js";
import { renderAtlas } from "./atlasRenderer.js";

const baseGit = { branch: "main", head: "a".repeat(40), recentCommitSubjects: [] };
const emptyOverlay = overlaySchema.parse({});

describe("renderAtlas", () => {
  it("renders all three fixed headings, each 없음 when everything is empty", () => {
    const inferred = inferredSchema.parse({ discoveredPorts: [], git: baseGit });
    const md = renderAtlas(inferred, emptyOverlay);

    expect(md).toContain("## Skills");
    expect(md).toContain("## Rules");
    expect(md).toContain("## Unlabeled ports");

    const headingOrder = ["## Skills", "## Rules", "## Unlabeled ports"].map((h) => md.indexOf(h));
    expect(headingOrder).toEqual([...headingOrder].sort((a, b) => a - b));
    expect(headingOrder.every((i) => i >= 0)).toBe(true);

    // Every section is empty in this input, so 없음 appears exactly 3 times.
    expect(md.match(/없음/g)?.length).toBe(3);
  });

  it("Rules lists source: discovered ports, Unlabeled ports lists skill: discovered ports", () => {
    const inferred = inferredSchema.parse({
      discoveredPorts: ["skill:src/nested/SKILL.md", "source:AGENTS.md", "source:README.md"],
      git: baseGit,
    });
    const md = renderAtlas(inferred, emptyOverlay);

    expect(md).toContain("- source:AGENTS.md");
    expect(md).toContain("- source:README.md");
    expect(md).toContain("- skill:src/nested/SKILL.md");

    const rulesSection = md.split("## Rules")[1]?.split("## Unlabeled ports")[0] ?? "";
    expect(rulesSection).not.toContain("skill:");
  });

  it("Skills lists distinct skill: `from` PortIds patched in via overlay.patches", () => {
    const inferred = inferredSchema.parse({ discoveredPorts: [], git: baseGit });
    const overlay = overlaySchema.parse({
      patches: [
        { project: "demo", from: "skill:map-project", to: "artifact:ATLAS.md", kind: "produces" },
        { project: "demo", from: "skill:map-project", to: "artifact:FLOW.md", kind: "produces" },
        { project: "demo", from: "source:README.md", to: "artifact:ATLAS.md", kind: "reads" },
      ],
    });
    const md = renderAtlas(inferred, overlay);

    const skillsSection = md.split("## Skills")[1]?.split("## Rules")[0] ?? "";
    expect(skillsSection).toContain("- skill:map-project");
    // Distinct: appears twice in patches but should render once.
    expect(skillsSection.match(/skill:map-project/g)?.length).toBe(1);
    expect(skillsSection).not.toContain("source:README.md");
  });

  it("phase 3 typical case: overlay has no patches yet -> Skills renders 없음 (not a bug)", () => {
    const inferred = inferredSchema.parse({
      discoveredPorts: ["skill:src/nested/SKILL.md"],
      git: baseGit,
    });
    const md = renderAtlas(inferred, emptyOverlay);
    const skillsSection = md.split("## Skills")[1]?.split("## Rules")[0] ?? "";
    expect(skillsSection.trim()).toBe("없음");
  });
});

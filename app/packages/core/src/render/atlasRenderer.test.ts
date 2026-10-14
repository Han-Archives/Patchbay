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

    expect(md).toContain("## 스킬");
    expect(md).toContain("## 규칙");
    expect(md).toContain("## 분류 안 된 항목");

    const headingOrder = ["## 스킬", "## 규칙", "## 분류 안 된 항목"].map((h) => md.indexOf(h));
    expect(headingOrder).toEqual([...headingOrder].sort((a, b) => a - b));
    expect(headingOrder.every((i) => i >= 0)).toBe(true);

    // Every section is empty in this input: the original three (Skills,
    // Rules, Unlabeled ports) plus Phase 5's two Gaps sub-sections
    // (Patches without a wire, Wires without a patch) -- 없음 five times.
    expect(md.match(/없음/g)?.length).toBe(5);
  });

  it("Phase 5: renders a ## 빈틈 section with Patches-without-wire / Wires-without-patch sub-sections, from computeAtlasSections's fields", () => {
    const inferred = inferredSchema.parse({ discoveredPorts: [], git: baseGit });
    const overlay = overlaySchema.parse({
      patches: [{ project: "demo", from: "skill:map-project", to: "artifact:ATLAS.md", kind: "produces" }],
      wires: [
        {
          project: "demo",
          from: "skill:extra-skill",
          to: "artifact:EXTRA.md",
          kind: "uses",
          install: "copy",
        },
      ],
    });
    const md = renderAtlas(inferred, overlay);

    expect(md).toContain("## 빈틈");
    expect(md.indexOf("## 빈틈")).toBeGreaterThan(md.indexOf("## 분류 안 된 항목"));

    const gapsSection = md.split("## 빈틈")[1] ?? "";
    const patchesWithoutWireSection = gapsSection.split("### 실물만 있고 선언이 없는 연결")[0] ?? "";
    expect(patchesWithoutWireSection).toContain("- `skill:map-project --[produces]--> artifact:ATLAS.md`");
    expect(gapsSection).toContain("- `skill:extra-skill --[uses]--> artifact:EXTRA.md`");

    // A wire without a patch is normal, not a bug -- the prose must say so.
    expect(gapsSection.toLowerCase()).toMatch(/정상|결함이 아니다/);
  });

  it("phase 5 typical case: overlay has no patches/wires yet -> Gaps renders 없음 in both sub-sections (not a bug)", () => {
    const inferred = inferredSchema.parse({ discoveredPorts: [], git: baseGit });
    const md = renderAtlas(inferred, emptyOverlay);
    const gapsSection = md.split("## 빈틈")[1] ?? "";
    expect(gapsSection.match(/없음/g)?.length).toBe(2);
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

    const rulesSection = md.split("## 규칙")[1]?.split("## 분류 안 된 항목")[0] ?? "";
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

    const skillsSection = md.split("## 스킬")[1]?.split("## 규칙")[0] ?? "";
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
    const skillsSection = md.split("## 스킬")[1]?.split("## 규칙")[0] ?? "";
    expect(skillsSection.trim()).toBe("없음");
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { placeOnBoard } from "./boardStore.js";
import { registerProject } from "./studioStore.js";
import { skillBayDir, skillPackageExists } from "./projectFiles.js";
import {
  acceptSkillDraft,
  defaultDraftSlug,
  sanitizeSkillSlug,
  seedBundledSkills,
  writeSkillDraft,
} from "./skillDraft.js";

function tmpStudioHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-skill-draft-"));
}

describe("skill slug freeze", () => {
  it("sanitizes to a Bay slug and defaults from-<alias>", () => {
    expect(sanitizeSkillSlug("From Demo")).toBe("from-demo");
    expect(sanitizeSkillSlug("Not A Valid!!!")).toBe("not-a-valid");
    expect(sanitizeSkillSlug("...")).toBeNull();
    expect(defaultDraftSlug("demo")).toBe("from-demo");
    expect(defaultDraftSlug("Demo_App")).toBe("from-demo-app");
  });
});

describe("writeSkillDraft / acceptSkillDraft", () => {
  it("writes a proposed SKILL.md from board items and refuses an empty board", async () => {
    const home = tmpStudioHome();
    await registerProject(home, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    const empty = await writeSkillDraft(home, "demo");
    expect(empty).toMatchObject({ ok: false, reason: "empty_board" });

    await placeOnBoard(home, "demo", {
      id: "langgraph:flow:draft",
      kind: "langgraph",
      ref: "flow:draft",
      title: "draft",
      x: 0,
      y: 0,
    });
    await placeOnBoard(home, "demo", {
      id: "neo4j:file:README.md",
      kind: "neo4j",
      ref: "README.md",
      title: "README",
      x: 20,
      y: 0,
    });

    const drafted = await writeSkillDraft(home, "demo");
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    expect(drafted.slug).toBe("from-demo");
    expect(drafted.path.endsWith(`${path.join("skills", "from-demo.proposed", "SKILL.md")}`)).toBe(true);
    const markdown = fs.readFileSync(drafted.path, "utf8");
    expect(markdown).toContain("name: from-demo");
    expect(markdown).toContain("langgraph");
    expect(markdown).toContain("neo4j");
    expect(markdown).toContain("워커 세션을 원격으로 켜지 않는다");
    expect(markdown).toContain("patchbay skill accept from-demo");
    expect(markdown).toContain("patchbay patch from-demo demo");
    expect(await skillPackageExists(home, "from-demo")).toBe(false);

    const again = await writeSkillDraft(home, "demo");
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.overwritten).toBe(true);
  });

  it("accept moves the draft onto the confirmed Bay path and will not overwrite", async () => {
    const home = tmpStudioHome();
    await registerProject(home, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    await placeOnBoard(home, "demo", {
      id: "port:source:README.md",
      kind: "port",
      ref: "source:README.md",
      title: "README",
    });
    const drafted = await writeSkillDraft(home, "demo", { slug: "harvested" });
    expect(drafted.ok).toBe(true);

    const missing = await acceptSkillDraft(home, "nope");
    expect(missing).toMatchObject({ ok: false, reason: "no_draft" });

    const accepted = await acceptSkillDraft(home, "harvested");
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(await skillPackageExists(home, "harvested")).toBe(true);
    expect(fs.existsSync(path.join(home, "skills", "harvested.proposed"))).toBe(false);
    expect(fs.readFileSync(path.join(skillBayDir(home, "harvested"), "SKILL.md"), "utf8")).toContain("name: harvested");

    await writeSkillDraft(home, "demo", { slug: "harvested" });
    const blocked = await acceptSkillDraft(home, "harvested");
    expect(blocked).toMatchObject({ ok: false, reason: "already_confirmed" });
  });

  it("seedBundledSkills copies missing packages and skips existing ones", async () => {
    const home = tmpStudioHome();
    const bundled = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-bundled-skills-"));
    const pkg = path.join(bundled, "map-project");
    fs.mkdirSync(pkg);
    fs.writeFileSync(path.join(pkg, "SKILL.md"), "# map-project\nprogress write\n");
    fs.writeFileSync(path.join(pkg, "notes.md"), "keep\n");
    fs.mkdirSync(path.join(bundled, "src"));
    fs.writeFileSync(path.join(bundled, "src", "index.ts"), "export {};\n");

    const first = await seedBundledSkills(home, bundled);
    expect(first).toEqual(["map-project"]);
    expect(fs.readFileSync(path.join(skillBayDir(home, "map-project"), "SKILL.md"), "utf8")).toBe(
      "# map-project\nprogress write\n",
    );
    fs.writeFileSync(path.join(skillBayDir(home, "map-project"), "SKILL.md"), "# kept\n");
    const second = await seedBundledSkills(home, bundled);
    expect(second).toEqual([]);
    expect(fs.readFileSync(path.join(skillBayDir(home, "map-project"), "SKILL.md"), "utf8")).toBe("# kept\n");
  });
});

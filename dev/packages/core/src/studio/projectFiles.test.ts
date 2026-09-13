import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Wire } from "../types/project.js";
import { inferredSchema, type Inferred } from "../types/inferred.js";
import {
  appendWire,
  ensureProjectDir,
  installSkillIntoProject,
  readAtlas,
  readAtlasDigest,
  readFlow,
  readInferred,
  readOverlay,
  skillBayDir,
  skillPackageExists,
  writeAtlas,
  writeAtlasDigest,
  writeFlow,
  writeInferred,
  writeOverlayIfAbsent,
} from "./projectFiles.js";

function tmpStudioHome(): string {
  // Safety: always a freshly created OS tmpdir, never the real ~/.patchbay.
  return fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-project-files-"));
}

const sampleInferred: Inferred = inferredSchema.parse({
  discoveredPorts: ["skill:src/nested/SKILL.md", "source:README.md"],
  git: { branch: "main", head: "a".repeat(40), recentCommitSubjects: ["initial commit"] },
  agents: [],
});

describe("overlay.yaml (human-owned)", () => {
  it("readOverlay returns a fresh default when the file doesn't exist", async () => {
    const home = tmpStudioHome();
    const overlay = await readOverlay(home, "demo");
    expect(overlay).toEqual({ patches: [], wires: [], decisions: [], accepted_guides: [] });
  });

  it("writeOverlayIfAbsent creates the file the first time", async () => {
    const home = tmpStudioHome();
    await writeOverlayIfAbsent(home, "demo");
    const dir = await ensureProjectDir(home, "demo");
    expect(fs.existsSync(path.join(dir, "overlay.yaml"))).toBe(true);
  });

  it("writeOverlayIfAbsent never overwrites an existing overlay.yaml", async () => {
    const home = tmpStudioHome();
    const dir = await ensureProjectDir(home, "demo");
    fs.writeFileSync(path.join(dir, "overlay.yaml"), "patches: [{ project: demo, from: x, to: y, kind: uses }]\n");

    await writeOverlayIfAbsent(home, "demo");

    const raw = fs.readFileSync(path.join(dir, "overlay.yaml"), "utf8");
    expect(raw).toContain("kind: uses");
  });
});

describe("inferred.json (kernel-owned)", () => {
  it("round-trips via writeInferred/readInferred", async () => {
    const home = tmpStudioHome();
    await writeInferred(home, "demo", sampleInferred);
    const read = await readInferred(home, "demo");
    expect(read).toEqual(sampleInferred);
  });

  it("writeInferred always overwrites wholesale", async () => {
    const home = tmpStudioHome();
    await writeInferred(home, "demo", sampleInferred);
    const second: Inferred = { ...sampleInferred, discoveredPorts: [] };
    await writeInferred(home, "demo", second);
    const read = await readInferred(home, "demo");
    expect(read.discoveredPorts).toEqual([]);
  });
});

describe("ATLAS.md / FLOW.md (kernel-owned)", () => {
  it("writeAtlas returns the absolute path written, and readAtlas reads it back", async () => {
    const home = tmpStudioHome();
    const written = await writeAtlas(home, "demo", "## Skills\n\n없음\n");
    expect(path.isAbsolute(written)).toBe(true);
    expect(written).toBe(path.join(home, "projects", "demo", "ATLAS.md"));
    const read = await readAtlas(home, "demo");
    expect(read).toBe("## Skills\n\n없음\n");
  });

  it("writeFlow returns the absolute path written, and readFlow reads it back", async () => {
    const home = tmpStudioHome();
    const written = await writeFlow(home, "demo", "```mermaid\nflowchart TD\n```\n");
    expect(written).toBe(path.join(home, "projects", "demo", "FLOW.md"));
    const read = await readFlow(home, "demo");
    expect(read).toContain("flowchart TD");
  });

  it("writeAtlasDigest returns the absolute path written (next to ATLAS.md), and readAtlasDigest reads it back", async () => {
    const home = tmpStudioHome();
    const written = await writeAtlasDigest(home, "demo", "# Atlas Digest\n\n- Skills: 0\n");
    expect(path.isAbsolute(written)).toBe(true);
    expect(written).toBe(path.join(home, "projects", "demo", "ATLAS.digest.md"));
    const read = await readAtlasDigest(home, "demo");
    expect(read).toBe("# Atlas Digest\n\n- Skills: 0\n");
  });

  it("writeAtlasDigest always overwrites wholesale, like writeAtlas", async () => {
    const home = tmpStudioHome();
    await writeAtlasDigest(home, "demo", "- Skills: 1\n");
    await writeAtlasDigest(home, "demo", "- Skills: 2\n");
    const read = await readAtlasDigest(home, "demo");
    expect(read).toBe("- Skills: 2\n");
  });
});

const sampleWire: Wire = {
  project: "demo",
  from: "skill:map-project",
  to: "artifact:FLOW.md",
  kind: "produces",
  install: "symlink",
} as Wire;

describe("appendWire (Phase 5: explicit overlay.yaml mutation via `patchbay patch`)", () => {
  it("appends to an overlay.yaml that doesn't exist yet (readOverlay's default-empty Overlay)", async () => {
    const home = tmpStudioHome();
    const updated = await appendWire(home, "demo", sampleWire);
    expect(updated.wires).toEqual([sampleWire]);

    const reread = await readOverlay(home, "demo");
    expect(reread.wires).toEqual([sampleWire]);
  });

  it("appends without clobbering existing patches/wires/decisions already in overlay.yaml", async () => {
    const home = tmpStudioHome();
    const dir = await ensureProjectDir(home, "demo");
    fs.writeFileSync(
      path.join(dir, "overlay.yaml"),
      "patches:\n  - project: demo\n    from: skill:existing\n    to: artifact:ATLAS.md\n    kind: produces\nwires: []\ndecisions: []\naccepted_guides: []\n",
    );

    const updated = await appendWire(home, "demo", sampleWire);
    expect(updated.patches).toHaveLength(1);
    expect(updated.patches[0]!.from).toBe("skill:existing");
    expect(updated.wires).toEqual([sampleWire]);
  });

  it("rejects an invalid wire via wireSchema before writing anything", async () => {
    const home = tmpStudioHome();
    const invalidWire = { ...sampleWire, kind: "not-a-real-kind" } as unknown as Wire;
    await expect(appendWire(home, "demo", invalidWire)).rejects.toThrow();

    const overlay = await readOverlay(home, "demo");
    expect(overlay.wires).toEqual([]);
  });
});

describe("Skill Bay helpers (Phase 5: `patchbay patch`)", () => {
  it("skillBayDir points at <studioHome>/skills/<slug>", () => {
    const home = tmpStudioHome();
    expect(skillBayDir(home, "map-project")).toBe(path.join(home, "skills", "map-project"));
  });

  it("skillPackageExists is false when the Bay is empty (typical until Phase 8 populates it)", async () => {
    const home = tmpStudioHome();
    expect(await skillPackageExists(home, "map-project")).toBe(false);
  });

  it("skillPackageExists is true once SKILL.md exists in the Bay package directory", async () => {
    const home = tmpStudioHome();
    const bayDir = skillBayDir(home, "map-project");
    fs.mkdirSync(bayDir, { recursive: true });
    fs.writeFileSync(path.join(bayDir, "SKILL.md"), "# Map Project\n");
    expect(await skillPackageExists(home, "map-project")).toBe(true);
  });
});

describe("installSkillIntoProject (Phase 5: `patchbay patch`'s install mechanism)", () => {
  function buildSkillPackage(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-skill-pkg-"));
    fs.writeFileSync(path.join(dir, "SKILL.md"), "# A skill\n");
    fs.writeFileSync(path.join(dir, "helper.md"), "supporting file\n");
    return dir;
  }

  function tmpProjectPath(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-skill-target-project-"));
  }

  it("symlinks the whole package directory (not just SKILL.md) on the happy path", async () => {
    const source = buildSkillPackage();
    const project = tmpProjectPath();

    const method = await installSkillIntoProject(source, project, "map-project");
    expect(method).toBe("symlink");

    const targetDir = path.join(project, "skills", "map-project");
    expect(fs.lstatSync(targetDir).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(targetDir, "SKILL.md"), "utf8")).toBe("# A skill\n");
    expect(fs.readFileSync(path.join(targetDir, "helper.md"), "utf8")).toBe("supporting file\n");
  });

  it("falls back to a recursive copy -- and reports install: 'copy', not 'symlink' -- when the symlink call fails (forced via the injectable seam)", async () => {
    const source = buildSkillPackage();
    const project = tmpProjectPath();

    const forceFailingSymlink = async (): Promise<void> => {
      throw new Error("EXDEV: cross-device link not permitted (forced for test)");
    };

    const method = await installSkillIntoProject(source, project, "map-project", forceFailingSymlink);
    expect(method).toBe("copy");

    const targetDir = path.join(project, "skills", "map-project");
    expect(fs.lstatSync(targetDir).isSymbolicLink()).toBe(false);
    expect(fs.statSync(targetDir).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(targetDir, "SKILL.md"), "utf8")).toBe("# A skill\n");
    expect(fs.readFileSync(path.join(targetDir, "helper.md"), "utf8")).toBe("supporting file\n");
  });
});

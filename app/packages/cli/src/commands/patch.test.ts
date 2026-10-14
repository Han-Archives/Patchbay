import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readOverlay, registerProject } from "@patchbay/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPatch } from "./patch.js";

// Safety: every test sets PATCHBAY_HOME to a freshly created OS tmpdir --
// never the real ~/.patchbay.
let studioHome: string;
let originalPatchbayHome: string | undefined;

beforeEach(() => {
  originalPatchbayHome = process.env.PATCHBAY_HOME;
  studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-patch-home-"));
  process.env.PATCHBAY_HOME = studioHome;
});

afterEach(() => {
  if (originalPatchbayHome === undefined) delete process.env.PATCHBAY_HOME;
  else process.env.PATCHBAY_HOME = originalPatchbayHome;
  vi.restoreAllMocks();
});

/** Seeds a fake Skill Bay package (the Bay is empty until Phase 8 -- tests build their own fixture directly). */
function seedSkillInBay(slug: string): void {
  const dir = path.join(studioHome, "skills", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `# ${slug}\n`);
  fs.writeFileSync(path.join(dir, "helper.md"), "supporting file\n");
}

function buildRegisteredProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-patch-project-"));
}

describe("runPatch", () => {
  it("exit 1, nothing written, when the skill isn't in the Bay (SKILL.md missing -- the expected empty-Bay case)", async () => {
    const projectDir = buildRegisteredProjectDir();
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectDir });

    const exitCode = await runPatch("nonexistent-skill", "demo", {}, studioHome);
    expect(exitCode).toBe(1);

    const overlay = await readOverlay(studioHome, "demo");
    expect(overlay.wires).toEqual([]);
    expect(fs.existsSync(path.join(projectDir, "skills"))).toBe(false);
  });

  it("exit 1 when the project alias isn't registered", async () => {
    seedSkillInBay("map-project");
    const exitCode = await runPatch("map-project", "nope", {}, studioHome);
    expect(exitCode).toBe(1);
  });

  it("exit 1 for an invalid skill slug, before touching anything", async () => {
    const projectDir = buildRegisteredProjectDir();
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectDir });

    const exitCode = await runPatch("Not A Valid Slug", "demo", {}, studioHome);
    expect(exitCode).toBe(1);

    const overlay = await readOverlay(studioHome, "demo");
    expect(overlay.wires).toEqual([]);
  });

  it("exit 0 on success: symlinks the whole skill package (not just SKILL.md) and records a Wire with install: symlink", async () => {
    seedSkillInBay("map-project");
    const projectDir = buildRegisteredProjectDir();
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectDir });

    const exitCode = await runPatch("map-project", "demo", {}, studioHome);
    expect(exitCode).toBe(0);

    const targetDir = path.join(projectDir, "skills", "map-project");
    expect(fs.lstatSync(targetDir).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(targetDir, "SKILL.md"), "utf8")).toBe("# map-project\n");
    expect(fs.readFileSync(path.join(targetDir, "helper.md"), "utf8")).toBe("supporting file\n");

    const overlay = await readOverlay(studioHome, "demo");
    expect(overlay.wires).toHaveLength(1);
    expect(overlay.wires[0]).toMatchObject({
      project: "demo",
      from: "skill:map-project",
      to: "skill:skills/map-project/SKILL.md",
      kind: "uses",
      install: "symlink",
    });
  });

  it("no matching Patch needs to exist beforehand -- the wire records fine (normally surfaces as wiresWithoutPatch in Atlas's Gaps)", async () => {
    seedSkillInBay("map-project");
    const projectDir = buildRegisteredProjectDir();
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectDir });

    const exitCode = await runPatch("map-project", "demo", {}, studioHome);
    expect(exitCode).toBe(0);

    const overlay = await readOverlay(studioHome, "demo");
    expect(overlay.patches).toEqual([]);
    expect(overlay.wires).toHaveLength(1);
  });

  it("--json prints ok:true with the actual install method used and the recorded wire", async () => {
    seedSkillInBay("map-project");
    const projectDir = buildRegisteredProjectDir();
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectDir });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const exitCode = await runPatch("map-project", "demo", { json: true }, studioHome);
    expect(exitCode).toBe(0);

    const printed = JSON.parse(logSpy.mock.calls.at(-1)![0] as string);
    expect(printed.ok).toBe(true);
    expect(printed.install).toBe("symlink");
    expect(printed.wire.to).toBe("skill:skills/map-project/SKILL.md");
  });
});

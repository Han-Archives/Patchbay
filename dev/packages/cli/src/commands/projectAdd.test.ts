import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readStudio } from "@patchbay/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLARITY_GATE_THRESHOLD } from "../constants.js";
import { runProjectAdd } from "./projectAdd.js";

// Safety: every test sets PATCHBAY_HOME to a freshly created OS tmpdir --
// never the real ~/.patchbay.
let studioHome: string;
let originalPatchbayHome: string | undefined;

beforeEach(() => {
  originalPatchbayHome = process.env.PATCHBAY_HOME;
  studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-project-add-home-"));
  process.env.PATCHBAY_HOME = studioHome;
});

afterEach(() => {
  if (originalPatchbayHome === undefined) delete process.env.PATCHBAY_HOME;
  else process.env.PATCHBAY_HOME = originalPatchbayHome;
  vi.restoreAllMocks();
});

/** A high-clarity fixture: a README, a real git history with unique commit subjects, no duplicate-name files. */
function buildHighClarityFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-fixture-high-"));
  const run = (cmd: string) => execSync(cmd, { cwd: dir, stdio: "pipe" });

  fs.writeFileSync(path.join(dir, "README.md"), "# Fixture\n");
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "index.ts"), "export {};\n");

  run("git init -q -b main");
  run("git config user.name 'Patchbay Test'");
  run("git config user.email test@patchbay.invalid");
  run("git add -A");
  run('git commit -q -m "initial commit"');
  run('git commit -q --allow-empty -m "second distinct commit"');

  return dir;
}

/** A low-clarity fixture: no README, no git history at all. */
function buildLowClarityFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-fixture-low-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "index.ts"), "export {};\n");
  return dir;
}

describe("runProjectAdd", () => {
  it("exit 1 when --path is missing", async () => {
    const exitCode = await runProjectAdd({}, studioHome);
    expect(exitCode).toBe(1);
    const studio = await readStudio(studioHome);
    expect(studio.projects).toEqual([]);
  });

  it("exit 1 when --path does not exist", async () => {
    const exitCode = await runProjectAdd({ path: path.join(studioHome, "does-not-exist") }, studioHome);
    expect(exitCode).toBe(1);
  });

  it("exit 0 on success: registers the project and prints ATLAS.md's absolute path", async () => {
    const projectDir = buildHighClarityFixture();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const exitCode = await runProjectAdd({ path: projectDir, json: true }, studioHome);
    expect(exitCode).toBe(0);

    const studio = await readStudio(studioHome);
    expect(studio.projects).toHaveLength(1);
    expect(studio.projects[0]!.path).toBe(projectDir);

    const printed = JSON.parse(logSpy.mock.calls.at(-1)![0] as string);
    expect(printed.ok).toBe(true);
    expect(path.isAbsolute(printed.atlasPath)).toBe(true);
    expect(fs.existsSync(printed.atlasPath)).toBe(true);
    expect(fs.readFileSync(printed.atlasPath, "utf8")).toContain("## Skills");
  });

  it("also writes ATLAS.digest.md (L1) alongside ATLAS.md on registration", async () => {
    const projectDir = buildHighClarityFixture();
    await runProjectAdd({ path: projectDir, alias: "demo" }, studioHome);

    const digestPath = path.join(studioHome, "projects", "demo", "ATLAS.digest.md");
    expect(fs.existsSync(digestPath)).toBe(true);
    expect(fs.readFileSync(digestPath, "utf8")).toContain("Skills:");
  });

  it("writes a fresh empty overlay.yaml on first registration", async () => {
    const projectDir = buildHighClarityFixture();
    await runProjectAdd({ path: projectDir, alias: "demo" }, studioHome);

    const overlayPath = path.join(studioHome, "projects", "demo", "overlay.yaml");
    expect(fs.existsSync(overlayPath)).toBe(true);
    expect(fs.readFileSync(overlayPath, "utf8")).toContain("patches");
  });

  it(`exit 2 and does not register when the clarity score is below ${CLARITY_GATE_THRESHOLD} and no --force-add`, async () => {
    const projectDir = buildLowClarityFixture();
    const exitCode = await runProjectAdd({ path: projectDir }, studioHome);
    expect(exitCode).toBe(2);

    const studio = await readStudio(studioHome);
    expect(studio.projects).toEqual([]);
  });

  it("--force-add registers a project despite a low clarity score", async () => {
    const projectDir = buildLowClarityFixture();
    const exitCode = await runProjectAdd({ path: projectDir, forceAdd: true }, studioHome);
    expect(exitCode).toBe(0);

    const studio = await readStudio(studioHome);
    expect(studio.projects).toHaveLength(1);
  });

  it("derives the alias from the directory basename when --alias is omitted", async () => {
    const projectDir = buildHighClarityFixture();
    await runProjectAdd({ path: projectDir }, studioHome);
    const studio = await readStudio(studioHome);
    expect(studio.projects[0]!.alias).toBe(path.basename(projectDir));
  });

  it("exit 1 with a clear error, without overwriting the existing registration, on an alias collision", async () => {
    const first = buildHighClarityFixture();
    const second = buildHighClarityFixture();

    await runProjectAdd({ path: first, alias: "dup" }, studioHome);
    const exitCode = await runProjectAdd({ path: second, alias: "dup" }, studioHome);

    expect(exitCode).toBe(1);
    const studio = await readStudio(studioHome);
    expect(studio.projects).toHaveLength(1);
    expect(studio.projects[0]!.path).toBe(first);
  });
});

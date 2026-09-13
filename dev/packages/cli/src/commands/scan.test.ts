import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerProject } from "@patchbay/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runScan } from "./scan.js";

// Safety: every test sets PATCHBAY_HOME to a freshly created OS tmpdir --
// never the real ~/.patchbay.
let studioHome: string;
let originalPatchbayHome: string | undefined;

beforeEach(() => {
  originalPatchbayHome = process.env.PATCHBAY_HOME;
  studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-scan-home-"));
  process.env.PATCHBAY_HOME = studioHome;
});

afterEach(() => {
  if (originalPatchbayHome === undefined) delete process.env.PATCHBAY_HOME;
  else process.env.PATCHBAY_HOME = originalPatchbayHome;
});

function buildFixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-scan-fixture-"));
  const run = (cmd: string) => execSync(cmd, { cwd: dir, stdio: "pipe" });
  fs.writeFileSync(path.join(dir, "README.md"), "# Fixture\n");
  run("git init -q -b main");
  run("git config user.name 'Patchbay Test'");
  run("git config user.email test@patchbay.invalid");
  run("git add -A");
  run('git commit -q -m "initial commit"');
  return dir;
}

describe("runScan", () => {
  it("exit 1 with a clear error when the alias isn't registered", async () => {
    const exitCode = await runScan({ project: "nope" }, studioHome);
    expect(exitCode).toBe(1);
  });

  it("exit 1 when no --project is given and nothing is registered", async () => {
    const exitCode = await runScan({}, studioHome);
    expect(exitCode).toBe(1);
  });

  it("defaults to the single registered project and rewrites inferred.json/ATLAS.md/FLOW.md", async () => {
    const projectDir = buildFixtureRepo();
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectDir });

    const exitCode = await runScan({}, studioHome);
    expect(exitCode).toBe(0);

    const atlasPath = path.join(studioHome, "projects", "demo", "ATLAS.md");
    expect(fs.existsSync(atlasPath)).toBe(true);
    expect(fs.readFileSync(atlasPath, "utf8")).toContain("- source:README.md");

    const inferredPath = path.join(studioHome, "projects", "demo", "inferred.json");
    const inferred = JSON.parse(fs.readFileSync(inferredPath, "utf8"));
    expect(inferred.discoveredPorts).toContain("source:README.md");
  });

  it("never touches overlay.yaml even if one already exists", async () => {
    const projectDir = buildFixtureRepo();
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectDir });

    const projectStudioDir = path.join(studioHome, "projects", "demo");
    fs.mkdirSync(projectStudioDir, { recursive: true });
    const overlayPath = path.join(projectStudioDir, "overlay.yaml");
    const humanOverlay = "patches: [{ project: demo, from: skill:a, to: artifact:b, kind: uses }]\n";
    fs.writeFileSync(overlayPath, humanOverlay);

    await runScan({ project: "demo" }, studioHome);
    expect(fs.readFileSync(overlayPath, "utf8")).toBe(humanOverlay);
  });

  it("re-running scan picks up a new file on disk (rewrites inferred.json wholesale)", async () => {
    const projectDir = buildFixtureRepo();
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectDir });
    await runScan({ project: "demo" }, studioHome);

    fs.mkdirSync(path.join(projectDir, "newskill"));
    fs.writeFileSync(path.join(projectDir, "newskill", "SKILL.md"), "# new skill\n");

    await runScan({ project: "demo" }, studioHome);
    const inferredPath = path.join(studioHome, "projects", "demo", "inferred.json");
    const inferred = JSON.parse(fs.readFileSync(inferredPath, "utf8"));
    expect(inferred.discoveredPorts).toContain("skill:newskill/SKILL.md");
  });
});

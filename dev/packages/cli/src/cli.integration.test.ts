import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Integration tests (spec Phase 3's test-strategy note for `packages/cli`):
 * spawn the *built* CLI (`dist/index.js`) against fixture directories, with
 * `PATCHBAY_HOME` pointed at a fresh OS tmpdir in the child's env -- never
 * the real `~/.patchbay`. Requires `pnpm build` to have run first; the
 * package's `pretest` script does this automatically.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = path.resolve(__dirname, "..", "dist", "index.js");

let studioHome: string;

beforeEach(() => {
  studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-integration-home-"));
});

function runCli(args: string[]) {
  return execa("node", [CLI_ENTRY, ...args], {
    env: { ...process.env, PATCHBAY_HOME: studioHome },
    reject: false,
  });
}

function buildFixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-integration-fixture-"));
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

describe("patchbay CLI (built binary)", () => {
  it("init exits 0 and writes studio.yaml", async () => {
    const result = await runCli(["init", "--name", "Integration Studio"]);
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(studioHome, "studio.yaml"))).toBe(true);
  });

  it("project add: no --path -> exit 1, never prompts (stdin is not a TTY under execa)", async () => {
    const result = await runCli(["project", "add"]);
    expect(result.exitCode).toBe(1);
  });

  it("project add: nonexistent --path -> exit 1", async () => {
    const result = await runCli(["project", "add", "--path", path.join(studioHome, "nope")]);
    expect(result.exitCode).toBe(1);
  });

  it("project add: success -> exit 0, prints ATLAS.md's absolute path, file exists with the fixed headings", async () => {
    const projectDir = buildFixtureRepo();
    const result = await runCli(["project", "add", "--path", projectDir, "--json"]);
    expect(result.exitCode).toBe(0);

    const payload = JSON.parse(result.stdout);
    expect(payload.ok).toBe(true);
    expect(path.isAbsolute(payload.atlasPath)).toBe(true);
    expect(fs.existsSync(payload.atlasPath)).toBe(true);

    const atlas = fs.readFileSync(payload.atlasPath, "utf8");
    expect(atlas).toContain("## Skills");
    expect(atlas).toContain("## Rules");
    expect(atlas).toContain("## Unlabeled ports");
  });

  it("project add: clarity score below threshold -> exit 2, not registered", async () => {
    const lowClarityDir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-integration-low-"));
    fs.writeFileSync(path.join(lowClarityDir, "notes.txt"), "no readme, no git\n");

    const result = await runCli(["project", "add", "--path", lowClarityDir, "--json"]);
    expect(result.exitCode).toBe(2);

    // Error-shaped output (including the --json form) goes to stderr, not
    // stdout -- a deliberate, consistent choice: stdout carries only
    // successful-command payloads (e.g. the ATLAS.md path on success).
    const payload = JSON.parse(result.stderr);
    expect(payload.ok).toBe(false);
    expect(payload.score).toBeLessThan(40);

    // Nothing was ever registered, so studio.yaml may not even exist yet --
    // and if it does (e.g. a prior successful add in this test), it must
    // not mention the rejected project's path.
    const studioYamlPath = path.join(studioHome, "studio.yaml");
    if (fs.existsSync(studioYamlPath)) {
      expect(fs.readFileSync(studioYamlPath, "utf8")).not.toContain(lowClarityDir);
    }
  });

  it("project new: no --path -> exit 1", async () => {
    const result = await runCli(["project", "new", "demo"]);
    expect(result.exitCode).toBe(1);
  });

  it("scan + atlas round trip against a registered project", async () => {
    const projectDir = buildFixtureRepo();
    const addResult = await runCli(["project", "add", "--path", projectDir, "--alias", "demo", "--json"]);
    expect(addResult.exitCode).toBe(0);

    const scanResult = await runCli(["scan", "--project", "demo"]);
    expect(scanResult.exitCode).toBe(0);

    const atlasResult = await runCli(["atlas", "--project", "demo"]);
    expect(atlasResult.exitCode).toBe(0);
    expect(atlasResult.stdout).toContain("- source:README.md");
  });

  it("atlas: unregistered alias -> exit 1", async () => {
    const result = await runCli(["atlas", "--project", "nope"]);
    expect(result.exitCode).toBe(1);
  });

  it("atlas --level 1/2/3 print the digest, ATLAS.md, and raw inferred.json respectively", async () => {
    const projectDir = buildFixtureRepo();
    await runCli(["project", "add", "--path", projectDir, "--alias", "demo", "--json"]);

    const l2Default = await runCli(["atlas", "--project", "demo"]);
    const l2Explicit = await runCli(["atlas", "--project", "demo", "--level", "2"]);
    expect(l2Default.exitCode).toBe(0);
    expect(l2Explicit.exitCode).toBe(0);
    expect(l2Explicit.stdout).toBe(l2Default.stdout);
    expect(l2Default.stdout).toContain("## Skills");

    const l1 = await runCli(["atlas", "--project", "demo", "--level", "1"]);
    expect(l1.exitCode).toBe(0);
    expect(l1.stdout).toContain("Rules: 1");
    expect(l1.stdout).not.toContain("## Skills");

    const l3 = await runCli(["atlas", "--project", "demo", "--level", "3"]);
    expect(l3.exitCode).toBe(0);
    const parsed = JSON.parse(l3.stdout);
    expect(parsed.discoveredPorts).toContain("source:README.md");
  });

  it("atlas --level 9 -> exit 1, doesn't silently fall back to L2", async () => {
    const projectDir = buildFixtureRepo();
    await runCli(["project", "add", "--path", projectDir, "--alias", "demo", "--json"]);

    const result = await runCli(["atlas", "--project", "demo", "--level", "9"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });

  it("patch: unknown skill slug -> exit 1 (the Bay is empty until a later phase populates it)", async () => {
    const projectDir = buildFixtureRepo();
    await runCli(["project", "add", "--path", projectDir, "--alias", "demo", "--json"]);

    const result = await runCli(["patch", "nonexistent-skill", "demo"]);
    expect(result.exitCode).toBe(1);
  });

  it("patch: unregistered project alias -> exit 1", async () => {
    const slug = "demo-skill";
    fs.mkdirSync(path.join(studioHome, "skills", slug), { recursive: true });
    fs.writeFileSync(path.join(studioHome, "skills", slug, "SKILL.md"), "# Demo Skill\n");

    const result = await runCli(["patch", slug, "nope"]);
    expect(result.exitCode).toBe(1);
  });

  it("patch: installs a skill into a registered project, records the wire, and it surfaces under atlas's Gaps section", async () => {
    const projectDir = buildFixtureRepo();
    await runCli(["project", "add", "--path", projectDir, "--alias", "demo", "--json"]);

    const slug = "demo-skill";
    const bayDir = path.join(studioHome, "skills", slug);
    fs.mkdirSync(bayDir, { recursive: true });
    fs.writeFileSync(path.join(bayDir, "SKILL.md"), "# Demo Skill\n");

    const patchResult = await runCli(["patch", slug, "demo", "--json"]);
    expect(patchResult.exitCode).toBe(0);
    const payload = JSON.parse(patchResult.stdout);
    expect(payload.ok).toBe(true);
    expect(["symlink", "copy"]).toContain(payload.install);
    expect(payload.wire).toMatchObject({
      from: `skill:${slug}`,
      to: `skill:skills/${slug}/SKILL.md`,
      kind: "uses",
    });

    const installedSkillMd = path.join(projectDir, "skills", slug, "SKILL.md");
    expect(fs.existsSync(installedSkillMd)).toBe(true);
    expect(fs.readFileSync(installedSkillMd, "utf8")).toBe("# Demo Skill\n");

    // ATLAS.md is kernel-owned and only rewritten by project add/scan --
    // `patch` itself only touches overlay.yaml (spec: scans never touch
    // overlay.yaml, but a scan DOES read it to re-render Atlas/Flow), so a
    // rescan is required before the new wire shows up in ATLAS.md.
    const rescan = await runCli(["scan", "--project", "demo"]);
    expect(rescan.exitCode).toBe(0);

    // No Patch was ever declared for this -- the Wire is expected to show
    // up as "wires without a patch" in Atlas's Gaps section, not an error.
    const atlasResult = await runCli(["atlas", "--project", "demo"]);
    expect(atlasResult.exitCode).toBe(0);
    expect(atlasResult.stdout).toContain("## Gaps");
    expect(atlasResult.stdout).toContain(`skill:${slug} --[uses]--> skill:skills/${slug}/SKILL.md`);
  });

  it("progress: no progress recorded yet -> exit 1, both with and without --project", async () => {
    const projectDir = buildFixtureRepo();
    await runCli(["project", "add", "--path", projectDir, "--alias", "demo", "--json"]);

    const noProject = await runCli(["progress"]);
    expect(noProject.exitCode).toBe(1);

    const withProject = await runCli(["progress", "--project", "demo", "--level", "2"]);
    expect(withProject.exitCode).toBe(1);
  });

  it("progress write: unregistered project alias -> exit 1", async () => {
    const result = await runCli(["progress", "write", "--project", "nope", "--summary", "x"]);
    expect(result.exitCode).toBe(1);
  });

  it(
    "progress write regenerates progress.yaml/PROGRESS.md/the studio-wide progress.md in one call, and " +
      "`progress` (bare) / `progress --project` read them back correctly -- specifically exercises commander's " +
      "nested `progress write --project ...` parsing, where `progress`'s own `--project` option must not swallow " +
      "the value meant for `write`'s `--project`",
    async () => {
      const projectDir = buildFixtureRepo();
      await runCli(["project", "add", "--path", projectDir, "--alias", "demo", "--json"]);

      const writeResult = await runCli([
        "progress",
        "write",
        "--project",
        "demo",
        "--summary",
        "wiring up phase 7",
        "--skill",
        "skill:map-project",
        "--step",
        "scan",
        "--json",
      ]);
      expect(writeResult.exitCode).toBe(0);
      const payload = JSON.parse(writeResult.stdout);
      expect(payload.ok).toBe(true);
      expect(payload.alias).toBe("demo");
      expect(fs.existsSync(path.join(studioHome, "projects", "demo", "progress.yaml"))).toBe(true);
      expect(fs.existsSync(path.join(studioHome, "projects", "demo", "PROGRESS.md"))).toBe(true);
      expect(fs.existsSync(path.join(studioHome, "progress.md"))).toBe(true);

      // `progress` with no --project -> the studio-wide rollup, not a
      // sole-registered-project default.
      const rollup = await runCli(["progress"]);
      expect(rollup.exitCode).toBe(0);
      expect(rollup.stdout).toContain("demo");
      expect(rollup.stdout).toContain("wiring up phase 7");

      // `progress --project demo` (level 1 default) -> one-line summary.
      const level1 = await runCli(["progress", "--project", "demo"]);
      expect(level1.exitCode).toBe(0);
      expect(level1.stdout).toContain("wiring up phase 7");
      expect(level1.stdout).not.toContain("# Progress");

      // `progress --project demo --level 2` -> full PROGRESS.md.
      const level2 = await runCli(["progress", "--project", "demo", "--level", "2"]);
      expect(level2.exitCode).toBe(0);
      expect(level2.stdout).toContain("# Progress");
      expect(level2.stdout).toContain("wiring up phase 7");

      // `progress --project demo --level 3` -> raw progress.yaml.
      const level3 = await runCli(["progress", "--project", "demo", "--level", "3"]);
      expect(level3.exitCode).toBe(0);
      expect(level3.stdout).toContain("wiring up phase 7");
      expect(level3.stdout).toContain("current:");
    },
  );

  it("progress --project: unregistered alias -> exit 1", async () => {
    const result = await runCli(["progress", "--project", "nope"]);
    expect(result.exitCode).toBe(1);
  });
});

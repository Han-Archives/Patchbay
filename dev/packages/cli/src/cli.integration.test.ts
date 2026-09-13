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
});

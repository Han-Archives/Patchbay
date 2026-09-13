import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { inferredSchema } from "../types/inferred.js";
import { scan } from "./scanner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds a fresh temp git repo (never inside this monorepo -- OS tmpdir
 * only, so no `.git` fixture ever gets committed here) with a mix of
 * discoverable ports and ignored content, then commits it once. Shelling
 * out to `git` is test-setup-only and exempt from the "no shelling out"
 * rule that applies to the scanner itself.
 */
function buildFixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-scanner-"));
  const run = (cmd: string) => execSync(cmd, { cwd: dir, stdio: "pipe" });

  fs.mkdirSync(path.join(dir, "src", "nested"), { recursive: true });
  fs.mkdirSync(path.join(dir, "node_modules", "dep"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".cursor", "rules"), { recursive: true });
  fs.mkdirSync(path.join(dir, "bay-slug-dir"), { recursive: true });

  fs.writeFileSync(path.join(dir, "README.md"), "# Fixture repo\n");
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# Agents\n");
  fs.writeFileSync(path.join(dir, "src", "nested", "SKILL.md"), "# Nested skill\n");
  fs.writeFileSync(path.join(dir, "bay-slug-dir", "SKILL.md"), "# Bay skill\n");
  fs.writeFileSync(path.join(dir, "node_modules", "dep", "README.md"), "ignored\n");
  fs.writeFileSync(path.join(dir, ".cursor", "rules", "style.md"), "# style rule\n");

  run("git init -q -b main");
  run("git config user.name 'Patchbay Test'");
  run("git config user.email test@patchbay.invalid");
  run("git add -A");
  run('git commit -q -m "initial commit"');

  return dir;
}

describe("scan", () => {
  it("produces a value that passes inferredSchema.safeParse", async () => {
    const dir = buildFixtureRepo();
    const result = await scan(dir);
    const parsed = inferredSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it("agents is always []", async () => {
    const dir = buildFixtureRepo();
    const result = await scan(dir);
    expect(result.agents).toEqual([]);
  });

  it("discoveredPorts contains the expected unlabeled ports, sorted ascending", async () => {
    const dir = buildFixtureRepo();
    const result = await scan(dir);

    expect(result.discoveredPorts).toEqual([...result.discoveredPorts].sort());
    expect(result.discoveredPorts).toContain("source:README.md");
    expect(result.discoveredPorts).toContain("source:AGENTS.md");
    expect(result.discoveredPorts).toContain("source:.cursor/rules/style.md");
    expect(result.discoveredPorts).toContain("skill:src/nested/SKILL.md");
    expect(result.discoveredPorts).toContain("skill:bay-slug-dir/SKILL.md");
    expect(result.discoveredPorts.some((p) => p.includes("node_modules"))).toBe(false);
  });

  it("applies the studioBaySlugs Bay-slug exception end to end", async () => {
    const dir = buildFixtureRepo();
    const result = await scan(dir, { studioBaySlugs: ["bay-slug-dir"] });
    expect(result.discoveredPorts).toContain("skill:bay-slug-dir");
    expect(result.discoveredPorts).not.toContain("skill:bay-slug-dir/SKILL.md");
  });

  it("git info reflects the real commit, with no ahead/behind field anywhere", async () => {
    const dir = buildFixtureRepo();
    const result = await scan(dir);
    expect(result.git.branch).toBe("main");
    expect(result.git.head).toMatch(/^[0-9a-f]{40}$/);
    expect(result.git.recentCommitSubjects).toEqual(["initial commit"]);
    expect(result.git).not.toHaveProperty("ahead");
    expect(result.git).not.toHaveProperty("behind");
  });

  it("returns [] discoveredPorts for a repo with none of the recognized signals", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-scanner-empty-"));
    fs.writeFileSync(path.join(dir, "index.ts"), "export {};\n");
    execSync("git init -q -b main", { cwd: dir, stdio: "pipe" });
    const result = await scan(dir);
    expect(result.discoveredPorts).toEqual([]);
  });

  it("scanning the same commit twice produces byte-identical JSON output", async () => {
    const dir = buildFixtureRepo();
    const first = await scan(dir);
    const second = await scan(dir);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  describe("smoke test against real, non-fixture input", () => {
    it("does not throw and produces a schema-valid result for this actual package's source directory", async () => {
      const realDir = path.resolve(__dirname, "..", ".."); // dev/packages/core
      await expect(scan(realDir)).resolves.toBeDefined();
      const result = await scan(realDir);
      expect(inferredSchema.safeParse(result).success).toBe(true);
    });

    // Regression test: running the built CLI against the real Patchbay repo
    // (not this isolated test) turned up the scanner's own __fixtures__
    // content as if it were this package's real README/AGENTS.md/SKILL.md --
    // the ignore list didn't cover test-fixture directories. Fixed by adding
    // __fixtures__/__mocks__/__snapshots__ to IGNORED_DIR_NAMES (명세 7.7,
    // 20260913c); this asserts none of this package's own scan test fixtures
    // ever leak into a scan of the package itself again.
    it("does not leak this package's own scan test fixtures into its own discoveredPorts", async () => {
      const realDir = path.resolve(__dirname, "..", ".."); // dev/packages/core
      const result = await scan(realDir);
      expect(result.discoveredPorts.some((port) => port.includes("__fixtures__"))).toBe(false);
    });
  });
});

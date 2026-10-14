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
      const realDir = path.resolve(__dirname, "..", ".."); // app/packages/core
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
      const realDir = path.resolve(__dirname, "..", ".."); // app/packages/core
      const result = await scan(realDir);
      expect(result.discoveredPorts.some((port) => port.includes("__fixtures__"))).toBe(false);
    });
  });
});

/**
 * A repo whose secret paths also satisfy a signal-file pattern. Both of these
 * are real collisions in the two rule sets, not invented edge cases:
 * `.ssh/README.md` matches README.* and sits in a secret directory, and
 * `secrets/.cursor/rules/*.mdc` matches the `.cursor/rules` rule the same way.
 */
function buildSecretSignalRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-secret-signal-"));
  fs.mkdirSync(path.join(dir, ".ssh"), { recursive: true });
  fs.mkdirSync(path.join(dir, "secrets", ".cursor", "rules"), { recursive: true });

  fs.writeFileSync(path.join(dir, "README.md"), "# public\n");
  fs.writeFileSync(path.join(dir, ".ssh", "README.md"), "private key notes\n");
  fs.writeFileSync(path.join(dir, "secrets", ".cursor", "rules", "x.mdc"), "secret rule\n");

  return dir;
}

describe("scan: sensitivity is classified at write time", () => {
  it("records a level for every graded port", async () => {
    const dir = buildFixtureRepo();
    try {
      const inferred = await scan(dir, { studioBaySlugs: ["bay-slug-dir"] });

      // Every advertised jack carries a stored verdict -- nothing downstream
      // has to re-derive the grade (or forget to).
      for (const port of inferred.discoveredPorts) {
        const verdict = inferred.portLevels[port];
        expect(verdict, port).toBeDefined();
        expect(verdict?.reason.length, port).toBeGreaterThan(0);
      }

      const graded = (port: string) => {
        const verdict = inferred.portLevels[port];
        if (!verdict) throw new Error(`no stored verdict for "${port}"`);
        return verdict;
      };

      expect(graded("source:README.md").level).toBe(0);
      expect(graded("source:AGENTS.md").level).toBe(0);
      expect(graded("source:.cursor/rules/style.md").level).toBe(0);
      // A project-local SKILL.md is an ordinary working file.
      expect(graded("skill:src/nested/SKILL.md").level).toBe(2);
      // A Bay slug has no project path, so it gets the working default and a
      // reason that says so rather than implying a rule matched.
      expect(graded("skill:bay-slug-dir").level).toBe(2);
      expect(graded("skill:bay-slug-dir").reason).toContain("슬러그");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("withholds a secret port from discoveredPorts but still records its grade", async () => {
    const dir = buildSecretSignalRepo();
    try {
      const inferred = await scan(dir);

      // Withheld: an L4 file must never be advertised as a jack something
      // downstream might read.
      expect(inferred.discoveredPorts).toContain("source:README.md");
      expect(inferred.discoveredPorts).not.toContain("source:.ssh/README.md");
      expect(inferred.discoveredPorts).not.toContain("source:secrets/.cursor/rules/x.mdc");

      // Still audited: classifyPath judges the path without opening the file,
      // so the grade survives without the content leaking.
      expect(inferred.portLevels["source:.ssh/README.md"]?.level).toBe(4);
      expect(inferred.portLevels["source:secrets/.cursor/rules/x.mdc"]?.level).toBe(4);
      expect(inferred.portLevels["source:.ssh/README.md"]?.reason).toContain("비밀 폴더");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

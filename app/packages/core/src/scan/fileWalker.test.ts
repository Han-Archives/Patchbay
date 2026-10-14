import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { walk } from "./fileWalker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PROJECT = path.join(__dirname, "__fixtures__", "sample-project");

describe("walk", () => {
  it("skips ignored directories (node_modules, dist) entirely", () => {
    const files = walk(SAMPLE_PROJECT).map((f) => f.relativePath);
    expect(files.some((f) => f.startsWith("node_modules/"))).toBe(false);
    expect(files.some((f) => f.startsWith("dist/"))).toBe(false);
  });

  it("finds files at any depth outside ignored directories", () => {
    const files = walk(SAMPLE_PROJECT).map((f) => f.relativePath);
    expect(files).toContain("README.md");
    expect(files).toContain("src/nested/SKILL.md");
    expect(files).toContain(".cursor/rules/a.md");
    expect(files).toContain("studio-bay-example/SKILL.md");
  });

  it("returns POSIX relative paths with no leading './'", () => {
    const files = walk(SAMPLE_PROJECT).map((f) => f.relativePath);
    for (const f of files) {
      expect(f.startsWith("./")).toBe(false);
      expect(f.includes("\\")).toBe(false);
    }
  });

  it("returns results sorted ascending by relative path", () => {
    const files = walk(SAMPLE_PROJECT).map((f) => f.relativePath);
    const sorted = [...files].sort();
    expect(files).toEqual(sorted);
  });

  it("returns absolutePath entries that actually resolve under rootDir", () => {
    const files = walk(SAMPLE_PROJECT);
    for (const f of files) {
      expect(path.isAbsolute(f.absolutePath)).toBe(true);
      expect(f.absolutePath.endsWith(f.relativePath.split("/").join(path.sep))).toBe(true);
    }
  });

  it("skips the storage layers: workspace/ and archive/ at the root only, .trash/.index anywhere", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-filewalker-layers-"));
    for (const rel of [
      "workspace/projects/a/rooms/r.jsonl",
      "archive/docs/old.md",
      ".trash/2026-10-14/MANIFEST.md",
      "app/.index/graph.json",
      "app/archive/keep.md",
      "knowledge/patchbay/README.md",
    ]) {
      fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), "x");
    }
    expect(walk(dir).map((f) => f.relativePath)).toEqual(["app/archive/keep.md", "knowledge/patchbay/README.md"]);
  });

  it("returns an empty array for an empty directory", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-filewalker-empty-"));
    expect(walk(emptyDir)).toEqual([]);
  });

  it("does not descend into a nested ignored directory even several levels deep", () => {
    const files = walk(SAMPLE_PROJECT).map((f) => f.relativePath);
    expect(files.some((f) => f.includes("/node_modules/"))).toBe(false);
    expect(files.some((f) => f.includes("/dist/"))).toBe(false);
  });

  // Regression test (명세 7.7, 20260913c): running the built CLI against the
  // real Patchbay repo turned up this very package's own scan test fixtures
  // as if they were the scanned project's real signals -- the ignore list
  // had no entry for test-infrastructure directories. A dynamic temp dir is
  // used here (not the static __fixtures__ fixture) to keep this test
  // independent of that fixture's own contents.
  // Regression test: `patchbay patch` installs a Skill Bay package into a
  // project by symlinking the whole package *directory* (installSkillInto
  // Project's default method). Found via a manual QA walkthrough of the
  // new-project onboarding scenario -- after patching in a real skill, its
  // SKILL.md never showed up in Atlas at all, because `entry.isDirectory()`
  // is false for a symlink (it reflects the symlink itself, not the
  // target), so the whole directory was silently skipped.
  it("descends into a symlinked directory and finds files inside it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-filewalker-symlinkdir-"));
    const realSkillDir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-filewalker-symlink-target-"));
    fs.writeFileSync(path.join(realSkillDir, "SKILL.md"), "# a real skill\n");

    fs.mkdirSync(path.join(dir, "skills"));
    fs.symlinkSync(realSkillDir, path.join(dir, "skills", "map-project"), "dir");

    const files = walk(dir).map((f) => f.relativePath);
    expect(files).toContain("skills/map-project/SKILL.md");
  });

  it("treats a symlinked file (not a directory) the same as before -- still discovered as a single file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-filewalker-symlinkfile-"));
    const realFile = path.join(dir, "real-readme.md");
    fs.writeFileSync(realFile, "# real\n");
    fs.symlinkSync(realFile, path.join(dir, "README.md"));

    const files = walk(dir).map((f) => f.relativePath);
    expect(files.sort()).toEqual(["README.md", "real-readme.md"]);
  });

  it("does not infinite-loop on a symlink cycle (a symlinked directory pointing back at an ancestor)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-filewalker-symlinkcycle-"));
    fs.mkdirSync(path.join(dir, "nested"));
    fs.writeFileSync(path.join(dir, "nested", "real.md"), "x\n");
    fs.symlinkSync(dir, path.join(dir, "nested", "back-to-root"), "dir");

    const files = walk(dir).map((f) => f.relativePath);
    expect(files).toEqual(["nested/real.md"]);
  });

  it("skips __fixtures__/__mocks__/__snapshots__ entirely", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-filewalker-testdirs-"));
    fs.mkdirSync(path.join(dir, "__fixtures__"), { recursive: true });
    fs.mkdirSync(path.join(dir, "__mocks__"), { recursive: true });
    fs.mkdirSync(path.join(dir, "__snapshots__"), { recursive: true });
    fs.writeFileSync(path.join(dir, "__fixtures__", "fake-readme.md"), "not real\n");
    fs.writeFileSync(path.join(dir, "__mocks__", "fake-agents.md"), "not real\n");
    fs.writeFileSync(path.join(dir, "__snapshots__", "fake.snap"), "not real\n");
    fs.writeFileSync(path.join(dir, "REAL.md"), "the actual project content\n");

    const files = walk(dir).map((f) => f.relativePath);
    expect(files).toEqual(["REAL.md"]);
  });
});

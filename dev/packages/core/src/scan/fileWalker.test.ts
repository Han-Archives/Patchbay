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

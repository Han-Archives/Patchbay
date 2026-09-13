import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { walk } from "./fileWalker.js";
import { findSignalPaths } from "./signalReader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PROJECT = path.join(__dirname, "__fixtures__", "sample-project");
const CURSOR_RULES_FILE = path.join(__dirname, "__fixtures__", "cursor-rules-file");

describe("findSignalPaths", () => {
  it("finds README.md, README.<ext>, AGENTS.md, and CLAUDE.md at the root", () => {
    const paths = findSignalPaths(walk(SAMPLE_PROJECT));
    expect(paths).toContain("README.md");
    expect(paths).toContain("README.ko.md");
    expect(paths).toContain("AGENTS.md");
    expect(paths).toContain("CLAUDE.md");
  });

  it("finds each *.md/*.mdc file directly inside a .cursor/rules directory", () => {
    const paths = findSignalPaths(walk(SAMPLE_PROJECT));
    expect(paths).toContain(".cursor/rules/a.md");
    expect(paths).toContain(".cursor/rules/b.mdc");
  });

  it("ignores non-.md/.mdc files inside .cursor/rules", () => {
    const paths = findSignalPaths(walk(SAMPLE_PROJECT));
    expect(paths).not.toContain(".cursor/rules/notes.txt");
  });

  it("does not reach into a subdirectory nested inside .cursor/rules", () => {
    const paths = findSignalPaths(walk(SAMPLE_PROJECT));
    expect(paths.some((p) => p.startsWith(".cursor/rules/nested-should-not-count"))).toBe(false);
  });

  it("does not find signals inside ignored directories", () => {
    const paths = findSignalPaths(walk(SAMPLE_PROJECT));
    expect(paths.some((p) => p.startsWith("node_modules/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("dist/"))).toBe(false);
  });

  it("treats a literal .cursor/rules file (no extension) as a single signal", () => {
    const paths = findSignalPaths(walk(CURSOR_RULES_FILE));
    expect(paths).toEqual([".cursor/rules"]);
  });

  it("returns results sorted ascending", () => {
    const paths = findSignalPaths(walk(SAMPLE_PROJECT));
    expect(paths).toEqual([...paths].sort());
  });

  it("does not match a bare 'README' with no extension", () => {
    const paths = findSignalPaths([
      { absolutePath: "/x/README", relativePath: "README" },
    ]);
    expect(paths).toEqual([]);
  });
});

import fs from "node:fs";
import path from "node:path";

/**
 * Directory names skipped entirely during traversal, at any depth (spec
 * Phase 2 ignore list, extended per 명세 7.7 20260913c). Matched against the
 * bare directory name, not a path segment pattern.
 *
 * `__fixtures__`/`__mocks__`/`__snapshots__` (Jest/vitest test-infrastructure
 * conventions) were added after scanning Patchbay's own repo turned up its
 * own scanner's test fixtures as if they were the real project's README/
 * AGENTS.md/SKILL.md -- discovered by actually running the built CLI against
 * a real project, not by the automated test suite (which only ever scanned
 * isolated temp fixtures). Deliberately double-underscore-only: a bare
 * `fixtures/` is not assumed to be test-only, since some real projects use
 * that name for genuine product content.
 */
export const IGNORED_DIR_NAMES = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
  "venv",
  ".venv",
  "__pycache__",
  "target",
  "vendor",
  ".pnpm-store",
  "Pods",
  ".output",
  "__fixtures__",
  "__mocks__",
  "__snapshots__",
] as const;

const IGNORED_DIR_SET = new Set<string>(IGNORED_DIR_NAMES);

export interface WalkedFile {
  /** Absolute filesystem path (OS-native separators). */
  absolutePath: string;
  /** POSIX-style path relative to the scan root. No leading "./". */
  relativePath: string;
}

function toPosixPath(nativePath: string): string {
  return nativePath.split(path.sep).join("/");
}

/**
 * Recursively walks `rootDir`, skipping any directory whose name appears in
 * `IGNORED_DIR_NAMES` (at any depth). Returns files only — not directories;
 * downstream consumers (signalReader, portDetector) only ever need to test
 * file paths/names, and a directory entry for e.g. a `.cursor/rules` dir
 * adds nothing they can't get from the files inside it.
 *
 * Sorted ascending by POSIX relative path. This is load-bearing for
 * determinism: `fs.readdirSync` order is filesystem/OS-dependent and must
 * never leak into the scanner's output.
 */
export function walk(rootDir: string): WalkedFile[] {
  const results: WalkedFile[] = [];

  function visit(currentDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      // Unreadable directory (permissions, race with a delete, etc.) — skip
      // rather than fail the whole scan.
      return;
    }

    for (const entry of entries) {
      const absoluteEntryPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIR_SET.has(entry.name)) continue;
        visit(absoluteEntryPath);
        continue;
      }

      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          isFile = fs.statSync(absoluteEntryPath).isFile();
        } catch {
          continue; // broken symlink
        }
      }
      if (!isFile) continue;

      results.push({
        absolutePath: absoluteEntryPath,
        relativePath: toPosixPath(path.relative(rootDir, absoluteEntryPath)),
      });
    }
  }

  visit(rootDir);
  results.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
  return results;
}

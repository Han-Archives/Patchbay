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
  // Patchbay 저장 구조의 파생 · 임시 층 (저장구조.md, 2026-10-14) — 어느 깊이든 산출물이지 원본이 아니다.
  ".trash",
  ".index",
  "dist-client",
  "dist-server",
] as const;

/**
 * 스캔 뿌리 바로 아래에서만 건너뛰는 폴더 (저장구조.md, 2026-10-14). `workspace/`는 원문층(대화 · 실행
 * 원문, 등급 허가)이고 `archive/`는 보관 판이라 구조 요약에 들어가면 지금 계약처럼 읽힌다. 깊은 곳의
 * 같은 이름은 실제 제품 폴더일 수 있어 이름 목록(위)에 넣지 않는다.
 */
export const ROOT_IGNORED_DIR_NAMES = ["workspace", "archive"] as const;

const IGNORED_DIR_SET = new Set<string>(IGNORED_DIR_NAMES);
const ROOT_IGNORED_DIR_SET = new Set<string>(ROOT_IGNORED_DIR_NAMES);

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
  // Guards against a symlinked directory that (directly or via a cycle of
  // symlinks) points back at a directory already being visited -- without
  // this, `visit` would recurse forever. Keyed by realpath so a symlink and
  // its target are recognized as the same directory.
  const visitedRealDirs = new Set<string>();

  function visit(currentDir: string): void {
    let realDir: string;
    try {
      realDir = fs.realpathSync(currentDir);
    } catch {
      return; // broken symlink target, race with a delete, etc.
    }
    if (visitedRealDirs.has(realDir)) return;
    visitedRealDirs.add(realDir);

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

      const ignored = IGNORED_DIR_SET.has(entry.name) || (currentDir === rootDir && ROOT_IGNORED_DIR_SET.has(entry.name));

      if (entry.isDirectory()) {
        if (ignored) continue;
        visit(absoluteEntryPath);
        continue;
      }

      if (entry.isSymbolicLink()) {
        // `Dirent.isDirectory()`/`isFile()` reflect the symlink itself
        // (always false), never the target -- `installSkillIntoProject`'s
        // default install method symlinks a whole skill *directory* into a
        // project, so without this branch every file inside it (SKILL.md
        // included) is silently invisible to the scanner.
        let stat: fs.Stats;
        try {
          stat = fs.statSync(absoluteEntryPath);
        } catch {
          continue; // broken symlink
        }
        if (stat.isDirectory()) {
          if (ignored) continue;
          visit(absoluteEntryPath);
          continue;
        }
        if (!stat.isFile()) continue;
        results.push({
          absolutePath: absoluteEntryPath,
          relativePath: toPosixPath(path.relative(rootDir, absoluteEntryPath)),
        });
        continue;
      }

      if (!entry.isFile()) continue;

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

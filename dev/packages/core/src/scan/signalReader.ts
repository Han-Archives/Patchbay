import path from "node:path";
import type { WalkedFile } from "./fileWalker.js";

// README.md is a special case of "README.*" (any extension); matching
// "README." + at least one more character covers both without special-casing
// the bare ".md" case. A file literally named "README" with no extension is
// NOT matched -- the spec's table lists "README.md, README.*", not bare
// "README".
const README_PATTERN = /^README\..+$/;

/**
 * Finds "signal" files among an already-walked file list: README(.*),
 * AGENTS.md, CLAUDE.md, and `.cursor/rules` (as a literal file, or as a
 * directory -- in which case each `*.md`/`*.mdc` file directly inside it
 * counts, but nothing nested deeper).
 *
 * Matches at any depth, not just the scan root -- the spec's table doesn't
 * restrict these to the root (unlike, say, requiring a specific location),
 * and per-package README/AGENTS.md files inside a monorepo are exactly the
 * kind of thing this scanner should surface.
 *
 * Returns POSIX relative paths, sorted ascending. Does not itself produce
 * PortIds -- portDetector wraps these as `source:<path>`.
 */
export function findSignalPaths(files: WalkedFile[]): string[] {
  const found = new Set<string>();

  for (const file of files) {
    const rel = file.relativePath;
    const base = path.posix.basename(rel);

    if (README_PATTERN.test(base) || base === "AGENTS.md" || base === "CLAUDE.md") {
      found.add(rel);
      continue;
    }

    const dir = path.posix.dirname(rel);

    // `.cursor/rules` as a literal file (no extension): base is "rules"
    // and its immediate parent directory is named ".cursor".
    if (base === "rules" && path.posix.basename(dir) === ".cursor") {
      found.add(rel);
      continue;
    }

    // `.cursor/rules/<file>.md|.mdc`, directly inside a `.cursor/rules`
    // directory (not nested any deeper inside it).
    if (
      path.posix.basename(dir) === "rules" &&
      path.posix.basename(path.posix.dirname(dir)) === ".cursor" &&
      (base.endsWith(".md") || base.endsWith(".mdc"))
    ) {
      found.add(rel);
    }
  }

  return Array.from(found).sort();
}

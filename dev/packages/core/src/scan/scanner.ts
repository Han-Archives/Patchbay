import path from "node:path";
import { inferredSchema, type Inferred } from "../types/inferred.js";
import { walk } from "./fileWalker.js";
import { readGitInfo } from "./gitReader.js";
import { detectPorts } from "./portDetector.js";

export interface ScanOptions {
  /** Studio Bay slugs known in this context. Default: `[]` (see portDetector). */
  studioBaySlugs?: string[];
}

/**
 * Deterministic scanner composition root (Phase 2).
 *
 * Given a local folder path, walks the file tree (skipping the standard
 * ignore list), reads local-only git metadata, and detects ports
 * (SKILL.md / README / AGENTS.md / CLAUDE.md / .cursor/rules) to produce a
 * value matching `inferredSchema` -- the "unlabeled jacks" the scanner
 * found, with no concept of an ontology to label them against (that's a
 * later phase's job).
 *
 * No LLM calls, no network calls. Given the same on-disk + git state, this
 * function is deterministic: every array is sorted before being returned,
 * and nothing timestamp- or filesystem-order-derived is included.
 */
export async function scan(rootDir: string, options: ScanOptions = {}): Promise<Inferred> {
  const absoluteRoot = path.resolve(rootDir);

  const files = walk(absoluteRoot);
  const discoveredPorts = detectPorts(files, { studioBaySlugs: options.studioBaySlugs ?? [] });
  const git = await readGitInfo(absoluteRoot);

  const result: Inferred = {
    discoveredPorts,
    git,
    agents: [],
  };

  // Parse (not just validate) so the returned value is exactly what
  // `inferredSchema` produces (defaults applied, branded PortId type) --
  // a thrown error here would mean a bug in this module, not bad input.
  return inferredSchema.parse(result);
}

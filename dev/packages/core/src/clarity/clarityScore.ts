import path from "node:path";
import type { Inferred } from "../types/inferred.js";

/** Basename substrings that flag a likely duplicate/backup file (spec formula, verbatim list). */
const DUPLICATE_PATTERNS = ["_v2", "_final", "_backup", " copy", "복사본"] as const;

export interface ClarityScoreInput {
  hasReadme: boolean;
  /** Already capped at 20 by gitReader, most-recent-first. */
  commitSubjects: string[];
  /** Every file's POSIX relative path (from fileWalker.walk), not just discovered ports. */
  allRelativePaths: string[];
}

/**
 * Pure clarity-score heuristic (spec formula, verbatim):
 *   +50                 if a README exists
 *   +50 * uniqueness     of commit subjects (unique/total; 0 commits -> 0, not NaN)
 *   -5 per (file, pattern) duplicate-name match, penalty floored at -30
 * Final result clamped to [0, 100] -- nothing else in the formula
 * guarantees that range on its own.
 */
export function computeClarityScore(input: ClarityScoreInput): number {
  const readmeTerm = input.hasReadme ? 50 : 0;

  const totalCommits = input.commitSubjects.length;
  const uniqueCommits = new Set(input.commitSubjects).size;
  const commitUniquenessTerm = totalCommits === 0 ? 0 : (uniqueCommits / totalCommits) * 50;

  let duplicateMatchCount = 0;
  for (const relativePath of input.allRelativePaths) {
    const base = path.posix.basename(relativePath);
    for (const pattern of DUPLICATE_PATTERNS) {
      if (base.includes(pattern)) duplicateMatchCount += 1;
    }
  }
  const duplicatePenalty = Math.max(-30, -5 * duplicateMatchCount);

  const rawScore = readmeTerm + commitUniquenessTerm + duplicatePenalty;
  return Math.min(100, Math.max(0, rawScore));
}

/**
 * `hasReadme` per the spec's reuse rule: does `discoveredPorts` contain any
 * `source:README.*` port (same notion the scanner already applies via
 * `signalReader`'s README pattern -- not reimplemented here).
 */
export function hasReadmePort(inferred: Pick<Inferred, "discoveredPorts">): boolean {
  return inferred.discoveredPorts.some((port) => {
    if (!port.startsWith("source:")) return false;
    const ref = port.slice("source:".length);
    const base = path.posix.basename(ref);
    return /^README\..+$/.test(base);
  });
}

import { z } from "zod";

/**
 * `excavation.json` shape -- the forensic scanner's output (spec 6.3/9.7,
 * Phase 9). Written **inside the target project repo**, not the studio
 * home -- unlike `inferred.json` this is a different scan mode entirely
 * (no ontology, no PortId concept), so it gets its own schema rather than
 * extending `inferredSchema`.
 *
 * This is raw/aggregated signal only -- no LLM, no cluster hypotheses.
 * Turning these signals into "this folder looks like N mixed projects"
 * cards is the `triage-project` skill's (host LLM's) job, reading this
 * file as material.
 */

export const excavationDuplicateMatchSchema = z.object({
  relativePath: z.string(),
  pattern: z.string(),
});
export type ExcavationDuplicateMatch = z.infer<typeof excavationDuplicateMatchSchema>;

export const excavationModificationBucketSchema = z.object({
  label: z.string(),
  /** Upper bound in days for this bucket; `null` means "everything older than the previous bucket". */
  maxAgeDays: z.number().nullable(),
  fileCount: z.number(),
});
export type ExcavationModificationBucket = z.infer<typeof excavationModificationBucketSchema>;

export const excavationSchema = z.object({
  /**
   * When this excavation ran (`new Date().toISOString()` by default) --
   * needed to make sense of `modificationDistribution`'s age buckets.
   * Unlike `scan()`, this is intentionally wall-clock-derived rather than
   * pure-disk-state-derived, so re-running it later on unchanged files
   * legitimately reshuffles which bucket each file falls into.
   */
  scannedAt: z.string(),
  totalFiles: z.number(),
  git: z.object({
    isRepo: z.boolean(),
    commitCount: z.number(),
    /** unique commit subjects / total commit subjects; 0 commits -> 0, not NaN. */
    uniqueCommitRatio: z.number(),
  }),
  readme: z.object({
    exists: z.boolean(),
    wordCount: z.number(),
  }),
  /** Every (file, pattern) hit for the duplicate/variant-name patterns (`_v2`, `_final`, `_backup`, ...). */
  duplicateMatches: z.array(excavationDuplicateMatchSchema).default([]),
  /** Every file counted in exactly one bucket, ordered oldest-bound-first. */
  modificationDistribution: z.array(excavationModificationBucketSchema).default([]),
  /**
   * v0 heuristic: a file alone in its directory (no sibling files) whose
   * basename isn't one of the small set of names expected to live alone
   * (README, LICENSE, package.json, index.*, ...). Over-flags by design --
   * a human reviews these via `triage-project`, nothing here deletes
   * anything.
   */
  orphanFiles: z.array(z.string()).default([]),
  todoDensity: z.object({
    totalMatches: z.number(),
    filesWithMatches: z.number(),
    /** Files actually read for TODO/FIXME (excludes binaries and oversized files). */
    scannedTextFiles: z.number(),
  }),
});
export type Excavation = z.infer<typeof excavationSchema>;

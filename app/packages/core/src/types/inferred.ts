import { z } from "zod";
import { portIdSchema } from "./portId.js";
import { SENSITIVITY_LEVELS } from "../sensitivity/sensitivity.js";
import { agentSchema } from "./project.js";

/**
 * `inferred.json` shape — the scanner's output. Kernel-owned, always
 * overwritten wholesale by a scan; a scan never reads this to preserve
 * prior content.
 */

export const inferredGitInfoSchema = z.object({
  branch: z.string(),
  head: z.string(), // full commit SHA
  // Subject lines only, most-recent first. No ahead/behind counts — that
  // is an intentional v1 exclusion (spec 7.8), not an oversight.
  recentCommitSubjects: z.array(z.string()).default([]),
});
export type InferredGitInfo = z.infer<typeof inferredGitInfoSchema>;

/**
 * A stored sensitivity verdict: the level plus the one-line rule that
 * assigned it. Persisted so a level is *classified at write time* rather
 * than recomputed at every read -- every consumer (Neo4j ingest, the
 * knowledge search, an MCP bundle) reads the same grade the scan recorded,
 * and the reason survives to be shown to whoever gets refused.
 */
export const storedSensitivitySchema = z.object({
  level: z.union(SENSITIVITY_LEVELS.map((value) => z.literal(value)) as [z.ZodLiteral<0>, z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<4>]),
  reason: z.string().min(1),
});
export type StoredSensitivity = z.infer<typeof storedSensitivitySchema>;

export const inferredSchema = z.object({
  // "Unlabeled jacks": PortIds the scanner discovered that aren't yet
  // claimed by anyone's ontology. Conceptually sorted ascending by the
  // scanner (a later phase); the schema itself does not enforce order.
  discoveredPorts: z.array(portIdSchema).default([]),
  /**
   * Every port the scan graded, keyed by PortId -- including ones withheld
   * from `discoveredPorts` for being secret. The grade is the record; the
   * path is not the secret (Atlas already shows names without contents),
   * so withholding the jack and keeping the audit trail are both possible.
   */
  portLevels: z.record(z.string(), storedSensitivitySchema).default({}),
  git: inferredGitInfoSchema,
  // Always [] in v1 — the scanner never populates Agent (spec 7.8 / 1.2).
  agents: z.array(agentSchema).max(0).default([]),
});
export type Inferred = z.infer<typeof inferredSchema>;

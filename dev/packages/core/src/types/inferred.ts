import { z } from "zod";
import { portIdSchema } from "./portId.js";
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

export const inferredSchema = z.object({
  // "Unlabeled jacks": PortIds the scanner discovered that aren't yet
  // claimed by anyone's ontology. Conceptually sorted ascending by the
  // scanner (a later phase); the schema itself does not enforce order.
  discoveredPorts: z.array(portIdSchema).default([]),
  git: inferredGitInfoSchema,
  // Always [] in v1 — the scanner never populates Agent (spec 7.8 / 1.2).
  agents: z.array(agentSchema).max(0).default([]),
});
export type Inferred = z.infer<typeof inferredSchema>;

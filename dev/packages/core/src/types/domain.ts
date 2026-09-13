import { z } from "zod";
import { portIdOfKind } from "./portId.js";

/**
 * Domain ontology (spec section 1.2): Concept, Decision, Signal, View.
 *
 *   Project  --> Concept
 *   View     --> Signal
 *   Decision --> Concept
 *
 * Concept/Decision/View are not addressable via the PortId scheme (its
 * kind enum has no "concept" | "decision" | "view" member), so they use a
 * plain string id and reference their parent by that id/alias instead.
 * Signal is the one domain class with its own PortId kind.
 */

// --- Concept --------------------------------------------------------------

export const conceptSchema = z.object({
  id: z.string(), // unique within the owning Project
  project: z.string(), // alias of the owning Project
  name: z.string(),
  description: z.string().optional(),
});
export type Concept = z.infer<typeof conceptSchema>;

// --- Decision ---------------------------------------------------------

export const decisionSchema = z.object({
  id: z.string(),
  concept: z.string(), // Concept.id this Decision relates to
  summary: z.string(),
  rationale: z.string().optional(),
  date: z.string().optional(), // ISO 8601 date
});
export type Decision = z.infer<typeof decisionSchema>;

// --- Signal -------------------------------------------------------------

export const signalSchema = z.object({
  port: portIdOfKind("signal"),
  description: z.string().optional(),
  detectedAt: z.string().optional(), // ISO 8601 timestamp, when known
});
export type Signal = z.infer<typeof signalSchema>;

// --- View -----------------------------------------------------------------

export const viewSchema = z.object({
  id: z.string(),
  name: z.string(),
  signals: z.array(portIdOfKind("signal")).default([]), // View --> Signal
  description: z.string().optional(),
});
export type View = z.infer<typeof viewSchema>;

import { z } from "zod";

/**
 * `progress.yaml` shape. `current` is only ever set by explicit CLI/skill
 * calls in later phases — never inferred — so nothing here implies
 * automatic derivation.
 */

export const progressEntrySchema = z.object({
  project: z.string(), // alias of the project this entry concerns
  skill: z.string().optional(), // skill port/slug being run, if any
  step: z.string().optional(), // named step within that skill, if any
  summary: z.string(), // freeform description of what is/was being worked on
  timestamp: z.string(), // ISO 8601 timestamp when this entry was recorded
});
export type ProgressEntry = z.infer<typeof progressEntrySchema>;

export const progressSchema = z.object({
  current: progressEntrySchema.nullable(), // null when nothing is currently in progress
  history: z.array(progressEntrySchema).default([]),
});
export type Progress = z.infer<typeof progressSchema>;

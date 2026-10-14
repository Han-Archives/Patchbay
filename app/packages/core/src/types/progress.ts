import { z } from "zod";

/**
 * `progress.yaml` shape. `current` is only ever set by explicit CLI/skill
 * calls in later phases — never inferred — so nothing here implies
 * automatic derivation.
 */

/**
 * `asked`/`did` are the request and what actually shipped for it, written by
 * the host model (Cursor/Claude Code) that already holds the conversation --
 * the kernel neither reads a transcript nor calls a model for them (기획 §4
 * rules out both). They stay optional: an entry recorded by a skill mid-run
 * has a `summary` and no request behind it.
 */
export const progressEntrySchema = z.object({
  project: z.string(), // alias of the project this entry concerns
  skill: z.string().optional(), // skill port/slug being run, if any
  step: z.string().optional(), // named step within that skill, if any
  summary: z.string(), // freeform description of what is/was being worked on
  asked: z.string().optional(), // what the person asked for, in their terms
  did: z.string().optional(), // what was actually built or changed for it
  timestamp: z.string(), // ISO 8601 timestamp when this entry was recorded
});
export type ProgressEntry = z.infer<typeof progressEntrySchema>;

export const progressSchema = z.object({
  current: progressEntrySchema.nullable(), // null when nothing is currently in progress
  history: z.array(progressEntrySchema).default([]),
});
export type Progress = z.infer<typeof progressSchema>;

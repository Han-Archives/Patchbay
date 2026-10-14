import { z } from "zod";
import { sensitivityLevelSchema } from "../types/ir.js";

/**
 * 실행 기록 -- one run of one graph, normalized (명세 20260929a §5.2).
 *
 * **Never called `trace`** (§5.1): that word is taken by requirement tracing
 * (`requirementLinks[]`), and if the two share a name M6 cannot say which one a
 * report is about.
 *
 * Providers differ in how they expose a run; the shape that comes *out* is this
 * one and only this one. Core never sees a provider SDK -- an adapter does the
 * pulling and hands bytes to `normalizeRunRecord`.
 */

/** Four values, fixed. A fifth would make every consumer's switch incomplete. */
export const RUN_STATUSES = ["success", "error", "timeout", "refused"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** A single call's outcome. The same four values: a call fails the ways a run fails. */
export const CALL_STATUSES = RUN_STATUSES;
export type CallStatus = RunStatus;

/** What kind of failure. `refusal` and `timeout` are the two R6-shaped ones. */
export const ERROR_KINDS = ["refusal", "timeout", "tool", "schema", "runtime"] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

const isoSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "ISO8601 시각이 아니다" });

export const modelCallSchema = z.object({
  nodeId: z.string().min(1),
  model: z.string().min(1),
  provider: z.string().min(1),
  status: z.enum(CALL_STATUSES),
  ms: z.number().nonnegative(),
  tokensIn: z.number().nonnegative().optional(),
  tokensOut: z.number().nonnegative().optional(),
});
export type ModelCall = z.infer<typeof modelCallSchema>;

export const toolCallSchema = z.object({
  nodeId: z.string().min(1),
  tool: z.string().min(1),
  /** Free strings, not `CapId`: a runtime may report a capability the design never declared -- that is exactly what §4.3 ③ has to catch. */
  caps: z.array(z.string()),
  status: z.enum(CALL_STATUSES),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

export const documentCallSchema = z.object({
  nodeId: z.string().min(1),
  path: z.string().min(1),
  level: sensitivityLevelSchema,
  /** 근거 경로 -- what M5's retrieval answers. Optional because a hardcoded router has none. */
  via: z.string().optional(),
});
export type DocumentCall = z.infer<typeof documentCallSchema>;

export const runUsageSchema = z.object({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  costUsd: z.number().nonnegative().optional(),
});
export type RunUsage = z.infer<typeof runUsageSchema>;

export const runErrorSchema = z.object({
  kind: z.enum(ERROR_KINDS),
  message: z.string(),
  nodeId: z.string().min(1),
});
export type RunError = z.infer<typeof runErrorSchema>;

/**
 * The three call arrays and `error` carry **no defaults on purpose** (명세 §5.2):
 * 「빈 배열은 값이다. 필드를 빼는 것과 `[]`는 다르다」 -- "the graph called no
 * tools" and "this provider does not report tool calls" are different facts, and
 * defaulting the missing one to `[]` would turn the second into the first and
 * make §5.3's comparison silently pass.
 */
export const runRecordSchema = z.object({
  runId: z.string().min(1),
  graphId: z.string().min(1),
  irVersion: z.number().int().positive(),
  status: z.enum(RUN_STATUSES),
  nodeId: z.string().min(1).nullable(),
  startedAt: isoSchema,
  endedAt: isoSchema,
  modelCalls: z.array(modelCallSchema),
  toolCalls: z.array(toolCallSchema),
  documentCalls: z.array(documentCallSchema),
  usage: runUsageSchema,
  error: runErrorSchema.nullable(),
});
export type RunRecord = z.infer<typeof runRecordSchema>;

export type ParseRunRecordResult = { ok: true; record: RunRecord } | { ok: false; error: string };

/**
 * Reads an unknown value as a run record, naming the missing field rather than
 * the type error -- a person looking at a rejected record needs to know which
 * of the thirteen the adapter failed to fill.
 */
export function parseRunRecord(raw: unknown): ParseRunRecordResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "실행 기록: 내용이 객체가 아니다." };
  }
  const parsed = runRecordSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues
      .slice(0, 10)
      .map((issue) => `  ${issue.path.join(".") || "(최상위)"} — ${issue.message}`);
    const more = parsed.error.issues.length > 10 ? `\n  … 외 ${parsed.error.issues.length - 10}건` : "";
    return { ok: false, error: `실행 기록: 형식이 맞지 않는다.\n${lines.join("\n")}${more}` };
  }
  return { ok: true, record: parsed.data };
}

/** How long the run took, from the two timestamps rather than a field a provider may not send. */
export function runDurationMs(record: RunRecord): number {
  return Math.max(0, Date.parse(record.endedAt) - Date.parse(record.startedAt));
}

/** Did this run end in a way worth turning into an evaluation case (§5.4)? */
export function runFailed(record: RunRecord): boolean {
  return record.status !== "success";
}

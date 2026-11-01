import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { projectStudioDir } from "../studio/studioStore.js";

/**
 * 평가 결과 -- what came out of running a version's `evals[]`.
 *
 * Patchbay does not run them. The generated `evals.test.ts` (M4) runs inside the
 * target project, and a model-scored eval is scored by a person (명세 §3.7). So
 * this is an **ingest**, like run records: something else produces the numbers
 * and Patchbay keeps them beside the design they belong to, so v(n) and v(n+1)
 * can be put next to each other.
 */

export const EVALS_FILE_NAME = "evals.json";

/** `skip` is a value: an eval that did not run is not an eval that passed. */
export const EVAL_RESULT_STATUSES = ["pass", "fail", "skip"] as const;
export type EvalResultStatus = (typeof EVAL_RESULT_STATUSES)[number];

export const evalResultSchema = z.object({
  evalId: z.string().min(1),
  kind: z.enum(["deterministic", "model"]),
  status: z.enum(EVAL_RESULT_STATUSES),
  /** 1~5, for a model-scored eval. Omitted for a deterministic one, which is pass or fail. */
  score: z.number().min(1).max(5).optional(),
  note: z.string().optional(),
});
export type EvalResult = z.infer<typeof evalResultSchema>;

export const evalRunSchema = z.object({
  /** Which design these results belong to. Without it they cannot be filed. */
  irVersion: z.number().int().positive(),
  ranAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: "ISO8601 시각이 아니다" }),
  /** Free text -- "고정 응답 어댑터", "사람 채점 2026-09-30". Says how, so a reader can judge the number. */
  how: z.string().default(""),
  results: z.array(evalResultSchema),
});
export type EvalRun = z.infer<typeof evalRunSchema>;

export type ParseEvalRunResult = { ok: true; run: EvalRun } | { ok: false; error: string };

export function parseEvalRun(raw: unknown): ParseEvalRunResult {
  const parsed = evalRunSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues
      .slice(0, 10)
      .map((issue) => `  ${issue.path.join(".") || "(최상위)"} — ${issue.message}`);
    return { ok: false, error: `평가 결과: 형식이 맞지 않는다.\n${lines.join("\n")}` };
  }
  return { ok: true, run: parsed.data };
}

/**
 * The scores one eval run adds up to.
 *
 * Deterministic and model-scored evals are summarized **separately**, never
 * averaged together: one is pass/fail that CI repeats every time, the other is a
 * 1~5 judgment a person made once (명세 §3.7). A single blended number would
 * hide which half moved.
 */
export interface EvalScore {
  total: number;
  /** Deterministic: how many passed out of how many ran. */
  passed: number;
  failed: number;
  skipped: number;
  /** Model-scored: the mean 1~5, and how many carried a score. Null when none did. */
  meanScore: number | null;
  scored: number;
  /** The eval ids this run covered, sorted -- §6.2's「같은 평가 묶음」is compared on this. */
  ids: string[];
}

export function scoreEvalRun(run: EvalRun): EvalScore {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let scoreSum = 0;
  let scored = 0;
  for (const result of run.results) {
    if (result.status === "pass") passed += 1;
    else if (result.status === "fail") failed += 1;
    else skipped += 1;
    if (result.score !== undefined) {
      scoreSum += result.score;
      scored += 1;
    }
  }
  return {
    total: run.results.length,
    passed,
    failed,
    skipped,
    meanScore: scored > 0 ? Number((scoreSum / scored).toFixed(2)) : null,
    scored,
    ids: run.results.map((result) => result.evalId).sort(),
  };
}

export type EvalRunFit =
  | { ok: true; unknown: string[]; missing: string[] }
  | { ok: false; error: string };

/**
 * Whether a run can be filed against the design in force. Results for another
 * version are refused -- filed against the wrong version, a later comparison
 * compares nothing. Ids the design lacks, and evals the run left out, are told
 * but not refused: a partial run is still a run.
 *
 * The CLI's `evals record` and the console's Review screen both go through this.
 */
export function fitEvalRun(ir: { version: number; evals: { id: string }[] } | null | undefined, run: EvalRun): EvalRunFit {
  if (!ir) return { ok: false, error: "승인된 설계가 없다 — 어느 버전의 결과인지 붙일 곳이 없다." };
  if (run.irVersion !== ir.version) {
    return { ok: false, error: `결과는 v${run.irVersion} 인데 승인된 설계는 v${ir.version} 다 — 다른 버전의 결과를 현재 버전에 붙이지 않는다.` };
  }
  const known = new Set(ir.evals.map((entry) => entry.id));
  const ran = new Set(run.results.map((result) => result.evalId));
  return {
    ok: true,
    unknown: [...ran].filter((id) => !known.has(id)),
    missing: [...known].filter((id) => !ran.has(id)),
  };
}

export function currentEvalsPath(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), EVALS_FILE_NAME);
}

export async function writeEvalRun(studioHome: string, alias: string, run: EvalRun): Promise<string> {
  const file = currentEvalsPath(studioHome, alias);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  return file;
}

export type ReadEvalRunResult =
  | { ok: true; run: EvalRun; file: string }
  | { ok: false; error: string; file: string; missing: boolean };

export async function readEvalRunFile(file: string): Promise<ReadEvalRunResult> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      ok: false,
      file,
      missing: code === "ENOENT",
      error: code === "ENOENT" ? `${file} 가 없다.` : `${file} 를 읽지 못했다 — ${(error as Error).message}`,
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, file, missing: false, error: `${file} 의 JSON이 깨졌다 — ${(error as Error).message}` };
  }
  const parsed = parseEvalRun(raw);
  return parsed.ok ? { ok: true, run: parsed.run, file } : { ok: false, file, missing: false, error: parsed.error };
}

export function readCurrentEvalRun(studioHome: string, alias: string): Promise<ReadEvalRunResult> {
  return readEvalRunFile(currentEvalsPath(studioHome, alias));
}

import type { EvalEvidence, EvalRun, EvalScore } from "@patchbay/core";

/** `GET /api/evals` — Review 화면이 채점할 평가 목록과 지금 붙어 있는 결과. */
export type EvalsReviewResponse =
  | { status: "no-design"; alias: string }
  | {
      status: "ok";
      alias: string;
      irVersion: number;
      evals: { id: string; node: string; kind: "deterministic" | "model"; input: string; expect: string; requirements: { id: string; summary: string }[]; evidence: EvalEvidence | null }[];
      current: { run: EvalRun; score: EvalScore } | null;
    };

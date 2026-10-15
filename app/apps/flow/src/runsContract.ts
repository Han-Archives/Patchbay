/** Client-safe 5단계 테스트 view types. The shapes themselves live in Core. */

import type {
  BudgetReport,
  EvalScore,
  RunCompareResult,
  CompareVersionsResult,
} from "@patchbay/core";

export type {
  BudgetBreach,
  BudgetReport,
  CompareVersionsResult,
  EvalScore,
  RunCompareResult,
  RunFinding,
  RunFindingKind,
  RunLane,
  RunStatus,
} from "@patchbay/core";

export interface RunsVersionView {
  version: number;
  models: string[];
  score: EvalScore | null;
  notes: string[];
}

export interface RunsViewOk {
  status: "ok";
  alias: string;
  irVersion: number;
  compare: RunCompareResult;
  budget: BudgetReport;
  /** 5.4 — how many evaluation cases the failures would make. Drafting is a separate, explicit act. */
  /** `inDraft` — 그중 이미 `ir.proposed.yaml` 에 들어간 id. 다 들어갔으면 버튼이 「1 설계에서 검토」로 바뀐다. */
  drafts: { count: number; ids: string[]; unfilled: string[]; skipped: number; inDraft: string[] };
  versions: RunsVersionView[];
  /** v(n)↔v(n+1). Null with fewer than two versions. */
  pair: CompareVersionsResult | null;
  rejected: Array<{ file: string; error: string }>;
}

/** 설계가 없으면 대조할 기준이 없다 — 기능 없음이 아니라 아직 1단계다. */
export interface RunsViewNoDesign {
  status: "no-design";
  alias: string;
  collected: number;
  rejected: number;
}

export type RunsViewResponse = RunsViewOk | RunsViewNoDesign;

export function isRunsViewOk(body: RunsViewResponse): body is RunsViewOk {
  return body.status === "ok";
}

/** Shown next to each finding so the reader does not have to learn the slugs. */
export const RUN_FINDING_MEANS: Record<string, string> = {
  "node-not-in-design": "설계에 없는 노드가 돌았다",
  "model-not-declared": "선언되지 않은 모델을 불렀다",
  "model-node-not-declared": "선언되지 않은 노드에서 모델을 불렀다",
  "tool-not-declared": "선언되지 않은 툴을 불렀다",
  "cap-not-declared": "위임하지 않은 권한으로 돌았다",
  "document-not-declared": "선언되지 않은 문서를 읽었다",
  "document-node-mismatch": "다른 노드의 문서를 읽었다",
  "timeout-before-limit": "선언한 한도보다 먼저 끊겼다",
  "node-never-ran": "설계에만 있고 한 번도 안 돌았다",
};

/** `POST /api/runs/draft-evals` 의 답. */
export type DraftEvalsResponse =
  | { added: string[]; startedFrom: "draft" | "approved"; unlinked: string[] }
  | { error: string };

export function draftEvalsNote(body: DraftEvalsResponse): string {
  if ("error" in body) return body.error;
  const from = body.startedFrom === "approved" ? "승인본에서 초안을 새로 시작했다" : "있던 초안에 덧붙였다";
  const fill = body.unlinked.length > 0 ? ` · 추적 표의 요구사항 칸은 사람이 채운다(${body.unlinked.join(" · ")})` : "";
  return `초안에 ${body.added.join(" · ")} 를 넣었다 — ${from}${fill}. 승인된 설계는 그대로다.`;
}

/** 버튼이 할 일: 넣을 것이 남았나, 다 들어갔나. */
export function draftEvalsAction(drafts: RunsViewOk["drafts"]): "none" | "write" | "review" {
  if (drafts.count === 0) return "none";
  return drafts.ids.every((id) => drafts.inDraft.includes(id)) ? "review" : "write";
}

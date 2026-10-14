import type { IrCheckSummary } from "./checks.js";
import { invalidatedGates } from "./invalidation.js";

/**
 * 1단계의 열 칸 (기획서 20260928a §2). The DRC reports check ids; a person
 * works in cells, so this maps one onto the other.
 *
 * 1.9 is not a cell of its own content -- it *is* the machine check, so its
 * status is the run's verdict.
 */

export const IR_GATE_CELLS = [
  { id: "0.0", label: "다루는 것들 (온톨로지)", fixes: "concepts · relations · rules" },
  { id: "1.0", label: "에이전트가 필요한가", fixes: "why" },
  { id: "1.1", label: "목적과 완료 조건", fixes: "goal · done" },
  { id: "1.2", label: "권한 경계", fixes: "caps · tools · models" },
  { id: "1.3", label: "정보 경계", fixes: "reads · emits" },
  { id: "1.4", label: "함께 쓰는 값 (State)", fixes: "state" },
  { id: "1.5", label: "단계와 연결", fixes: "nodes · edges" },
  { id: "1.6", label: "문서 의존", fixes: "documents" },
  { id: "1.7", label: "요구사항 문장", fixes: "requirements" },
  { id: "1.8", label: "평가와 추적 표", fixes: "evals · requirementLinks" },
  { id: "1.9", label: "설계 규칙 검사", fixes: "위 칸들" },
] as const;

export type IrGateCellId = (typeof IR_GATE_CELLS)[number]["id"];

/**
 * `pass` 통과 · `fail` 이 칸이 깨졌다 · `invalid` 다른 칸이 깨져서 같이 무효 ·
 * `unknown` 판정하지 않았다 (건너뛴 검사뿐인 칸).
 */
export type IrGateStatus = "pass" | "fail" | "invalid" | "unknown";

export interface IrGateCellView {
  id: string;
  label: string;
  fixes: string;
  status: IrGateStatus;
  /** Check ids that failed *in this cell*. Empty when the cell went stale because of another. */
  failed: string[];
  skipped: string[];
}

/**
 * The ten cells with a status each. A cell that another cell invalidated is
 * shown apart from one that actually failed: they need different actions --
 * fix this, versus re-confirm this once the other is fixed.
 */
export function gateCells(summary: IrCheckSummary): IrGateCellView[] {
  const failedByGate = new Map<string, string[]>();
  const skippedByGate = new Map<string, string[]>();
  for (const check of summary.checks) {
    if (check.ok === false) failedByGate.set(check.gate, [...(failedByGate.get(check.gate) ?? []), check.id]);
    if (check.ok === null) skippedByGate.set(check.gate, [...(skippedByGate.get(check.gate) ?? []), check.id]);
  }
  const invalid = new Set(invalidatedGates(summary.failedGates));

  return IR_GATE_CELLS.map((cell) => {
    const failed = failedByGate.get(cell.id) ?? [];
    const skipped = skippedByGate.get(cell.id) ?? [];
    let status: IrGateStatus;
    if (cell.id === "1.9") {
      // 1.9는 내용이 아니라 검사 그 자체다.
      status = summary.passed ? "pass" : "fail";
    } else if (failed.length > 0) {
      status = "fail";
    } else if (invalid.has(cell.id)) {
      status = "invalid";
    } else if (skipped.length > 0 && !summary.checks.some((check) => check.gate === cell.id && check.ok === true)) {
      // 건너뛴 것뿐이면 통과가 아니다 — 아무도 보지 않았다는 뜻이다.
      status = "unknown";
    } else {
      status = "pass";
    }
    return { id: cell.id, label: cell.label, fixes: cell.fixes, status, failed, skipped };
  });
}

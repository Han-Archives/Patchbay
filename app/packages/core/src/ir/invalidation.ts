/**
 * 무효 전파 -- 명세 20260929a §7.3.
 *
 * A harness DRC does not send you back to the start; it names the net that is
 * wrong. Same here. Forcing a person to re-confirm every passed cell means
 * that after a few rounds they skip the gate entirely, and a rule nobody can
 * keep is the same as no rule.
 *
 * What *also* goes stale is a separate question from what failed, and the
 * traceability table (`requirementLinks[]`) is what can answer it.
 */

export const IR_GATES = ["0.0", "1.0", "1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"] as const;
export type IrGate = (typeof IR_GATES)[number];

/** Failed gate -> the gates whose earlier pass no longer means anything. */
const INVALIDATES: Record<string, readonly string[]> = {
  // 권한이 만들 수 있는 노드를 제약한다.
  "1.2": ["1.5", "1.6"],
  // 문장이 바뀌면 평가도 바뀐다.
  "1.7": ["1.8"],
  // 넷리스트가 흔들리면 노드와 평가가 다 흔들린다.
  "1.4": ["1.5", "1.8"],
  // 문서 의존이 바뀌면 평가와 3·4단계가 흔들린다.
  "1.6": ["1.8"],
  // 바닥(온톨로지)이 흔들리면 그 낱말을 고른 칸이 전부 무효다.
  "0.0": [...IR_GATES],
  // 목적이 바뀌면 전부 무효다.
  "1.0": [...IR_GATES],
  "1.1": [...IR_GATES],
  // 1.3·1.5·1.8은 자기 칸만 무효다.
};

/** Gates invalidated by one failed gate. Empty when it only voids itself. */
export function invalidatedBy(gate: string): string[] {
  return [...(INVALIDATES[gate] ?? [])];
}

/**
 * Gates voided by a whole failing run, with the failed gates themselves removed
 * -- those are already reported as failures and repeating them as "also void"
 * reads as twice as much breakage as there is.
 */
export function invalidatedGates(failedGates: readonly string[]): string[] {
  const failed = new Set(failedGates);
  const out = new Set<string>();
  for (const gate of failedGates) for (const other of invalidatedBy(gate)) if (!failed.has(other)) out.add(other);
  return [...out].sort();
}

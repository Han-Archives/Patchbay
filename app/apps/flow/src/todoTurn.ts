import type { RoomMessage, TodoPreparation } from "@patchbay/core";

/**
 * 할일이 지금 사람 차례인지와 그 이유. 콘솔 Tasks가 이 행만 다른 색으로 깜빡여 「무엇을 해야 하나」를 보인다.
 * LLM이 일하는 중이면 사람 차례가 아니다 (사용자 요청 2026-10-29).
 */
export function todoTurn(running: boolean, preparation: TodoPreparation["status"] | undefined, last: RoomMessage | undefined): string | undefined {
  if (running) return undefined;
  if (preparation === "ready") return "준비본 검토";
  if (preparation === "stale") return "준비본 재검토";
  if (preparation === "failed") return "준비 실패 확인";
  if (!last) return undefined;
  if (last.role === "speaker") return "답 확인";
  if (last.role === "system" && (last.kind === "error" || last.kind === "timeout")) return "오류 확인";
  if (last.role === "operation" && last.status === "waiting") return "실행 승인";
  if (last.role === "operation" && last.status === "failed") return "실행 실패 확인";
  return undefined;
}

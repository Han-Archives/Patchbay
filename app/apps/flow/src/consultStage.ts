import type { ConsultProgress } from "@patchbay/core";

/**
 * 상담 과정 넘기기 (사용자 요청 2026-10-19) — 한 상담이 길어지면 매 턴 싣는 대화가 늘어 토큰이 는다.
 * 이 상담을 여는 때 이미 끝난 주제를 기억해 두고, 이 상담 안에서 주제가 새로 끝나면
 * 「다음 과정으로」를 낸다. 누르면 지금 대화는 보관하고 새 상담에서 다음 주제부터 잇는다 — 정한 것은 초안에 있다.
 */
export interface StageHandoff {
  done: string;
  next: string;
}

/** 이 상담에서 새로 끝난 주제와 이어 갈 주제. 넘길 것이 없거나 모두 끝났으면(PRD 확인 차례) null. */
export function stageHandoff(startDone: readonly string[] | null, progress: ConsultProgress | undefined): StageHandoff | null {
  if (!startDone || !progress?.next) return null;
  const fresh = progress.topics.filter((t) => t.done && !startDone.includes(t.name));
  if (!fresh.length) return null;
  return { done: fresh[fresh.length - 1]!.name, next: progress.next };
}

export function doneTopics(progress: ConsultProgress | undefined): string[] {
  return (progress?.topics ?? []).filter((t) => t.done).map((t) => t.name);
}

/** 새 상담의 첫 말 — 지난 대화는 싣지 않고, 초안에서 이어 간다. */
export function handoffText(h: StageHandoff): string {
  return `「${h.done}」 과정을 마쳤어. 지난 대화는 보관했으니 정한 것은 get_prd 로 보고, 「${h.next}」 과정부터 이어서 물어 줘.`;
}

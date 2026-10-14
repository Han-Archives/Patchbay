import { appendDecision, newDecision, readStudio, type Decision } from "@patchbay/core";

export type AddDecisionResult =
  | { ok: true; body: { decision: Decision; count: number } }
  | { ok: false; status: 400 | 404; error: string };

/**
 * `patchbay decision add` 와 같은 일. 구조 화면 결정 칸의 「결정 남기기」가 부른다.
 * 쓰기는 Core `appendDecision` 하나이고, 기본값(id · concept · 날짜)도 CLI 와 같은 `newDecision` 이다.
 */
export async function addDecisionView(
  studioHome: string,
  payload: { alias?: string; summary?: string; rationale?: string },
): Promise<AddDecisionResult> {
  const alias = payload.alias?.trim() ?? "";
  const summary = payload.summary?.trim() ?? "";
  if (!alias) return { ok: false, status: 400, error: "이름이 없다." };
  if (!summary) return { ok: false, status: 400, error: "무엇을 정했는지 한 줄을 적는다." };

  const studio = await readStudio(studioHome);
  if (!studio.projects.some((project) => project.alias === alias)) {
    return { ok: false, status: 404, error: `등록된 프로젝트가 아니다: ${alias}` };
  }
  const decision = newDecision(alias, { summary, rationale: payload.rationale });
  const overlay = await appendDecision(studioHome, alias, decision);
  return { ok: true, body: { decision, count: overlay.decisions.length } };
}

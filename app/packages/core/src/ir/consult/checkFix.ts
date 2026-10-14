import type { IrCheckResult } from "../checks.js";

/**
 * 설계 규칙 검사가 막는 곳을 사람 말로, 그리고 상담자에게 넘길 말로 (사용자 요청 2026-10-07 — 「검사 맞추기」).
 * 형식 맞추기(`formatProblems`)와 짝이다: 형식은 읽히는가, 검사는 설계가 맞물리는가.
 */
const CHECK_WORD: Record<string, { what: string; how: string }> = {
  "0.0/cq-answerable": { what: "답해야 하는 질문에 맞는 관계가 없다", how: "질문의 from → to 사이에 relations 한 줄씩 더한다 (없는 개념이면 concepts 에도)" },
  "0.0/input-output": { what: "받는 것 · 내놓는 것 개념이 없다", how: "concepts 에 kind input · output 을 하나씩" },
  "1.0/verdict": { what: "AI가 필요한 이유의 결론이 비었다", how: "why.verdict 한 문장" },
  "1.1/done-judgeable": { what: "완료 조건이 없다", how: "done 에 판정할 수 있는 문장" },
  "1.1/metric-target": { what: "성공 지표에 목표치가 없다", how: "metrics[].target" },
  "1.2/tool-caps": { what: "도구의 권한이 선언된 권한 밖이다", how: "tools[].caps 를 caps 에 있는 것으로" },
  "1.2/model-declared": { what: "모델이 필요하다면서 모델이 없다", how: "models 한 줄" },
  "1.2/irreversible-approval": { what: "되돌릴 수 없는 도구에 사람 확인이 없다", how: "그 권한의 humanApproval: true" },
  "1.2/oversight": { what: "피해가 큰데 끝까지 스스로 한다", how: "autonomy 를 suggest · approve 로, 또는 riskLevel 을 다시" },
  "1.2/model-used": { what: "어느 단계도 부르지 않는 모델이 있다", how: "그 모델을 부르는 nodes[].models 를 채우거나 models 에서 뺀다" },
  "1.2/env-language": { what: "2 구현이 낼 수 없는 언어다", how: "environment.language: typescript" },
  "1.3/external-cap": { what: "밖으로 보내는데 외부 권한이 없다", how: "caps 에 cap:external" },
  "1.3/external-credential": { what: "밖으로 나가는 도구가 있는데 열쇠 자리가 없다", how: "credentials 한 줄 (값 말고 둔 곳)" },
  "1.4/reducer-default": { what: "들고 다닐 값에 합치는 법이나 처음 값이 없다", how: "state[].reducer · default" },
  "1.4/input-field": { what: "받는 것을 담는 값이 없다", how: "kind: input 개념을 가리키는 state 칸 하나 (concept 에 그 개념)" },
  "1.5/node-reads": { what: "아무 값도 읽지 않는 단계가 있다", how: "그 단계의 nodes[].reads 를 앞 단계가 쓰는 값 · 받는 값으로" },
  "1.5/known-fields": { what: "단계가 없는 값을 읽거나 쓴다", how: "nodes[].reads · writes 를 state 에 있는 이름으로" },
  "1.5/no-orphan-field": { what: "아무도 안 쓰는 값이 있다", how: "그 값을 쓰는 단계를 잇거나 state 에서 뺀다" },
  "1.5/reachable": { what: "시작에서 닿지 않는 단계가 있다", how: "edges 를 __start__ 에서 이어지게" },
  "1.5/can-end": { what: "끝으로 못 가는 단계가 있다", how: "edges 가 __end__ 에 닿게" },
  "1.6/doc-exists": { what: "없는 문서를 가리킨다", how: "documents[].path 를 실제 파일로" },
  "1.6/doc-coverage": { what: "후보 문서 중 쓰는 것이 절반도 안 된다", how: "documents 에 고르는 기준을 더한다" },
  "1.7/unwanted": { what: "「잘못되면」 약속이 없다", how: "pattern unwanted 요구사항 한 줄" },
  "1.7/no-vague-terms": { what: "잴 수 없는 말(빠르게 · 최대한 · 적절히 · 등)이 있다", how: "그 말을 숫자나 기준으로 바꾼다 — 뜻은 사람에게 확인" },
  "1.7/quality-fit": { what: "품질 요구사항에 기준이 없다", how: "requirements[].fit" },
  "1.8/rtm-complete": { what: "시험에 안 이어진 약속이 있다", how: "requirementLinks 에 요구사항 · 단계 · 시험 한 줄씩" },
  "1.8/link-integrity": { what: "추적 표가 없는 id를 가리킨다", how: "requirementLinks 를 있는 id로" },
  "1.8/eval-scoring": { what: "모델이 판단하는 시험에 채점 기준이 없다", how: "evals[kind=model].scoring 한 줄씩" },
};

export interface CheckProblem {
  id: string;
  what: string;
  how: string;
  note: string;
}

export function checkProblems(results: readonly IrCheckResult[]): CheckProblem[] {
  return results
    .filter((r) => r.ok === false)
    .map((r) => ({ id: r.id, what: CHECK_WORD[r.id]?.what ?? r.id, how: CHECK_WORD[r.id]?.how ?? "", note: r.note }));
}

export function checkFixRequest(problems: readonly CheckProblem[]): string {
  return [
    "설계 규칙 검사가 막는다. 아래를 고쳐 줘 — 이미 정한 내용으로 해석할 수 있는 것은 채우고, 사람만 아는 것(잴 수 없는 말의 기준 같은)은 짧게 물어봐.",
    "consult_update 는 한 번에 한두 칸씩. 끝나면 get_prd 로 확인해.",
    ...problems.map((p) => `- ${p.id}: ${p.what}${p.note ? ` (${p.note})` : ""} → ${p.how}`),
  ].join("\n");
}

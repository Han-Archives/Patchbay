import { irSchema } from "../../types/ir.js";

/**
 * 초안이 설계(IR) 형식으로 안 읽히는 곳을 칸별로 모은다 (사용자 질문 2026-10-07 — 「IR로 안 읽힌다는데 뭐가 부족해?」).
 * 화면은 이 목록을 보이고, 「형식 맞추기」가 같은 목록을 상담자에게 넘긴다. 결정적이다.
 */
export interface FormatProblem {
  /** `relations.kind` 처럼 — 몇 번째 줄인지는 묶는다. */
  field: string;
  count: number;
  /** 정해진 값이 있으면 그 목록. */
  allowed: string[];
  message: string;
}

const FIELD_WORD: Record<string, string> = {
  "evals.kind": "시험 종류",
  "caps.id": "권한",
  "tools.caps": "도구 권한",
  "tools.via": "도구 출처",
  "nodes.writes": "단계가 채우는 값",
  "nodes.reads": "단계가 읽는 값",
  state: "들고 다닐 값",
  models: "모델",
  "relations.kind": "관계 뜻",
  "relations.cardinality": "관계 개수",
  competencyQuestions: "답해야 하는 질문",
  references: "참고 자료",
  riskLevel: "틀리면 피해",
  autonomy: "스스로 하는 정도",
  memory: "기억",
  "environment.location": "도는 곳",
  "interface.entry": "부르는 곳",
  "credentials.storedAt": "열쇠 둔 곳",
  "emits.to": "내보내는 곳",
  "requirements.pattern": "요구사항 모양",
  "requirements.priority": "우선순위",
};

export function fieldWord(field: string): string {
  return FIELD_WORD[field] ?? field;
}

function koreanMessage(message: string): string {
  if (/expected array, received string/.test(message)) return "목록이어야 하는데 글 한 줄이 있다";
  if (/expected object, received string/.test(message)) return "칸이 있는 항목이어야 하는데 글만 있다";
  if (/expected string, received undefined|Required/.test(message)) return "꼭 있어야 하는 칸이 비었다";
  if (/Invalid option/.test(message)) return "정해진 값이 아니다";
  return message;
}

export function draftFormatProblems(draft: unknown): FormatProblem[] {
  const parsed = irSchema.safeParse(draft ?? {});
  if (parsed.success) return [];
  const groups = new Map<string, FormatProblem>();
  for (const issue of parsed.error.issues) {
    const field = issue.path.filter((p): p is string => typeof p === "string").join(".") || "(최상위)";
    const allowed = "values" in issue && Array.isArray((issue as { values?: unknown[] }).values)
      ? ((issue as { values: unknown[] }).values.map(String))
      : [];
    const current = groups.get(field);
    if (current) current.count += 1;
    else groups.set(field, { field, count: 1, allowed, message: koreanMessage(issue.message) });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** 상담자에게 넘기는 「형식 맞추기」 말. */
export function formatFixRequest(problems: readonly FormatProblem[]): string {
  const lines = problems.map(
    (p) => `- ${p.field} (${fieldWord(p.field)}) ${p.count}곳${p.allowed.length ? ` — 쓸 수 있는 값: ${p.allowed.join(" | ")}` : ` — ${p.message}`}`,
  );
  return [
    "초안이 설계 형식으로 안 읽힌다. 아래 칸을 계약 형식으로 고쳐 줘 — 뜻은 바꾸지 말고, 목록 자리는 목록으로, 항목 자리는 칸이 있는 객체로.",
    "consult_update 는 한 번에 한두 칸씩. 고친 뒤 get_prd 로 다시 확인해.",
    ...lines,
  ].join("\n");
}

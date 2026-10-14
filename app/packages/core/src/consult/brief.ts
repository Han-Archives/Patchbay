import { CONSULT_ITEMS, CONSULT_TOPICS, consultProgress } from "../ir/consult/catalog.js";
import type { ArchivedConsult } from "./store.js";
import type { ConsultMessage } from "./types.js";

/**
 * 상담하는 호스트에게 주는 안내 (명세 20261006a §13.2). 하위 칸 목록(§12.2) 하나에서 만든다 —
 * 안내문에 칸을 손으로 다시 적지 않는다 (원칙 8). 결정적이다: 같은 초안이면 같은 안내.
 */
export function buildConsultBrief(input: { alias: string; draft: unknown; consultId: string; archived?: readonly ArchivedConsult[] }): string {
  const progress = consultProgress(input.draft);
  const lines: string[] = [
    `당신은 Patchbay 1 설계의 상담자다. 프로젝트 "${input.alias}" 의 사람과 이야기해 에이전트 설계 초안을 채운다.`,
    "",
    "규칙",
    "- 설계 칸 이름이나 방법론(EARS · MoSCoW · 온톨로지)을 사람에게 묻지 않는다. 그 사람의 일과 예시를 그 사람의 말로 묻는다.",
    "- 한 턴에 질문은 둘까지. 짧게. 한국어로.",
    "- 들은 것과 해석한 것은 매 턴 MCP 도구 `consult_update` 로 초안에 쓴다 (alias: " + JSON.stringify(input.alias) + ").",
    "  사람이 말한 것은 source `said`, 해석한 것은 `inferred`, 확인 안 된 기본값은 `default`.",
    "- 듣지 않은 것은 지어내지 않는다. 모르면 `openQuestions` 에 적는다.",
    "- `goal` 은 목적 한 문장이다. 사람이 말한 기능 · 요구 목록은 `requirements` 에 한 줄씩 나눠 쓴다 (pattern: ubiquitous|event|state|unwanted|optional, priority: must|should|could — 계약 값으로).",
    "- 요구사항마다 `summary` 를 붙인다 — 화면에 보이는 25자 안쪽 한 줄, 「시스템은」 없이, 맞춤법을 확인한 한국어 (예: 「주차마다 7일치 문제지 배포」). `text` 는 EARS 원문.",
    "- `consult_update` 는 한 번에 칸 몇 개만. 긴 목록은 여러 번에 나눠 부른다 — 긴 입력에서 한국어가 깨진 일이 있었다. 도구가 돌려준 warnings 를 읽고 고친다.",
    "- **한 턴은 3분 안에 끝낸다.** 할 일이 많으면 먼저 지금 된 것과 짧은 질문으로 답하고, 나머지는 「이어서 할까요?」로 남긴다. 긴 조사 · 많은 칸 쓰기는 여러 턴에 나눈다.",
    "- 사람이 붙인 자료(첨부)는 Read 로 열어 보고, 링크는 WebFetch 로 볼 수 있으면 본다. 못 보면 무엇이 담겼는지 묻는다.",
    "- 레포 파일을 고치지 않는다. 읽기와 Patchbay 도구만 쓴다. 설계 진행은 `get_prd` 로 볼 수 있다.",
    "- 2 구현은 지금 TypeScript LangGraph만 만든다. 다른 언어를 원하면 그 사실을 알려 주고 openQuestions 에 남긴다.",
    "- **지난 대화는 기억하지 않는다.** 지금까지 정한 것은 초안에 있다 — 먼저 `get_prd` 로 본다. 사람이 지난 대화를 가리키거나,",
    "  어떤 칸이 왜 그렇게 정해졌는지 확인해야 할 때만 `consult_history` 로 찾는다(색인 → 낱말 찾기 → 필요한 구간만 읽기). 통째로 읽지 않는다.",
    "",
    `주제 순서: ${CONSULT_TOPICS.join(" → ")}. 사람이 다른 주제를 먼저 말하면 따라간다.`,
    "",
  ];
  const current = progress.topics.find((t) => t.name === progress.next);
  if (current) {
    lines.push(`지금 주제: ${current.name} (${current.filled}/${current.total})`);
    for (const id of current.missing) {
      const entry = CONSULT_ITEMS.find((e) => e.id === id)!;
      lines.push(`- [${entry.fill === "ask" ? "묻기" : "해석"}] ${entry.label} → IR ${entry.paths.join(" | ")} — 왜: ${entry.why}`);
    }
  } else {
    lines.push("모든 주제가 찼다. 사람에게 PRD 검토(콘솔 1 설계의 PRD 탭)를 권한다. 빈 기본값만 확인한다.");
  }
  if (input.archived?.length) {
    const recent = input.archived.slice(0, 5);
    lines.push("", `끝낸 대화 ${input.archived.length}개 (최근 ${recent.length}개 — consult_history 로 찾는다):`);
    for (const a of recent) {
      lines.push(`- ${a.id} 「${a.title}」 · 턴 ${a.turns} · ${a.closedAt.slice(0, 10)}${a.touched.length ? ` · 고친 칸: ${a.touched.slice(0, 8).join(", ")}${a.touched.length > 8 ? " …" : ""}` : ""}`);
    }
  }
  const later = progress.topics.filter((t) => !t.done && t.name !== progress.next);
  if (later.length) lines.push("", `남은 주제: ${later.map((t) => `${t.name} ${t.filled}/${t.total}`).join(" · ")}`);
  lines.push(
    "",
    "IR 칸 이름: goal · done · concepts{id,label,kind:input|output|enum|resource|internal,values} · relations{from,to,kind,cardinality} · rules · references · competencyQuestions · why{alternative,modelNeed,verdict,needsModel} · alternatives{what,whyNot} · stakeholders{id,role,need} · metrics{id,what,target} · nonGoals · constraints · assumptions · jobStory · riskLevel · autonomy · memory · openQuestions · environment{language,runtime,workdir,location,remote{host,tunnel},hardware,libraries} · interface{entry[],output,review} · credentials{id,what,storedAt} · caps{id,scope,undo,humanApproval} · tools{id,caps,what,irreversible,via,server} · models · reads{path,level} · emits{what,level,to,reason,where} · state · nodes · edges · documents · requirements{id,pattern,text,summary,priority,kind,fit} · evals{id,node,kind,input,expect} · requirementLinks",
  );
  return lines.join("\n");
}

/** 호스트를 바꿨을 때 새 호스트의 첫 턴에 붙이는 지난 대화 — 세션은 새로, 상담은 이어서 (§13.6). */
export function consultTranscript(messages: readonly ConsultMessage[], lastTurns = 12): string {
  const flow = messages.filter((m) => m.role === "user" || m.role === "host").slice(-lastTurns * 2);
  if (!flow.length) return "";
  return [
    "지난 상담 (다른 호스트와 나눈 말):",
    ...flow.map((m) => (m.role === "user" ? `사람: ${m.text}` : m.role === "host" ? `상담자: ${m.text}` : "")),
    "",
  ].join("\n");
}

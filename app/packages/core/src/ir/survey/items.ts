/**
 * 설계 설문 — 문항 은행 (사용자 결정 2026-10-05: 설계는 서술이 아니라 묻고 고르며 구체화한다).
 *
 * 사회조사 · 임상 구조화 면접(SCID) · 세무 인터뷰 · 아키텍처 점검표의 방식을 따른다.
 * - 한 화면에 질문 하나, 대부분 폐쇄형(하나 · 여럿 · 표 · 확인)
 * - 앞 답에 따라 해당 없는 문항은 건너뛴다 (`showIf`)
 * - 선택지 일부는 앞 답에서 만든다 (`dynamic`) — 0층 온톨로지의 낱말을 뒤 문항이 고른다
 * - 직접 쓰는 것은 짧은 말뿐이고 기본값이 채워져 있다
 *
 * 문항은 **데이터**다. 화면은 그리기만 하고(원칙 8), 답 → 설계도 변환은 `compile.ts`가 결정적으로 한다
 * (원칙 5 — 모델 없음).
 */

export type SurveyItemKind =
  | "single" // 하나 고르기
  | "multi" // 여럿 고르기
  | "chips" // 짧은 낱말 여러 개
  | "text" // 짧은 말 한 줄
  | "matrix" // 줄마다 하나 고르기 (값: { 줄: 열 })
  | "slots" // 줄마다 짧은 말 (값: { 줄: 말 })
  | "confirm" // 만들어진 후보 중 남길 것 체크 (값: 남긴 후보의 key[])
  | "pick" // 목록(스캔 결과 등)에서 여럿 고르기
  | "refs"; // 참고 자료 붙이기 — 링크 · 파일 · 이미지 (값: 남긴 자료 id[])

export interface SurveyOption {
  value: string;
  label: string;
  hint?: string;
}

/** 모든 조건이 참일 때만 보인다. */
export interface SurveyCondition {
  item: string;
  /** 여럿 고르기 답에 이 값이 들어 있다. */
  includes?: string;
  /** 하나 고르기 답이 이 값이다. */
  equals?: string;
  /** 하나 고르기 답이 이 값이 아니다. */
  notEquals?: string;
  /** 계산된 사실 — `needsModel` 처럼 여러 답에서 나오는 것. */
  fact?: "needsModel";
  /** 여럿 고르기 답에 이 값들 중 하나라도 있다. */
  includesAny?: string[];
  /** 하나 고르기 답이 이 값들 중 어느 것도 아니다. */
  notIn?: string[];
}

export interface SurveyItemDef {
  id: string;
  /** 어느 칸을 채우나. 0.0 이 맨 아래 층이다. */
  cell: string;
  ask: string;
  help?: string;
  kind: SurveyItemKind;
  options?: SurveyOption[];
  /** matrix 의 열. */
  columns?: SurveyOption[];
  /** 선택지 · 줄 · 후보를 앞 답에서 만든다 — `view.ts` 의 이름표. */
  dynamic?:
    | "ruleable-rows"
    | "relation-rows"
    | "rule-candidates"
    | "done-candidates"
    | "folders"
    | "doc-rows"
    | "requirement-candidates"
    | "priority-rows"
    | "nongoal-candidates"
    | "assumption-candidates"
    | "target-rows"
    | "cq-candidates"
    | "sample-rows";
  showIf?: SurveyCondition[];
  placeholder?: string;
}

/** 내놓는 것 — 0층의 개념과 뒤의 단계 뼈대가 여기서 나온다. */
export const SURVEY_OUTPUTS: SurveyOption[] = [
  { value: "classify", label: "갈래 나누기", hint: "버그 · 요청 · 질문처럼 정해진 값 중 하나" },
  { value: "reason", label: "짧은 이유 · 설명", hint: "왜 그렇게 판단했는지 한두 문장" },
  { value: "summary", label: "요약", hint: "긴 것을 짧게" },
  { value: "recommend", label: "문서 · 자료 추천", hint: "미리 있는 파일 중 하나를 고른다" },
  { value: "edit", label: "파일 고치기", hint: "레포의 파일을 바꾼다" },
  { value: "send", label: "밖으로 보내기", hint: "메일 · 메시지 · 외부 API" },
];

const CARDINALITY_COLUMNS: SurveyOption[] = [
  { value: "one", label: "정확히 하나" },
  { value: "optional", label: "없거나 하나" },
  { value: "many", label: "여럿" },
];

const FALLBACK_OPTIONS: SurveyOption[] = [
  { value: "skip", label: "그 결과만 비우고 나머지는 계속", hint: "다른 결과는 그대로 준다" },
  { value: "human", label: "멈추고 사람에게 넘긴다" },
  { value: "retry", label: "한 번 다시 묻는다", hint: "그래도 안 되면 위 첫 번째로" },
];

export const SURVEY_ITEMS: SurveyItemDef[] = [
  // ── 0.0 온톨로지 — 다루는 것들 ───────────────────────────────
  {
    id: "o.refs",
    cell: "0.0",
    ask: "먼저, 이 프로젝트와 관련된 자료가 있나요? 링크 · 파일 · 이미지를 붙여 주세요.",
    help: "기존 문서, 화면 시안, 예시 데이터, 비슷한 서비스 링크 — 무엇이든 설계의 근거가 됩니다. 없으면 「없음」으로 넘어갑니다.",
    kind: "refs",
  },
  {
    id: "o.input",
    cell: "0.0",
    ask: "이 에이전트는 무엇을 받나요? 한 낱말로 적어 주세요.",
    help: "사람이 넣는 것 하나. 이 낱말이 뒤의 모든 질문에 쓰입니다.",
    kind: "text",
    placeholder: "예: 메모",
  },
  {
    id: "o.outputs",
    cell: "0.0",
    ask: "무엇을 내놓나요? 해당하는 것을 모두 고르세요.",
    kind: "multi",
    options: SURVEY_OUTPUTS,
  },
  {
    id: "o.categoryName",
    cell: "0.0",
    ask: "나누는 갈래를 한 낱말로 부르면?",
    help: "「정해진 값 중 하나」의 이름입니다.",
    kind: "text",
    placeholder: "예: 갈래",
    showIf: [{ item: "o.outputs", includes: "classify" }],
  },
  {
    id: "o.categories",
    cell: "0.0",
    ask: "갈래 값은 무엇무엇인가요? 둘 이상 적어 주세요.",
    kind: "chips",
    placeholder: "값을 적고 Enter",
    showIf: [{ item: "o.outputs", includes: "classify" }],
  },
  {
    id: "o.relations",
    cell: "0.0",
    ask: "이것들은 몇 개씩 이어지나요?",
    help: "줄마다 하나를 고르세요. 이 답이 뒤에서 규칙과 시험이 됩니다.",
    kind: "matrix",
    columns: CARDINALITY_COLUMNS,
    dynamic: "relation-rows",
  },
  {
    id: "o.rules",
    cell: "0.0",
    ask: "이 규칙들은 늘 지켜져야 하나요? 남길 것만 체크하세요.",
    help: "앞의 답에서 만든 규칙입니다. 체크한 것은 요구사항과 시험으로 이어집니다.",
    kind: "confirm",
    dynamic: "rule-candidates",
  },
  {
    id: "o.cq",
    cell: "0.0",
    ask: "이 에이전트가 답할 수 있어야 하는 질문입니다. 맞는 것을 체크하세요.",
    help: "역량 질문(Ontology Development 101) — 위에서 정한 개념과 관계로 답할 수 있어야 합니다. 답할 길이 없으면 검사가 막습니다.",
    kind: "confirm",
    dynamic: "cq-candidates",
  },

  // ── 1.0 에이전트가 필요한가 ─────────────────────────────────
  {
    id: "n.ruleable",
    cell: "1.0",
    ask: "내놓는 것마다, 규칙이나 표로 정할 수 있나요?",
    help: "「표로 안 됨」이 하나라도 있으면 그 부분만 모델이 맡습니다.",
    kind: "matrix",
    columns: [
      { value: "table", label: "표로 충분" },
      { value: "partly", label: "일부만" },
      { value: "model", label: "표로 안 됨" },
    ],
    dynamic: "ruleable-rows",
  },
  {
    id: "g.alternatives",
    cell: "1.0",
    ask: "이 에이전트 대신 쓸 수 있는 다른 방법도 따져 봤나요? 해당하는 것을 고르세요.",
    help: "설계 문서 · ADR의 「검토한 대안」입니다. 고른 것마다 왜 그것으로 안 되는지가 함께 남습니다.",
    kind: "multi",
    options: [
      { value: "human", label: "사람이 계속 한다" },
      { value: "tool", label: "기존 도구 · 스크립트" },
      { value: "rules", label: "규칙과 표만으로" },
      { value: "service", label: "다른 서비스에 맡긴다" },
      { value: "none", label: "따져 보지 않았다" },
    ],
  },

  // ── 1.1 목적과 완료 조건 ────────────────────────────────────
  {
    id: "g.done",
    cell: "1.1",
    ask: "다 됐다는 것은 어떻게 확인하나요? 맞는 것을 체크하세요.",
    help: "체크한 조건은 맞다 · 틀리다로 판정할 수 있어야 합니다.",
    kind: "confirm",
    dynamic: "done-candidates",
  },

  {
    id: "g.users",
    cell: "1.1",
    ask: "누가 이 에이전트를 쓰나요?",
    help: "요구사항 명세의 「사용자 특성」입니다. 쓰는 사람마다 필요한 것이 다릅니다.",
    kind: "multi",
    options: [
      { value: "me", label: "나 혼자", hint: "만든 사람이 직접 쓴다" },
      { value: "team", label: "팀 동료" },
      { value: "customer", label: "고객 · 외부 사용자" },
      { value: "program", label: "다른 프로그램", hint: "API로 부른다" },
    ],
  },
  {
    id: "g.trigger",
    cell: "1.1",
    ask: "언제 쓰나요?",
    kind: "single",
    options: [
      { value: "manual", label: "필요할 때 직접 넣는다" },
      { value: "schedule", label: "정해진 시간마다 돈다", hint: "매일 아침 등" },
      { value: "event", label: "어떤 일이 생기면 돈다", hint: "알림 · 웹훅 · 새 파일" },
    ],
  },
  {
    id: "g.outcome",
    cell: "1.1",
    ask: "결과를 받은 사람은 그다음에 무엇을 하나요?",
    help: "일의 맥락(Jobs to be Done) — 「언제 · 무엇을 받아서 · 무엇을 할 수 있게」 한 문장이 됩니다.",
    kind: "single",
    options: [
      { value: "act", label: "바로 처리한다" },
      { value: "handoff", label: "맞는 사람에게 넘긴다" },
      { value: "record", label: "기록해 두고 나중에 본다" },
      { value: "decide", label: "그것을 보고 결정을 내린다" },
    ],
  },
  {
    id: "g.current",
    cell: "1.1",
    ask: "지금은 이 일을 어떻게 하고 있나요?",
    help: "지금 방식이 성공 지표의 출발점입니다.",
    kind: "single",
    options: [
      { value: "manual", label: "사람이 손으로 한다" },
      { value: "tool", label: "다른 도구로 한다" },
      { value: "none", label: "안 하고 있다 — 새로 하는 일" },
    ],
  },
  {
    id: "g.impact",
    cell: "1.1",
    ask: "결과가 틀리면 피해는 어느 정도인가요?",
    help: "위험의 크기(NIST AI RMF · EU AI Act). 크면 사람이 확인하는 단계가 꼭 들어가야 합니다.",
    kind: "single",
    options: [
      { value: "low", label: "조금 불편하다", hint: "다시 하면 된다" },
      { value: "medium", label: "시간이나 돈을 잃는다" },
      { value: "high", label: "사람의 건강 · 권리 · 안전에 영향이 간다" },
    ],
  },
  {
    id: "g.metrics",
    cell: "1.1",
    ask: "무엇이 좋아지면 성공인가요?",
    help: "성공 지표(PRD)입니다. 고른 것마다 다음 질문에서 목표치를 정합니다.",
    kind: "multi",
    options: [
      { value: "time", label: "걸리는 시간이 준다" },
      { value: "accuracy", label: "결과가 정확하다" },
      { value: "coverage", label: "빠뜨리는 것이 없다" },
      { value: "cost", label: "비용이 준다" },
    ],
  },
  {
    id: "g.targets",
    cell: "1.1",
    ask: "각 지표의 목표치는 어느 정도인가요?",
    help: "목표치가 있어야 잴 수 있습니다 (Volere의 적합 기준).",
    kind: "matrix",
    columns: [
      { value: "low", label: "지금보다 나아지면" },
      { value: "mid", label: "확실히 (절반 · 90%)" },
      { value: "high", label: "거의 완벽 (10분의 1 · 95%+)" },
    ],
    dynamic: "target-rows",
  },
  {
    id: "g.nonGoals",
    cell: "1.1",
    ask: "이 에이전트가 하지 않는 것을 체크하세요.",
    help: "범위 밖(non-goals)입니다. 적지 않으면 에이전트는 빠진 것에서 범위를 짐작하지 못합니다.",
    kind: "confirm",
    dynamic: "nongoal-candidates",
  },
  {
    id: "g.constraints",
    cell: "1.1",
    ask: "꼭 지켜야 할 제약이 있나요?",
    kind: "multi",
    options: [
      { value: "offline", label: "인터넷 없이 동작한다" },
      { value: "nocost", label: "유료 API를 쓰지 않는다" },
      { value: "folder", label: "정한 폴더 밖은 건드리지 않는다" },
      { value: "korean", label: "결과는 한국어로 쓴다" },
      { value: "none", label: "특별한 제약은 없다" },
    ],
  },
  {
    id: "g.assumptions",
    cell: "1.1",
    ask: "이렇게 가정해도 되나요? 맞는 것을 체크하세요.",
    help: "가정이 틀리면 설계가 무너집니다. 체크하지 않은 것은 설계가 다뤄야 할 경우가 됩니다.",
    kind: "confirm",
    dynamic: "assumption-candidates",
  },

  // ── 1.2 권한 경계 ───────────────────────────────────────────
  {
    id: "p.actions",
    cell: "1.2",
    ask: "이 에이전트에게 무엇까지 맡기나요?",
    kind: "multi",
    options: [
      { value: "read", label: "읽기", hint: "아무것도 바꾸지 않는다" },
      { value: "draft", label: "결과 초안 파일 쓰기", hint: "지우면 되돌아간다" },
      { value: "edit", label: "기존 파일 고치기", hint: "되돌리기 번거롭다" },
      { value: "send", label: "밖으로 보내기", hint: "보낸 것은 회수하지 못한다" },
    ],
  },
  {
    id: "p.autonomy",
    cell: "1.2",
    ask: "에이전트가 어디까지 스스로 하나요?",
    help: "자율 수준(Microsoft · OpenAI 에이전트 가이드). 피해가 클수록 사람에게 가깝게 둡니다.",
    kind: "single",
    options: [
      { value: "suggest", label: "제안만 한다", hint: "실행은 사람이" },
      { value: "approve", label: "사람이 확인하면 실행한다" },
      { value: "notify", label: "실행하고 바로 알린다" },
      { value: "full", label: "알아서 끝까지 한다" },
    ],
  },
  {
    id: "p.escalate",
    cell: "1.2",
    ask: "어떤 때 멈추고 사람에게 넘기나요?",
    help: "넘기는 조건(OpenAI 가이드의 human intervention). 고른 것마다 실패 약속이 하나 생깁니다.",
    kind: "multi",
    options: [
      { value: "lowconf", label: "확신이 낮을 때" },
      { value: "novel", label: "처음 보는 종류의 입력일 때" },
      { value: "irreversible", label: "되돌릴 수 없는 일 직전에" },
      { value: "repeat", label: "같은 실패가 두 번 나면" },
      { value: "none", label: "넘기지 않는다" },
    ],
  },
  {
    id: "p.approval",
    cell: "1.2",
    ask: "파일을 고치거나 밖으로 보내기 전에 사람이 확인하나요?",
    help: "「아니오」면 검사가 높은 위험으로 표시합니다.",
    kind: "single",
    options: [
      { value: "yes", label: "예 — 사람이 확인한 뒤에만" },
      { value: "no", label: "아니오 — 바로 한다" },
    ],
    showIf: [
      { item: "p.actions", includesAny: ["edit", "send"] },
      { item: "p.autonomy", notIn: ["suggest", "approve"] },
    ],
  },
  {
    id: "p.undo",
    cell: "1.2",
    ask: "고친 파일은 어떻게 되돌리나요?",
    kind: "single",
    options: [
      { value: "revert", label: "커밋을 되돌린다" },
      { value: "backup", label: "고치기 전 사본에서 복원한다" },
      { value: "none", label: "되돌릴 수 없다" },
    ],
    showIf: [{ item: "p.actions", includes: "edit" }],
  },
  {
    id: "p.model",
    cell: "1.2",
    ask: "모델은 누가 맡나요?",
    kind: "single",
    options: [
      { value: "host", label: "IDE의 호스트 모델", hint: "Cursor 등에서 Claude Code · Grok · GPT가 답한다 — 키 필요 없음" },
      { value: "api", label: "API로 직접 부른다", hint: "키와 비용이 이 에이전트 쪽에 있다" },
    ],
    showIf: [{ item: "o.outputs", fact: "needsModel" }],
  },
  {
    id: "p.timeout",
    cell: "1.2",
    ask: "모델의 답을 얼마나 기다리나요?",
    kind: "single",
    options: [
      { value: "30000", label: "30초" },
      { value: "120000", label: "2분" },
      { value: "600000", label: "10분", hint: "호스트 모델에게 사람이 시키는 데 걸리는 시간까지" },
    ],
    showIf: [{ item: "o.outputs", fact: "needsModel" }],
  },

  // ── 1.3 정보 경계 ───────────────────────────────────────────
  {
    id: "i.reads",
    cell: "1.3",
    ask: "어느 폴더를 읽나요?",
    help: "스캔 결과의 폴더입니다. 민감도는 경로로 자동으로 매깁니다.",
    kind: "pick",
    dynamic: "folders",
  },
  {
    id: "i.untrusted",
    cell: "1.3",
    ask: "읽는 것 중에 밖에서 온 글(웹 · 메일 · 남이 쓴 문서)이 있나요?",
    help: "그 글 안에 숨은 지시가 에이전트를 움직일 수 있습니다(OWASP LLM01 프롬프트 인젝션). 「예」면 막는 약속과 시험이 생깁니다.",
    kind: "single",
    options: [
      { value: "yes", label: "예" },
      { value: "no", label: "아니오 — 우리가 쓴 글만 읽는다" },
    ],
  },
  {
    id: "i.emits",
    cell: "1.3",
    ask: "밖으로 나가는 내용은 무엇인가요?",
    kind: "single",
    options: [
      { value: "raw", label: `입력 원문 그대로` },
      { value: "summary", label: "요약만" },
      { value: "none", label: "아무것도 나가지 않는다" },
    ],
    showIf: [{ item: "p.model", equals: "api" }],
  },

  // ── 1.4 함께 쓰는 값 — 값 목록은 0층의 개념에서 만들고, 기억 범위만 묻는다.
  {
    id: "s.memory",
    cell: "1.4",
    ask: "에이전트가 이전 대화나 결과를 기억하나요?",
    help: "단기 · 장기 기억(LangGraph). 오래 기억하면 개인정보와 함께 다시 보게 됩니다.",
    kind: "single",
    options: [
      { value: "none", label: "기억하지 않는다", hint: "매번 처음부터" },
      { value: "thread", label: "한 대화 안에서만" },
      { value: "long", label: "오래 기억한다", hint: "대화가 끝나도" },
    ],
  },

  // ── 1.5 단계와 연결 ─────────────────────────────────────────
  {
    id: "f.pattern",
    cell: "1.5",
    ask: "어떤 방식으로 일하나요?",
    kind: "single",
    options: [
      { value: "chain", label: "순서대로", hint: "앞 단계의 결과가 다음 단계로 — 가장 단순하다" },
      { value: "routing", label: "갈래 따라 다른 길", hint: "갈래를 정한 뒤 갈래마다 다르게 처리한다" },
      { value: "evaluator", label: "쓰고 검토하고 다시", hint: "모델이 쓴 것을 검토 단계가 막으면 다시 쓴다" },
    ],
  },
  {
    id: "f.onRefuse",
    cell: "1.5",
    ask: "모델이 답을 거절하면?",
    kind: "single",
    options: FALLBACK_OPTIONS,
    showIf: [{ item: "o.outputs", fact: "needsModel" }],
  },
  {
    id: "f.onTimeout",
    cell: "1.5",
    ask: "정한 시간 안에 모델의 답이 없으면?",
    kind: "single",
    options: FALLBACK_OPTIONS,
    showIf: [{ item: "o.outputs", fact: "needsModel" }],
  },
  {
    id: "f.onEmpty",
    cell: "1.5",
    ask: "입력이 비어 있으면?",
    kind: "single",
    options: [
      { value: "answer", label: "바로 「입력이 비었다」고 답한다" },
      { value: "stop", label: "아무것도 하지 않고 끝낸다" },
    ],
  },

  // ── 1.6 문서 의존 ───────────────────────────────────────────
  {
    id: "d.docs",
    cell: "1.6",
    ask: "갈래마다 어느 문서를 주나요?",
    help: "스캔 결과의 마크다운 파일 중에서 고릅니다.",
    kind: "matrix",
    dynamic: "doc-rows",
    showIf: [{ item: "o.outputs", includes: "recommend" }],
  },

  // ── 1.7 요구사항 — 품질(ISO 25010) 넷 + 우선순위(MoSCoW) ──────────
  {
    id: "q.speed",
    cell: "1.7",
    ask: "한 건에 답이 얼마나 빨리 나와야 하나요?",
    help: "성능 — 품질 요구사항은 잴 수 있는 기준이 함께 붙습니다.",
    kind: "single",
    options: [
      { value: "5", label: "5초 안" },
      { value: "30", label: "30초 안" },
      { value: "300", label: "5분 안" },
      { value: "any", label: "상관없다" },
    ],
  },
  {
    id: "q.accuracy",
    cell: "1.7",
    ask: "갈래를 얼마나 맞혀야 하나요?",
    kind: "single",
    options: [
      { value: "80", label: "10개 중 8개" },
      { value: "90", label: "10개 중 9개" },
      { value: "95", label: "20개 중 19개 이상" },
    ],
    showIf: [{ item: "o.outputs", includes: "classify" }],
  },
  {
    id: "q.privacy",
    cell: "1.7",
    ask: "들어오는 것에 개인정보나 비밀이 섞일 수 있나요?",
    help: "보안 — 「예」면 밖으로 내보내지 않는다는 약속과 시험이 생깁니다.",
    kind: "single",
    options: [
      { value: "yes", label: "예, 섞일 수 있다" },
      { value: "no", label: "아니오" },
      { value: "unknown", label: "모르겠다 — 섞인다고 보고 설계한다" },
    ],
  },
  {
    id: "q.trace",
    cell: "1.7",
    ask: "처리한 것을 기록으로 남기나요?",
    help: "나중에 「왜 이렇게 했나」를 되짚으려면 기록이 필요합니다.",
    kind: "single",
    options: [
      { value: "all", label: "모두 남긴다", hint: "결과와 근거까지" },
      { value: "failures", label: "실패만 남긴다" },
      { value: "none", label: "남기지 않는다" },
    ],
  },
  {
    id: "q.confidence",
    cell: "1.7",
    ask: "결과에 얼마나 확실한지를 보여 주나요?",
    help: "사람-AI 상호작용 지침(Google PAIR · Microsoft HAX) — 확신을 보여야 사람이 믿을지 말지 정합니다.",
    kind: "single",
    options: [
      { value: "always", label: "늘 보여 준다", hint: "높음 · 보통 · 낮음" },
      { value: "low", label: "확신이 낮을 때만 알린다" },
      { value: "none", label: "보여 주지 않는다" },
    ],
  },
  {
    id: "q.correct",
    cell: "1.7",
    ask: "사용자가 틀린 결과를 고칠 수 있나요?",
    help: "고친 것이 다음 판의 시험이 되면 에이전트가 점점 나아집니다(5 운영 → 1 설계).",
    kind: "single",
    options: [
      { value: "yes", label: "예 — 고친 것을 남겨 시험으로 쓴다" },
      { value: "no", label: "아니오" },
    ],
  },
  {
    id: "r.reqs",
    cell: "1.7",
    ask: "이 에이전트가 지킬 약속입니다. 줄마다 우선순위를 고르세요.",
    help: "MoSCoW — 꼭 · 있으면 좋음 · 나중에 · 이번엔 안 함. 「이번엔 안 함」은 하지 않는 것으로 갑니다. 「If」로 시작하는 실패 약속이 하나는 남아야 합니다.",
    kind: "matrix",
    columns: [
      { value: "must", label: "꼭" },
      { value: "should", label: "있으면 좋음" },
      { value: "could", label: "나중에" },
      { value: "wont", label: "이번엔 안 함" },
    ],
    dynamic: "priority-rows",
  },

  // ── 1.8 평가 ────────────────────────────────────────────────
  {
    id: "e.edges",
    cell: "1.8",
    ask: "까다로운 경우를 적어 주세요. 짧게, 여러 개 적을수록 좋습니다.",
    help: "오류 분석(Hamel Husain) — 시험은 상상한 실패가 아니라 실제로 헷갈릴 경우에서 나와야 합니다. 예: 두 갈래에 걸친 메모, 아주 긴 메모, 영어 메모.",
    kind: "chips",
    placeholder: "경우를 적고 Enter",
  },
  {
    id: "e.size",
    cell: "1.8",
    ask: "시험 예를 몇 개쯤 모을 계획인가요?",
    help: "실패 종류마다 충분해야 판단이 섭니다 — 처음엔 50~100개가 흔한 출발점입니다.",
    kind: "single",
    options: [
      { value: "20", label: "20개 — 우선 돌려 본다" },
      { value: "50", label: "50개" },
      { value: "100", label: "100개 이상" },
    ],
  },
  {
    id: "e.samples",
    cell: "1.8",
    ask: "갈래마다 시험에 넣을 예를 한 줄씩 적어 주세요.",
    help: "그 예를 넣으면 그 갈래가 나와야 합니다.",
    kind: "slots",
    dynamic: "sample-rows",
    showIf: [{ item: "o.outputs", includes: "classify" }],
  },
];

export function surveyItem(id: string): SurveyItemDef | undefined {
  return SURVEY_ITEMS.find((item) => item.id === id);
}

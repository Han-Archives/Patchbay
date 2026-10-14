import {
  CAP_IDS,
  CREDENTIAL_STORES,
  ENV_LOCATIONS,
  INTERFACE_ENTRIES,
  TOOL_VIA,
  CARDINALITIES,
  CONCEPT_KINDS,
  EARS_PATTERNS,
  EMIT_TARGETS,
  EVAL_KINDS,
  IR_REDUCERS,
  RELATION_KINDS,
  RULE_SOURCES,
} from "../types/ir.js";
import { SENSITIVITY_LEVELS } from "../sensitivity/sensitivity.js";

/**
 * 칸마다 **무엇을 적는가**. 화면이 이걸 읽어 입력을 그린다.
 *
 * 여기 있는 이유: 폼을 화면에 아홉 개 만들면 IR 계약이 화면에 복제되고, 스키마를
 * 고칠 때 두 곳을 고쳐야 한다 (원칙 8 — 하나의 정의). 화면은 **그리기만** 한다.
 *
 * 이것은 형식의 기술이지 판정이 아니다. 무엇이 옳은 설계인가는 DRC가 정한다 —
 * 여기서 막으면 사람이 초안을 쓰다 말고 거절당한다.
 */

export type IrFieldKind =
  | "para" // 여러 줄 문장
  | "text" // 한 줄
  | "bool"
  | "lines" // 문장 여러 개 (string[])
  | "rows"; // 같은 모양의 행 여러 개

export type IrColumnKind = "text" | "para" | "enum" | "bool" | "number" | "list";

export interface IrColumn {
  key: string;
  label: string;
  kind: IrColumnKind;
  /** `enum` 과 `list` 에서 고를 값. `list` 는 자유 입력도 받는다. */
  options?: readonly (string | number)[];
  /** 비워도 되는 칸인가. 판정은 DRC가 한다 — 여기선 화면 표시용이다. */
  optional?: boolean;
  hint?: string;
}

export interface IrField {
  /** 최상위 키. 쓰기는 이 단위로 통째 한다 — 빈 키 아래로 내려갈 수 없기 때문이다. */
  key: string;
  label: string;
  kind: IrFieldKind;
  hint?: string;
  /** `rows` 일 때 행의 모양. */
  columns?: IrColumn[];
  /** `why` 처럼 한 덩어리 객체일 때 그 안의 칸들. */
  parts?: IrColumn[];
  /**
   * 비우는 것이 **답이 될 수 있는** 칸인가 (`[]`). 화면이 「없음으로 적기」를
   * 이 칸에만 둔다 — 「아직」과 「없다」를 사람이 구분해 적게.
   */
  canBeEmpty?: boolean;
}

const LEVELS = SENSITIVITY_LEVELS;

export const IR_CELL_FIELDS: Record<string, IrField[]> = {
  "0.0": [
    {
      key: "concepts",
      label: "개념",
      kind: "rows",
      hint: "에이전트가 다루는 것들. 다른 칸은 여기 있는 낱말만 쓴다",
      columns: [
        { key: "id", label: "코드 이름", kind: "text", hint: "영어 한 낱말 — memo 처럼" },
        { key: "label", label: "이름", kind: "text" },
        { key: "kind", label: "종류", kind: "enum", options: CONCEPT_KINDS },
        { key: "values", label: "값 목록", kind: "list", optional: true, hint: "종류가 enum 일 때" },
      ],
    },
    {
      key: "relations",
      label: "관계",
      kind: "rows",
      canBeEmpty: true,
      columns: [
        { key: "from", label: "에서", kind: "text" },
        { key: "to", label: "으로", kind: "text" },
        { key: "kind", label: "뜻", kind: "enum", options: RELATION_KINDS },
        { key: "cardinality", label: "몇 개", kind: "enum", options: CARDINALITIES },
      ],
    },
    {
      key: "rules",
      label: "늘 참인 규칙",
      kind: "rows",
      canBeEmpty: true,
      columns: [
        { key: "id", label: "규칙", kind: "text" },
        { key: "text", label: "문장", kind: "para" },
        { key: "source", label: "어디서", kind: "enum", options: RULE_SOURCES },
      ],
    },
  ],
  "1.0": [
    {
      key: "why",
      label: "에이전트가 필요한 이유",
      kind: "para",
      hint: "모델을 부를 이유가 없으면 여기서 끝난다 — 그게 이 칸의 일이다.",
      parts: [
        { key: "alternative", label: "모델 없이 하면", kind: "para", hint: "표·규칙으로 어디까지 되나" },
        { key: "modelNeed", label: "표로 안 되는 일", kind: "para", hint: "정확히 무엇이 표로 안 되나" },
        { key: "verdict", label: "그래서 결론", kind: "para", hint: "모델은 어디까지 하나" },
        { key: "needsModel", label: "모델을 불러야 한다", kind: "bool" },
        { key: "note", label: "덧붙임", kind: "text", optional: true },
      ],
    },
  ],
  "1.1": [
    { key: "goal", label: "목적", kind: "para", hint: "무엇을 넣으면 무엇이 나오나" },
    { key: "done", label: "완료 조건", kind: "lines", hint: "판정할 수 있게 적는다. 최소 하나" },
    {
      key: "stakeholders",
      label: "쓰는 사람",
      kind: "rows",
      canBeEmpty: true,
      columns: [
        { key: "id", label: "코드", kind: "text" },
        { key: "role", label: "누구", kind: "text" },
        { key: "need", label: "무엇이 필요한가", kind: "text" },
      ],
    },
    {
      key: "metrics",
      label: "성공 지표",
      kind: "rows",
      canBeEmpty: true,
      hint: "목표치가 있어야 잰다",
      columns: [
        { key: "id", label: "코드", kind: "text" },
        { key: "what", label: "무엇이", kind: "text" },
        { key: "target", label: "목표치", kind: "text" },
      ],
    },
    { key: "nonGoals", label: "하지 않는 것", kind: "lines", hint: "범위 밖. 적지 않으면 에이전트가 넘어간다" },
    { key: "constraints", label: "제약", kind: "lines" },
    { key: "assumptions", label: "가정", kind: "lines" },
  ],
  "1.2": [
    {
      key: "caps",
      label: "권한",
      kind: "rows",
      hint: "무엇을 위임하고 어떻게 되돌리나",
      columns: [
        { key: "id", label: "권한", kind: "enum", options: CAP_IDS },
        { key: "scope", label: "범위", kind: "text" },
        { key: "undo", label: "되돌리기", kind: "text" },
        { key: "humanApproval", label: "사람 확인", kind: "bool" },
      ],
    },
    {
      key: "tools",
      label: "툴",
      kind: "rows",
      canBeEmpty: true,
      columns: [
        { key: "id", label: "id", kind: "text" },
        { key: "caps", label: "권한", kind: "list", options: CAP_IDS },
        { key: "what", label: "하는 일", kind: "text" },
        { key: "irreversible", label: "되돌릴 수 없음", kind: "bool" },
        { key: "via", label: "어디의 도구", kind: "enum", options: TOOL_VIA, optional: true, hint: "MCP 서버의 도구면 mcp" },
        { key: "server", label: "MCP 서버", kind: "text", optional: true },
      ],
    },
    {
      key: "models",
      label: "모델",
      kind: "rows",
      canBeEmpty: true,
      hint: "1.0이 모델을 요구하면 여기가 비면 안 된다",
      columns: [
        { key: "id", label: "모델 이름", kind: "text" },
        { key: "provider", label: "공급자", kind: "text", hint: "IDE의 호스트 모델이 맡으면 host" },
        { key: "caps", label: "권한", kind: "list", options: CAP_IDS },
        { key: "usedBy", label: "부르는 노드", kind: "list" },
        { key: "timeoutMs", label: "한도(ms)", kind: "number" },
        { key: "fallback", label: "대체", kind: "text", optional: true },
      ],
    },
    {
      key: "environment",
      label: "실행 환경",
      kind: "para",
      hint: "그래프가 도는 곳과 언어. 2 구현은 지금 TypeScript만 만든다. 원격(SSH)이면 터널 주소까지 — 상담에서 묻는다",
      parts: [
        { key: "language", label: "언어", kind: "text", hint: "typescript" },
        { key: "runtime", label: "런타임", kind: "text", optional: true, hint: "node 22 처럼" },
        { key: "workdir", label: "작업 폴더", kind: "text", optional: true },
        { key: "location", label: "도는 곳", kind: "enum", options: ENV_LOCATIONS },
        { key: "hardware", label: "하드웨어", kind: "text", optional: true },
        { key: "libraries", label: "라이브러리", kind: "list", optional: true },
      ],
    },
  ],
  "1.3": [
    {
      key: "reads",
      label: "읽는 것",
      kind: "rows",
      columns: [
        { key: "path", label: "경로", kind: "text" },
        { key: "level", label: "민감도", kind: "enum", options: LEVELS },
        { key: "why", label: "왜", kind: "text", optional: true },
      ],
    },
    {
      key: "emits",
      label: "내보내는 것",
      kind: "rows",
      canBeEmpty: true,
      columns: [
        { key: "what", label: "무엇", kind: "text" },
        { key: "level", label: "민감도", kind: "enum", options: LEVELS },
        { key: "to", label: "어디로", kind: "enum", options: EMIT_TARGETS },
        { key: "reason", label: "근거", kind: "text" },
        { key: "where", label: "어느 저장소", kind: "text", optional: true, hint: "to 가 db 일 때" },
      ],
    },
    {
      key: "credentials",
      label: "자격 증명",
      kind: "rows",
      canBeEmpty: true,
      hint: "값은 적지 않는다 — 어디에 두는지만",
      columns: [
        { key: "id", label: "코드", kind: "text" },
        { key: "what", label: "무엇을 여나", kind: "text" },
        { key: "storedAt", label: "두는 곳", kind: "enum", options: CREDENTIAL_STORES },
        { key: "note", label: "덧붙임", kind: "text", optional: true },
      ],
    },
  ],
  "1.4": [
    {
      key: "state",
      label: "함께 쓰는 값",
      kind: "rows",
      hint: "단계보다 먼저 정한다 — 단계는 이 값들을 읽고 쓴다",
      columns: [
        { key: "field", label: "값 이름", kind: "text" },
        { key: "type", label: "종류", kind: "text", hint: "string · number · BaseMessage[] 처럼" },
        { key: "reducer", label: "합치는 법", kind: "enum", options: IR_REDUCERS },
        { key: "reducerRef", label: "custom 참조", kind: "text", optional: true },
        { key: "default", label: "기본값", kind: "text", hint: '코드 리터럴 — "[]" 처럼' },
      ],
    },
  ],
  "1.5": [
    {
      key: "nodes",
      label: "단계(노드)",
      kind: "rows",
      columns: [
        { key: "id", label: "코드 이름", kind: "text", hint: "영어 한 낱말 — classify 처럼" },
        { key: "label", label: "이름", kind: "text" },
        { key: "reads", label: "읽는 값", kind: "list" },
        { key: "writes", label: "쓰는 값", kind: "list" },
        { key: "models", label: "모델", kind: "list", optional: true },
        { key: "tools", label: "툴", kind: "list", optional: true },
        { key: "documents", label: "문서", kind: "list", optional: true },
      ],
    },
    {
      key: "edges",
      label: "연결",
      kind: "rows",
      hint: "__start__(시작)에서 __end__(끝)까지 닿아야 한다. 실패 갈래에는 조건을 적는다",
      columns: [
        { key: "from", label: "에서", kind: "text" },
        { key: "to", label: "으로", kind: "text" },
        { key: "when", label: "조건", kind: "text", optional: true },
      ],
    },
  ],
  "1.6": [
    {
      key: "documents",
      label: "문서 의존",
      kind: "rows",
      canBeEmpty: true,
      hint: "한 줄 = 한 의존. 「어떤 입력일 때 이 문서인가」가 조건이다",
      columns: [
        { key: "id", label: "id", kind: "text" },
        { key: "node", label: "노드", kind: "text" },
        { key: "path", label: "경로", kind: "text" },
        { key: "level", label: "민감도", kind: "enum", options: LEVELS },
        { key: "when", label: "조건", kind: "text" },
        { key: "via", label: "근거 경로", kind: "text", optional: true },
      ],
    },
  ],
  "1.7": [
    {
      key: "requirements",
      label: "요구사항",
      kind: "rows",
      hint: "EARS 다섯 패턴. unwanted 가 최소 하나 있어야 한다 — 그게 빠지는 칸이다",
      columns: [
        { key: "id", label: "id", kind: "text" },
        { key: "pattern", label: "패턴", kind: "enum", options: EARS_PATTERNS },
        { key: "summary", label: "한 줄 요약", kind: "text", optional: true, hint: "화면에 보이는 25자 안쪽 — 「시스템은」 없이" },
        { key: "text", label: "문장", kind: "para" },
        { key: "note", label: "덧붙임", kind: "text", optional: true },
      ],
    },
    {
      key: "interface",
      label: "사용 화면",
      kind: "para",
      hint: "어디서 부르고 결과를 어떻게 보나",
      parts: [
        { key: "entry", label: "부르는 곳", kind: "list", options: INTERFACE_ENTRIES },
        { key: "output", label: "결과 모양", kind: "para" },
        { key: "review", label: "사람이 확인하는 화면", kind: "para", optional: true },
      ],
    },
  ],
  "1.8": [
    {
      key: "evals",
      label: "평가",
      kind: "rows",
      columns: [
        { key: "id", label: "id", kind: "text" },
        { key: "node", label: "노드", kind: "text" },
        { key: "kind", label: "종류", kind: "enum", options: EVAL_KINDS },
        { key: "input", label: "입력", kind: "para" },
        { key: "expect", label: "기대", kind: "para" },
        { key: "scoring", label: "채점", kind: "text", optional: true, hint: "kind: model 일 때 필요" },
      ],
    },
    {
      key: "requirementLinks",
      label: "추적 표",
      kind: "rows",
      hint: "요구사항 × 노드 × 평가. 이 표가 원본이다",
      columns: [
        { key: "requirement", label: "요구사항", kind: "text" },
        { key: "node", label: "노드", kind: "text" },
        { key: "eval", label: "평가", kind: "text" },
      ],
    },
  ],
};

/** 그 칸이 쓰는 최상위 키들. */
export function cellKeys(cellId: string): string[] {
  return (IR_CELL_FIELDS[cellId] ?? []).map((field) => field.key);
}
export type IrCellFields = Record<string, IrField[]>;

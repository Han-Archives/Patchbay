import { IR_GATE_CELLS } from "./gates.js";
import { IR_SCHEMA_VERSION } from "../types/ir.js";

/**
 * 1단계를 **시작하는** 자리.
 *
 * 설계 화면이 완성된 IR만 읽을 수 있으면 1단계 내내 쓸모가 없다 — 그 열 칸을
 * 채우는 동안 초안은 **언제나 불완전**하기 때문이다. 그래서 여기 둘이 필요하다:
 * 빈 골격을 만드는 것과, 불완전한 초안에서 칸별 상태를 읽는 것.
 */

/** 칸마다 이 키들이 그 칸의 내용이다 (`IR_GATE_CELLS[].fixes` 와 같은 축). */
const CELL_KEYS: Record<string, readonly string[]> = {
  "0.0": ["concepts", "relations", "rules"],
  "1.0": ["why"],
  "1.1": ["goal", "done"],
  "1.2": ["caps", "tools", "models"],
  "1.3": ["reads", "emits"],
  "1.4": ["state"],
  "1.5": ["nodes", "edges"],
  "1.6": ["documents"],
  "1.7": ["requirements"],
  "1.8": ["evals", "requirementLinks"],
};

/**
 * 칸에 있지만 비어도 되는 키 — 골격에는 쓰고(옆에 적을 자리), 진행 계산에서는 뺀다.
 * 요구사항 명세 관례(29148 · Volere · PRD)에서 가져온 칸들이다 (2026-10-05).
 */
const OPTIONAL_KEYS: Record<string, readonly string[]> = {
  "1.1": ["stakeholders", "metrics", "nonGoals", "constraints", "assumptions"],
  // 3판 (명세 20261006a §3.9) — 환경 · 자격 증명 · 사용 화면. 비어도 칸은 찬 것으로 센다.
  "1.2": ["environment"],
  "1.3": ["credentials"],
  "1.7": ["interface"],
};

/**
 * 한 칸의 상태.
 *
 * `empty` 와 `declared` 를 나누는 이유는 실행 기록의 「빈 배열은 값이다」와 같다
 * (명세 §5.2): 키가 없는 것은 「아직 안 썼다」이고 `[]` 는 「없는 것이 답이다」다.
 * 둘을 합치면 `tools: []` 를 적어 넣은 사람이 안 적은 사람과 같아 보인다.
 */
export type IrCellFill = "empty" | "declared" | "filled";

export interface IrCellProgress {
  id: string;
  label: string;
  fixes: string;
  fill: IrCellFill;
  /** 아직 값이 없는 키들. 화면이 「이 칸에 무엇을 쓰면 되나」로 쓴다. */
  missing: string[];
}

export interface IrDraftProgress {
  cells: IrCellProgress[];
  /**
   * 사람이 **답한** 칸 수 / 아홉 (1.9는 내용 칸이 아니다).
   *
   * 「없음으로 적음」(`[]`)도 답한 것으로 센다 — 문서 의존이 없는 설계가 영영
   * 9/9에 못 가면 그 숫자가 거짓말을 한다. 내용이 있는 칸과 없다고 적은 칸의
   * 구분은 칸마다의 `fill` 이 진다.
   */
  answered: number;
  total: number;
}

function hasContent(value: unknown): IrCellFill {
  if (value === undefined || value === null) return "empty";
  if (Array.isArray(value)) return value.length > 0 ? "filled" : "declared";
  if (typeof value === "string") return value.trim() ? "filled" : "empty";
  if (typeof value === "object") {
    const values = Object.values(value as Record<string, unknown>);
    return values.some((entry) => hasContent(entry) === "filled") ? "filled" : "empty";
  }
  return "filled";
}

/**
 * 불완전한 초안에서 칸별 상태를 읽는다 — **`parseIr` 를 거치지 않는다.**
 *
 * 1단계 중에는 초안이 스키마를 통과하지 못하는 것이 정상이다. 그때 화면이
 * zod 오류 한 덩어리만 보여 주면 사람은 다음에 무엇을 할지 알 수 없다. 여기서는
 * 「어느 칸이 비었나」만 본다.
 */
export function draftProgress(raw: unknown): IrDraftProgress {
  const doc = raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};

  const cells: IrCellProgress[] = [];
  let answered = 0;
  for (const cell of IR_GATE_CELLS) {
    if (cell.id === "1.9") continue; // 내용이 아니라 검사 그 자체다.
    const keys = CELL_KEYS[cell.id] ?? [];
    const fills = keys.map((key) => hasContent(doc[key]));
    const missing = keys.filter((key) => hasContent(doc[key]) === "empty");
    // 한 키라도 내용이 있으면 그 칸은 손댄 것이다.
    const fill: IrCellFill = fills.includes("filled")
      ? "filled"
      : fills.includes("declared")
        ? "declared"
        : "empty";
    if (fill !== "empty") answered += 1;
    cells.push({ id: cell.id, label: cell.label, fixes: cell.fixes, fill, missing });
  }
  return { cells, answered, total: cells.length };
}

/**
 * 빈 골격. 키는 두고 **값은 지어내지 않는다.**
 *
 * 키를 두는 이유: 이 파일은 사람과 호스트 모델이 고쳐 쓸 대상이라, 키가 있어야
 * 옆에 값을 적는다. 값을 안 넣는 이유: 자리를 채우는 기본값을 넣으면 그 순간
 * 안 쓴 것과 쓴 것이 같아 보이고, DRC가 지어낸 값을 판정하게 된다.
 *
 * **칸마다의 힌트는 여기 넣지 않는다** — 채우고 나면 남은 힌트가 소음이 되고,
 * 값을 쓴 자리에 주석이 끌려와 파일이 어긋난다. 무엇을 적는지는 `fields.ts` 가
 * 기술하고 화면이 보여 준다.
 *
 * 빈 키는 `null` 로 읽히고 `draftProgress` 가 「아직 안 썼다」로 센다. 「없는 것이
 * 답이다」는 `[]` 가 진다 (명세 §5.2의 「빈 배열은 값이다」와 같은 축).
 *
 * 그래서 이 골격은 `parseIr` 를 통과하지 않는다. 통과해야 하는 것은 **다 채운 뒤**다.
 */
export function renderIrSkeleton(project: string, graph = ""): string {
  const lines = [
    `# ${project} 설계(IR) 초안 — 1단계를 여기서 채운다.`,
    "#",
    "# 칸마다 키를 지우지 말고 **값을 적는다**. 키가 비면 「아직 안 썼다」로,",
    "# `[]` 는 「없는 것이 답이다」로 읽힌다 — 둘은 다른 뜻이다.",
    "# 무엇을 적는지는 설계 화면이 칸마다 알려 준다. 다 채우면 1.9가 열린다.",
    `schemaVersion: ${IR_SCHEMA_VERSION}`,
    "version: 1",
    `project: ${project}`,
    // 1단계 칸이 아니라서 화면이 채우지 않는다. 비면 명세 기본값 `""` 을 적어야
    // 다 채웠을 때 `null` 로 남아 `parseIr` 를 막지 않는다.
    `graph: ${graph === "" ? '""' : graph}`,
    "",
  ];
  for (const cell of IR_GATE_CELLS) {
    if (cell.id === "1.9") continue;
    lines.push(`# ── ${cell.id} ${cell.label} ${"─".repeat(Math.max(4, 42 - cell.label.length))}`);
    for (const key of CELL_KEYS[cell.id] ?? []) lines.push(`${key}:`);
    for (const key of OPTIONAL_KEYS[cell.id] ?? []) lines.push(`${key}:`);
    lines.push("");
  }
  return lines.join("\n");
}

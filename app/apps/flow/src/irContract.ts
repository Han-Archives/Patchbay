/** Client-safe IR view types (명세 20260929a). No fs, no zod -- the pane imports this. */

import type {
  Ir,
  IrCellFields,
  IrCellFill,
  IrCellGuide,
  IrCellProgress,
  IrCheckResult,
  IrColumn,
  IrDiff,
  IrDraftProgress,
  IrField,
  IrFieldKind,
  IrGateCellView,
} from "@patchbay/core";

export type {
  Ir,
  IrCellFields,
  IrCellGuide,
  IrCellFill,
  IrCellProgress,
  IrCheckResult,
  IrColumn,
  IrDiff,
  IrDraftProgress,
  IrField,
  IrFieldKind,
  IrGateCellView,
};

/** Which of the two files the screen is showing. They are never merged. */
export type IrSource = "current" | "proposed";

export interface IrViewMissing {
  status: "missing";
  alias: string;
  /** Neither `overlay.ir` nor a draft exists -- 1단계 미착수. */
  hasProposed: false;
  hasCurrent: false;
  /** 여기서 시작할 수 있다. 화면이 터미널로 내보내지 않게. */
  canStart: true;
}

/**
 * 초안은 있는데 아직 IR로 읽히지 않는다 — **1단계 중에는 이게 정상이다.**
 *
 * 열 칸을 채우는 동안 초안은 언제나 불완전하고, 그때 화면이 zod 오류 한 덩어리만
 * 보여 주면 사람은 다음에 무엇을 할지 알 수 없다. 그래서 칸별 진행을 함께 준다.
 */
export interface IrViewDrafting {
  status: "drafting";
  alias: string;
  source: IrSource;
  hasCurrent: boolean;
  hasProposed: boolean;
  /** 왜 아직 IR이 아닌가. 고치라고가 아니라 어디까지 왔나를 말하는 자리다. */
  error: string;
  progress: IrDraftProgress;
  /** 칸마다 무엇을 적는가. 커널이 기술하고 화면은 그린다 (원칙 8). */
  fields: IrCellFields;
  /** 칸마다 묻는 말과 예시 — 「예시」 버튼이 그린다. */
  guides: Record<string, IrCellGuide>;
  /** 지금 초안에 들어 있는 값. 편집기가 기존 값을 열어 보여 주려면 필요하다. */
  doc: Record<string, unknown>;
  /** 이 초안 파일의 경로. 사람이 열어 고칠 수 있게. */
  file: string;
}

export interface IrViewReady {
  status: "ready";
  alias: string;
  source: IrSource;
  hasCurrent: boolean;
  hasProposed: boolean;
  currentVersion: number | null;
  ir: Ir;
  checks: IrCheckResult[];
  gates: IrGateCellView[];
  passed: boolean;
  failedGates: string[];
  invalidated: string[];
  /** Draft against approved. `null` unless both exist. */
  diff: IrDiff | null;
  /**
   * Whether the 채택 button may do anything: a draft that passes. A person can
   * still be looking at a failing draft -- the screen shows it, it just cannot
   * be adopted (명세 §2.3, `--force` 없음).
   */
  canAdopt: boolean;
  /** Why not, in one line, when `canAdopt` is false. */
  adoptBlockedBy: string | null;
  /** 막힌 Phase를 이 화면에서 고칠 수 있게 — 편집기가 그린다. */
  fields: IrCellFields;
  guides: Record<string, IrCellGuide>;
}

export interface IrViewBroken {
  status: "broken";
  alias: string;
  source: IrSource;
  error: string;
  hasCurrent: boolean;
  hasProposed: boolean;
}

export type IrViewResponse = IrViewMissing | IrViewDrafting | IrViewReady | IrViewBroken;

export function isIrViewDrafting(body: IrViewResponse): body is IrViewDrafting {
  return body.status === "drafting";
}

export function isIrViewReady(body: IrViewResponse): body is IrViewReady {
  return body.status === "ready";
}

/** 칸 색. `invalid` is not a failure -- it is "re-confirm this once the other cell is fixed". */
export const GATE_STATUS_LABEL: Record<IrGateCellView["status"], string> = {
  pass: "통과",
  fail: "막힘",
  invalid: "무효",
  unknown: "판정 안 함",
};

/**
 * 화면이 칸을 부르는 번호 (`docs/용어.md` · Phase). 명세의 칸 번호 1.0~1.8과 1:1이다.
 * 1.9는 Phase가 아니다 — 아홉 Phase를 판정하는 최종 검사다.
 */
export function phaseOf(cellId: string): number | null {
  // 0.0 은 맨 아래 층(온톨로지) — 번호 0. 0 은 거짓 값이라 부르는 쪽은 `!== null` 로 본다.
  if (cellId === "0.0") return 0;
  const match = /^1\.([0-8])$/.exec(cellId);
  return match ? Number(match[1]) + 1 : null;
}

/** 손은 댔지만 빈 키가 남은 칸. 커널의 `answered` 는 이것까지 센다. */
export function isPartialCell(cell: IrDraftProgress["cells"][number]): boolean {
  return cell.fill !== "empty" && cell.missing.length > 0;
}

/** 다 적은 칸의 수 — 화면이 「어디서 멈췄나」를 말할 때 쓰는 수다. */
export function countCompleteCells(progress: IrDraftProgress): number {
  return progress.cells.filter((cell) => cell.fill !== "empty" && !isPartialCell(cell)).length;
}

/** 칸이 얼마나 찼나. `declared` 는 「없는 것이 답이다」로 적은 칸이다 (`[]`). */
export const CELL_FILL_LABEL: Record<IrCellFill, string> = {
  empty: "아직",
  declared: "없음으로 적음",
  filled: "적었음",
};

export interface IrSaveCellResponse {
  ok: boolean;
  progress?: IrDraftProgress;
  error?: string;
}

export interface IrStartDraftResponse {
  ok: boolean;
  file?: string;
  error?: string;
}

export interface IrAdoptResponse {
  ok: boolean;
  version?: number;
  previousVersion?: number | null;
  archived?: string | null;
  error?: string;
}

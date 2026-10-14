import YAML from "yaml";
import { IR_CELL_FIELDS, type IrColumn, type IrField } from "./fields.js";
import { draftProgress, type IrDraftProgress } from "./draft.js";

/**
 * 초안의 한 칸을 고쳐 쓴다.
 *
 * 세 가지를 지킨다:
 *
 * 1. **주석이 남는다.** `YAML.parseDocument` 로 열어 고치므로 칸 구분선과 사람이
 *    적어 둔 메모가 살아남는다. `parse` → `stringify` 로 왕복하면 다 날아간다.
 * 2. **최상위 키 단위로 통째 쓴다.** 빈 키는 `null` 이라 그 아래로 내려갈 수 없고
 *    (`setIn(["why","verdict"])` 가 실패한다), 키 단위면 그 문제가 없다.
 * 3. **판정하지 않는다.** 무엇이 옳은 설계인가는 DRC가 정한다. 여기서 막으면
 *    사람이 초안을 쓰다 말고 거절당한다 — 1단계 중에는 불완전한 것이 정상이다.
 *    모양(타입)만 맞춘다.
 */

export type DraftCellValues = Record<string, unknown>;

/** 쓴 뒤의 칸별 진행까지 함께 돌려준다 — 부르는 쪽이 YAML을 다시 파싱하지 않게. */
export type PatchDraftResult =
  | { ok: true; text: string; progress: IrDraftProgress }
  | { ok: false; error: string };

export function patchDraftCell(text: string, cellId: string, values: DraftCellValues): PatchDraftResult {
  const fields = IR_CELL_FIELDS[cellId];
  if (!fields) return { ok: false, error: `1단계에 "${cellId}" 칸은 없다.` };

  const byKey = new Map(fields.map((field) => [field.key, field]));
  for (const key of Object.keys(values)) {
    if (!byKey.has(key)) return { ok: false, error: `"${cellId}" 칸에 "${key}" 는 없는 키다.` };
  }

  let doc: YAML.Document.Parsed;
  try {
    doc = YAML.parseDocument(text);
  } catch (error) {
    return { ok: false, error: `초안의 YAML이 깨졌다 — ${(error as Error).message}` };
  }
  if (doc.errors.length > 0) {
    return { ok: false, error: `초안의 YAML이 깨졌다 — ${doc.errors[0]!.message}` };
  }

  for (const [key, raw] of Object.entries(values)) {
    doc.setIn([key], coerceField(byKey.get(key)!, raw));
  }
  const text2 = String(doc);
  return { ok: true, text: text2, progress: draftProgress(doc.toJS()) };
}

/** 모양만 맞춘다. 빈 값은 `null` 로 — 「아직 안 썼다」가 된다. */
function coerceField(field: IrField, raw: unknown): unknown {
  switch (field.kind) {
    case "bool":
      return Boolean(raw);
    case "text":
    case "para": {
      if (field.parts) return coerceParts(field.parts, raw);
      const text = typeof raw === "string" ? raw.trim() : "";
      return text === "" ? null : text;
    }
    case "lines": {
      const list = toArray(raw)
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry !== "");
      return list.length > 0 ? list : emptyAnswer(field, raw);
    }
    case "rows": {
      if (!Array.isArray(raw)) return null;
      const columns = field.columns ?? [];
      const rows = raw
        .filter((entry) => entry !== null && typeof entry === "object")
        .map((entry) => coerceRow(columns, entry as Record<string, unknown>))
        .filter((row) => hasMeaning(columns, row));
      return rows.length > 0 ? rows : emptyAnswer(field, raw);
    }
    default:
      return raw;
  }
}

/**
 * 비었을 때 `[]` 로 적을지 `null` 로 적을지.
 *
 * `[]` 는 「없는 것이 답이다」라서 그게 답이 될 수 있는 칸(`canBeEmpty`)에만 둔다.
 * `caps: []` 처럼 비면 설계가 아닌 칸에 `[]` 를 적으면 「아직」이 「답했다」로 세진다.
 */
function emptyAnswer(field: IrField, raw: unknown): unknown[] | null {
  return field.canBeEmpty && Array.isArray(raw) ? [] : null;
}

/** 체크박스만 있는 행은 손대지 않은 행이다 — 꺼진 체크박스도 `false` 로 읽히기 때문이다. */
function hasMeaning(columns: readonly IrColumn[], row: Record<string, unknown>): boolean {
  return Object.entries(row).some(([key, value]) => {
    const column = columns.find((entry) => entry.key === key);
    if (column?.kind === "bool") return false;
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== "";
  });
}

/** `why` 처럼 한 덩어리 객체. 안이 다 비면 통째로 `null` 이다. */
function coerceParts(parts: readonly IrColumn[], raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const part of parts) {
    const value = coerceColumn(part, source[part.key]);
    if (value === undefined) continue;
    // 행과 같은 규칙 — 선택 칸이 비면 키를 쓰지 않는다. `note: null` 은 스키마가
    // 거절한다(optional 은 「없음」이지 「null」이 아니다).
    if (part.optional && (value === null || value === "")) continue;
    out[part.key] = value;
  }
  const meaningful = Object.entries(out).some(([key, value]) => {
    const part = parts.find((entry) => entry.key === key);
    return part?.kind === "bool" ? false : value !== null && value !== "";
  });
  return meaningful ? out : null;
}

function coerceRow(columns: readonly IrColumn[], raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const column of columns) {
    const value = coerceColumn(column, raw[column.key]);
    if (value === undefined) continue;
    // 선택 칸이 비면 키를 쓰지 않는다 — `via: null` 보다 없는 편이 읽기 쉽다.
    if (column.optional && (value === null || value === "")) continue;
    out[column.key] = value;
  }
  return out;
}

function coerceColumn(column: IrColumn, raw: unknown): unknown {
  switch (column.kind) {
    case "bool":
      return Boolean(raw);
    case "number": {
      if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
      // `Number("")` 은 0 이다 — 빈 칸이 0 으로 적히면 안 쓴 한도가 「0ms」가 된다.
      const text = String(raw ?? "").trim();
      const value = text === "" ? Number.NaN : Number(text);
      return Number.isFinite(value) ? value : null;
    }
    case "list":
      return toArray(raw)
        .map((entry) => (typeof entry === "string" ? entry.trim() : entry))
        .filter((entry) => entry !== "" && entry !== null && entry !== undefined);
    case "enum": {
      if (raw === null || raw === undefined || raw === "") return null;
      // 숫자 열거(민감도)는 숫자로 돌려준다 — 문자 "2"가 들어가면 스키마가 거절한다.
      if (column.options?.some((option) => typeof option === "number")) {
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
      }
      return String(raw);
    }
    default: {
      const text = typeof raw === "string" ? raw.trim() : raw === undefined || raw === null ? "" : String(raw);
      return text === "" ? null : text;
    }
  }
}

function toArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") return raw.split("\n");
  return [];
}

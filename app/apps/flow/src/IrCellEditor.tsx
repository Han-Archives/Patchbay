import { useEffect, useState } from "react";
import { phaseOf, type IrCellGuide, type IrColumn, type IrDraftProgress, type IrField, type IrSaveCellResponse } from "./irContract.js";
import { CellExample } from "./IrPhaseRail.js";

/**
 * 한 칸을 채우는 입력.
 *
 * 폼을 칸마다 손으로 만들지 않는다 — 커널의 `IR_CELL_FIELDS` 가 칸의 모양을
 * 기술하고 여기서는 그것을 **그리기만** 한다. 스키마를 고칠 때 두 곳을 고치게
 * 되면 화면과 검사가 서로 다른 말을 하기 시작한다 (원칙 8).
 */

type Values = Record<string, unknown>;

export function IrCellEditor({
  project,
  cellId,
  cellLabel,
  fields,
  guide,
  doc,
  onSaved,
  onClose,
}: {
  project: string;
  cellId: string;
  cellLabel: string;
  fields: IrField[];
  /** 이 칸이 묻는 말과 예시. */
  guide?: IrCellGuide;
  /** 지금 초안에 들어 있는 값. 없으면 빈 입력으로 연다. */
  doc: Values;
  onSaved: (progress: IrDraftProgress) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Values>(() => seed(fields, doc));
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [showExample, setShowExample] = useState(false);

  // 다른 파일 이벤트로 화면이 다시 읽혀도 새 객체일 뿐이다 — 이 칸의 값이 바뀔 때만 입력을 되돌린다.
  const signature = JSON.stringify(fields.map((field) => doc[field.key] ?? null));
  useEffect(() => {
    setValues(seed(fields, doc));
    setNote(null);
  }, [cellId, signature]);

  async function save() {
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch("/api/ir/cell", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: project, cell: cellId, values }),
      });
      const body = (await res.json()) as IrSaveCellResponse;
      if (body.ok && body.progress) {
        onSaved(body.progress);
        onClose();
        return;
      }
      setNote(body.error ?? "쓰지 못했다");
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const set = (key: string, value: unknown) => setValues((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="cell-edit" data-window={cellId}>
      <header className="cell-edit-head">
        <b>{phaseOf(cellId) !== null ? `${phaseOf(cellId)} · ${cellLabel}` : cellLabel}</b>
        <span className="ir-grow" />
        {guide ? (
          <button type="button" className="flow-btn" aria-expanded={showExample} onClick={() => setShowExample((v) => !v)}>
            {showExample ? "예시 닫기" : "예시 보기"}
          </button>
        ) : null}
        <button type="button" className="flow-btn" data-action="save-cell" onClick={() => void save()} disabled={saving}>
          {saving ? "쓰는 중" : "이 칸 저장"}
        </button>
        <button type="button" className="flow-btn phase-close" aria-label="닫기" title="닫기" onClick={onClose}>
          ×
        </button>
      </header>

      {guide ? <p className="cell-edit-ask">{guide.ask}</p> : null}
      {guide && showExample ? <CellExample guide={guide} /> : null}

      {fields.map((field) => (
        <FieldInput key={field.key} field={field} value={values[field.key]} onChange={(v) => set(field.key, v)} />
      ))}

      {note ? <p className="flow-error">{note}</p> : null}
      <p className="cell-edit-foot">
        저장해도 검사는 돌지 않는다 — 1단계 중에는 불완전한 것이 정상이고, 판정은 다 채운 뒤 1.9가 한다.
      </p>
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: IrField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  return (
    <section className="cell-field">
      <div className="cell-field-head">
        <b>{field.label}</b>
        <code className="cell-field-key">{field.key}</code>
        {field.hint ? <span className="cell-field-hint">{field.hint}</span> : null}
      </div>

      {field.parts ? (
        <div className="cell-parts">
          {field.parts.map((part) => (
            <ColumnInput
              key={part.key}
              column={part}
              value={(value as Values | null)?.[part.key]}
              onChange={(v) => onChange({ ...((value as Values) ?? {}), [part.key]: v })}
            />
          ))}
        </div>
      ) : null}

      {field.kind === "para" && !field.parts ? (
        <textarea
          className="cell-input"
          rows={3}
          value={asText(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}

      {field.kind === "text" ? (
        <input className="cell-input" value={asText(value)} onChange={(event) => onChange(event.target.value)} />
      ) : null}

      {field.kind === "lines" ? (
        <textarea
          className="cell-input"
          rows={3}
          placeholder="한 줄에 하나"
          value={asLines(value)}
          onChange={(event) => onChange(event.target.value.split("\n"))}
        />
      ) : null}

      {field.kind === "rows" ? (
        <RowsInput field={field} rows={Array.isArray(value) ? (value as Values[]) : null} onChange={onChange} />
      ) : null}
    </section>
  );
}

function RowsInput({
  field,
  rows,
  onChange,
}: {
  field: IrField;
  /** `null` 은 「아직」, `[]` 는 「없음으로 적음」. 둘을 섞으면 안 쓴 칸이 답한 칸으로 세진다. */
  rows: Values[] | null;
  onChange: (value: unknown) => void;
}) {
  const columns = field.columns ?? [];
  const list = rows ?? [];
  const declaredEmpty = rows !== null && rows.length === 0;
  const setRow = (index: number, key: string, value: unknown) =>
    onChange(list.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  const removeRow = (index: number) => {
    const next = list.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : null);
  };

  return (
    <div className="cell-rows">
      {list.map((row, index) => (
        <div className="cell-row" key={index}>
          <span className="cell-row-n">{index + 1}</span>
          <div className="cell-row-cols">
            {columns.map((column) => (
              <ColumnInput
                key={column.key}
                column={column}
                value={row[column.key]}
                onChange={(v) => setRow(index, column.key, v)}
              />
            ))}
          </div>
          <button
            type="button"
            className="cell-row-del"
            title="이 줄 지우기"
            onClick={() => removeRow(index)}
          >
            ×
          </button>
        </div>
      ))}

      <div className="cell-rows-foot">
        <button type="button" className="flow-btn" onClick={() => onChange([...list, {}])}>
          줄 추가
        </button>
        {/* 「없음으로 적기」는 비울 수 있는 칸에만 — 「아직」과 「없다」를 사람이 구분해 적게 한다. */}
        {field.canBeEmpty && !declaredEmpty && list.length === 0 ? (
          <button type="button" className="flow-btn" data-action="declare-empty" onClick={() => onChange([])}>
            없음으로 적기
          </button>
        ) : null}
        {declaredEmpty ? (
          <>
            <span className="cell-declared" data-state="declared">
              없음으로 적었다
            </span>
            <button type="button" className="flow-btn" data-action="undeclare" onClick={() => onChange(null)}>
              「아직」으로 되돌리기
            </button>
          </>
        ) : null}
        {rows === null ? (
          <span className="cell-field-hint">
            {field.canBeEmpty ? "아직 안 썼다. 없는 것이 답이면 「없음으로 적기」를 누른다." : "아직 안 썼다. 최소 한 줄이 필요하다."}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ColumnInput({
  column,
  value,
  onChange,
}: {
  column: IrColumn;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = (
    <span className="cell-col-label">
      {column.label}
      {column.optional ? <span className="cell-col-opt"> 선택</span> : null}
    </span>
  );

  if (column.kind === "bool") {
    return (
      <label className="cell-col cell-col-bool">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        {label}
      </label>
    );
  }

  if (column.kind === "enum") {
    return (
      <label className="cell-col">
        {label}
        <select className="cell-input" value={asText(value)} onChange={(event) => onChange(event.target.value)}>
          <option value="">—</option>
          {(column.options ?? []).map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (column.kind === "list") {
    return (
      <label className="cell-col">
        {label}
        <input
          className="cell-input"
          placeholder={column.options ? (column.options as string[]).join(" · ") : "쉼표로 나눈다"}
          value={Array.isArray(value) ? (value as string[]).join(", ") : asText(value)}
          onChange={(event) =>
            onChange(
              event.target.value
                .split(",")
                .map((entry) => entry.trim())
                .filter((entry) => entry !== ""),
            )
          }
        />
      </label>
    );
  }

  if (column.kind === "para") {
    return (
      <label className="cell-col cell-col-wide">
        {label}
        <textarea className="cell-input" rows={2} value={asText(value)} onChange={(event) => onChange(event.target.value)} />
      </label>
    );
  }

  return (
    <label className="cell-col">
      {label}
      <input
        className="cell-input"
        type={column.kind === "number" ? "number" : "text"}
        placeholder={column.hint}
        value={asText(value)}
        onChange={(event) => onChange(column.kind === "number" ? event.target.value : event.target.value)}
      />
    </label>
  );
}

/** 초안에 이미 있는 값을 입력의 초기값으로. 없으면 빈 채로 연다. */
function seed(fields: IrField[], doc: Values): Values {
  const out: Values = {};
  for (const field of fields) {
    const current = doc[field.key];
    // 비어 있던 칸은 `null` 로 연다 — `[]` 로 열면 저장 한 번에 「없음으로 적음」이 된다.
    if (field.kind === "rows" || field.kind === "lines") out[field.key] = Array.isArray(current) ? current : null;
    else if (field.parts) out[field.key] = current && typeof current === "object" ? current : {};
    else out[field.key] = current ?? "";
  }
  return out;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return String(value);
}

function asLines(value: unknown): string {
  return Array.isArray(value) ? (value as string[]).join("\n") : asText(value);
}

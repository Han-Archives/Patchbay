import { useEffect, useRef, useState } from "react";
import { InlineText } from "./InlineText.js";
import { layout } from "./layout.js";
import {
  markdownFileRefs,
  phasesFromWorkLog,
  type ProcedureArtifact,
  type TalkMessage,
  type WorkLogPhase,
} from "./processArtifact.js";
import { PLAN_BEATS, planBeatPhase, type PlanHostKind, type PlanHostView, type ProcessStepView, type ProcessView } from "./projectContract.js";

const PLAN_COPY: Record<string, { lead: string }> = {
  "plan-goal": {
    lead: "목표는 이 화면이 아니라 Cursor 또는 Claude Code에서 정합니다. 그쪽에서 대화가 끝나면 결과가 이 칸에 반영됩니다.",
  },
  "plan-direction": {
    lead: "방향에서는 목표를 달성할 로드맵을 정합니다. 마일스톤별 기간·세부 작업·완료 기준을 확정하면 이 칸에 반영됩니다.",
  },
  "plan-proceed": {
    lead: "실행은 방향에서 정한 로드맵을 수행하는 칸입니다. 위 다이어그램이 계획이고, 아래 표가 작업과 작성 파일입니다.",
  },
};

export function ProcessBar({
  project,
  process,
  onChanged,
  onOpenFile,
}: {
  project: string;
  process: ProcessView;
  onChanged: () => void;
  onOpenFile?: (path: string) => void;
}) {
  const [selected, setSelected] = useState<string>(() => {
    const current = PLAN_BEATS.find((beat) => planBeatPhase(process.host, beat.id) !== "done");
    return current?.id ?? PLAN_BEATS[0]!.id;
  });

  const planBeats = process.planBeats.length > 0 ? process.planBeats : PLAN_BEATS.map((beat) => ({ ...beat, filled: false }));

  return (
    <section className="process-track">
      <ol className="process-rail process-plan-beats">
        {planBeats.map((beat, index) => {
          const phase = planBeatPhase(process.host, beat.id);
          return (
            <li key={beat.id} className={selected === beat.id ? "is-open" : undefined}>
              <button
                type="button"
                className={`process-node${phase === "done" ? " is-filled" : ""}${selected === beat.id ? " is-on" : ""}${phase === "running" ? " is-running" : ""}`}
                onClick={() => setSelected(beat.id)}
              >
                <span className="process-index">{index + 1}.</span>
                <span className="process-label">{beat.label}</span>
                {phase === "running" ? (
                  <span className="process-phase is-running">진행 중</span>
                ) : phase === "done" ? (
                  <span className="process-phase is-done">완료</span>
                ) : null}
              </button>
              {selected === beat.id ? (
                <ProcedurePanel
                  project={project}
                  step={beat}
                  constitution
                  onChanged={onChanged}
                  onOpenFile={onOpenFile}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      {process.goal ? <p className="process-goal">{process.goal}</p> : null}
    </section>
  );
}

function ProcedurePanel({
  project,
  step,
  constitution = false,
  onChanged,
  onOpenFile,
}: {
  project: string;
  step: ProcessStepView;
  constitution?: boolean;
  onChanged: () => void;
  onOpenFile?: (path: string) => void;
}) {
  const [artifact, setArtifact] = useState<ProcedureArtifact | null>(null);
  const [thread, setThread] = useState("");
  const [host, setHost] = useState<PlanHostView | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fingerprint = useRef("");
  const phase = constitution ? planBeatPhase(host, step.id) : "idle";
  const copy = PLAN_COPY[step.id];

  function applyStepBody(body: {
    artifact?: ProcedureArtifact;
    memory?: string;
    thread?: string;
    host?: PlanHostView | null;
    step?: ProcessStepView;
  }) {
    if (body.artifact) setArtifact(body.artifact);
    if (typeof body.thread === "string") setThread(body.thread);
    if (body.host !== undefined) setHost(body.host);
  }

  useEffect(() => {
    let cancelled = false;
    setArtifact(null);
    setError(null);
    fingerprint.current = "";
    function load() {
      fetch(`/api/project/process/step?alias=${encodeURIComponent(project)}&id=${encodeURIComponent(step.id)}`)
        .then(async (res) => {
          const body = (await res.json()) as {
            error?: string;
            artifact?: ProcedureArtifact;
            memory?: string;
            thread?: string;
            host?: PlanHostView | null;
            step?: ProcessStepView;
          };
          if (cancelled) return;
          if (!res.ok) {
            setError(body.error ?? `HTTP ${res.status}`);
            return;
          }
          applyStepBody(body);
          const next = JSON.stringify({
            filled: body.step?.filled ?? false,
            status: body.host?.status ?? "",
            memory: body.memory ?? "",
            rows: body.artifact?.rows ?? [],
            nodes: body.artifact?.nodes ?? [],
          });
          if (constitution && fingerprint.current && fingerprint.current !== next) onChanged();
          fingerprint.current = next;
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        });
    }
    load();
    const timer = constitution ? window.setInterval(load, 4000) : 0;
    const onFocus = () => load();
    if (constitution) window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      if (constitution) window.removeEventListener("focus", onFocus);
    };
  }, [project, step.id, constitution]);

  async function send() {
    const text = message.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/project/process/talk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: project, stepId: step.id, message: text }),
      });
      const body = (await res.json()) as { error?: string; artifact?: ProcedureArtifact };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setMessage("");
      if (body.artifact) setArtifact(body.artifact);
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function openHost(kind: PlanHostKind) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/project/process/host", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: project, stepId: step.id, host: kind }),
      });
      const body = (await res.json()) as {
        error?: string;
        artifact?: ProcedureArtifact;
        memory?: string;
        thread?: string;
        host?: PlanHostView;
        resumed?: boolean;
      };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setMessage("");
      applyStepBody(body);
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="process-panel">
      {error ? <p className="flow-error">{error}</p> : null}
      {constitution && phase === "running" ? (
        <div className="host-progress" role="status">
          <span className="host-dot" aria-hidden="true" />
          <div>
            <strong>진행 중</strong>
            <p>
              {hostLabel(host?.host ?? "cursor")}에서 {step.label} 대화를 하고 있습니다. 끝나면 이 칸에 반영됩니다.
            </p>
          </div>
        </div>
      ) : null}
      {artifact ? (
        <ProcedureVisual artifact={artifact} stepId={step.id} onOpenFile={onOpenFile} />
      ) : (
        <p>불러오는 중</p>
      )}
      {constitution ? (
        <HostComposer
          label={step.label}
          phase={phase}
          lead={copy?.lead ?? ""}
          lastHost={host?.host ?? "cursor"}
          busy={busy}
          onOpen={(kind) => void openHost(kind)}
        />
      ) : (
        <>
          <h4>대화</h4>
          <TalkLog messages={artifact?.messages ?? []} />
          <label className="flow-input">
            이 단계에서 정할 내용
            <textarea
              rows={3}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="예: 이 단계에서 할 일을 표로 정리해 줘"
            />
          </label>
        </>
      )}
      {constitution && hasMemoryText(thread) ? (
        <details className="proc-thread">
          <summary>대화 기록</summary>
          <pre className="proc-text">{thread}</pre>
        </details>
      ) : null}
      {constitution ? null : (
        <div className="flow-toolbar">
          <button type="submit" className="flow-btn" onClick={() => void send()} disabled={busy || !message.trim()}>
            {busy ? "정리 중" : "보내기"}
          </button>
        </div>
      )}
    </div>
  );
}

function HostComposer({
  label,
  phase,
  lead,
  lastHost,
  busy,
  onOpen,
}: {
  label: string;
  phase: "idle" | "running" | "done";
  lead: string;
  lastHost: PlanHostKind;
  busy: boolean;
  onOpen: (kind: PlanHostKind) => void;
}) {
  const action =
    phase === "running" ? "다시 열기" : phase === "done" ? "이어서 고치기" : `${label} 정하기`;
  return (
    <div className="host-launch">
      {lead ? <p className="host-lead">{lead}</p> : null}
      <div className="host-actions">
        <button
          type="button"
          className={`host-action${lastHost === "cursor" ? " is-last" : ""}`}
          disabled={busy}
          onClick={() => onOpen("cursor")}
        >
          <CursorMark />
          <span>Cursor에서 {action}</span>
        </button>
        <button
          type="button"
          className={`host-action${lastHost === "claude" ? " is-last" : ""}`}
          disabled={busy}
          onClick={() => onOpen("claude")}
        >
          <ClaudeMark />
          <span>Claude Code에서 {action}</span>
        </button>
      </div>
    </div>
  );
}

function hostLabel(kind: PlanHostKind): string {
  return kind === "claude" ? "Claude Code" : "Cursor";
}

function CursorMark() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path fill="currentColor" d="M5 3.2 19.6 12 9.2 14.2 5 21.2V3.2Z" />
    </svg>
  );
}

function ClaudeMark() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        d="M12 6.5v11M7.6 9.2 12 12l4.4-2.8M7.6 14.8 12 12l4.4 2.8"
      />
    </svg>
  );
}

function hasMemoryText(text: string): boolean {
  const stripped = text
    .replace(/^#.+$/gm, "")
    .replace(/\(아직 없음\)/g, "")
    .replace(/기획 대화의 이어서 쓸 기록입니다[^\n]*/g, "")
    .trim();
  return stripped.length >= 8;
}

function TalkLog({ messages }: { messages: TalkMessage[] }) {
  if (messages.length === 0) {
    return <p className="proc-talk-empty">아직 대화가 없습니다. 보내면 LangGraph가 이 단계를 정리합니다.</p>;
  }
  return (
    <ol className="proc-talk">
      {messages.map((item, index) => (
        <li key={`${item.role}-${index}`} className={`proc-msg proc-msg-${item.role}`}>
          <span className="proc-msg-role">{item.role === "user" ? "나" : "정리"}</span>
          <span className="proc-msg-text">{item.text}</span>
        </li>
      ))}
    </ol>
  );
}

function ProcedureVisual({
  artifact,
  stepId,
  onOpenFile,
}: {
  artifact: ProcedureArtifact;
  stepId?: string;
  onOpenFile?: (path: string) => void;
}) {
  const hasTable = artifact.columns.length > 0;
  const hasDiagram = artifact.nodes.length > 0;
  const lead = artifact.lead.trim();
  if (!hasTable && !hasDiagram && !lead && !artifact.body.trim()) {
    return null;
  }
  const scaleColumns = hasTable ? findScaleColumns(artifact.columns) : null;
  const gaugeColumns = hasTable && !scaleColumns ? findGaugeColumns(artifact.columns) : null;
  const isRoadmap =
    !scaleColumns &&
    stepId === "plan-direction" &&
    hasTable &&
    artifact.columns.length >= 2 &&
    artifact.rows.length > 1;
  const isProceed = stepId === "plan-proceed";
  const stepColumns = hasTable && !scaleColumns && !gaugeColumns ? findStepColumns(artifact.columns) : null;
  const isSpec = !stepColumns && !scaleColumns && !gaugeColumns && hasTable && isSpecSheet(artifact.columns);
  const phases = isProceed ? phasesFromWorkLog(artifact) : undefined;
  const table = hasTable ? (
    isProceed ? (
      <WorkLogTable artifact={artifact} onOpenFile={onOpenFile} />
    ) : (
      <div className="proc-table-wrap">
        <table className="placeholder-table proc-table">
          <thead>
            <tr>
              {artifact.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {artifact.rows.map((row, index) => (
              <tr key={index}>
                {artifact.columns.map((_, col) => (
                  <td key={col}>{row[col] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  ) : null;
  return (
    <>
      {lead ? (
        <p className="proc-lead">
          <InlineText text={lead} />
        </p>
      ) : null}
      {isProceed && hasDiagram ? <ProcedureDiagram artifact={artifact} phases={phases} /> : null}
      {scaleColumns ? (
        <ScaleMap artifact={artifact} cols={scaleColumns} />
      ) : gaugeColumns ? (
        <TargetGauges artifact={artifact} cols={gaugeColumns} />
      ) : stepColumns ? (
        <StepTrack artifact={artifact} cols={stepColumns} onOpenFile={onOpenFile} />
      ) : isSpec ? (
        <SpecSheet artifact={artifact} />
      ) : isRoadmap ? (
        <RoadmapTrack artifact={artifact} />
      ) : !isProceed || !hasDiagram ? (
        table
      ) : null}
      {!stepColumns && !isSpec && !scaleColumns && !gaugeColumns && isProceed && hasDiagram ? table : null}
      {hasDiagram && !stepColumns && !isSpec && !isRoadmap && !isProceed && !scaleColumns && !gaugeColumns ? (
        <ProcedureDiagram artifact={artifact} />
      ) : null}
      {!hasTable && !hasDiagram && artifact.body.trim() ? <pre className="proc-text">{artifact.body}</pre> : null}
    </>
  );
}

function WorkLogTable({
  artifact,
  onOpenFile,
}: {
  artifact: ProcedureArtifact;
  onOpenFile?: (path: string) => void;
}) {
  const statusCol = artifact.columns.findIndex((column) => /^상태$/.test(column.trim()));
  return (
    <div className="proc-table-wrap">
      <table className="placeholder-table proc-table">
        <thead>
          <tr>
            {artifact.columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {artifact.rows.map((row, index) => {
            const phase = statusCol >= 0 ? parseWorkLogTone(row[statusCol] ?? "") : undefined;
            return (
              <tr key={index} className={phase ? `is-${phase}` : undefined}>
                {artifact.columns.map((column, col) => (
                  <td key={column}>
                    {/^파일$/.test(column.trim()) ? (
                      <FileRefs text={row[col] ?? ""} onOpenFile={onOpenFile} />
                    ) : (
                      row[col] ?? ""
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function parseWorkLogTone(raw: string): WorkLogPhase {
  const text = raw.trim();
  if (/완료|done/i.test(text)) return "done";
  if (/진행|running/i.test(text)) return "running";
  return "idle";
}

function FileRefs({ text, onOpenFile }: { text: string; onOpenFile?: (path: string) => void }) {
  const files = markdownFileRefs(text);
  if (files.length === 0) return <>{text}</>;
  return (
    <span className="proc-files">
      {files.map((rel) => (
        <button type="button" key={rel} className="proc-file" onClick={() => onOpenFile?.(rel)}>
          {rel}
        </button>
      ))}
    </span>
  );
}

const SPEC_LABEL_COLUMN = /^(항목|이름|key|필드|구분)$/i;
const SPEC_VALUE_COLUMN = /^(값|내용|value|설명)$/i;

/**
 * A two-column 항목/값 table is a spec sheet, not a grid -- a ruled table
 * around label/value pairs is all chrome and no information.
 */
export function isSpecSheet(columns: string[]): boolean {
  if (columns.length !== 2) return false;
  return SPEC_LABEL_COLUMN.test(columns[0]!.trim()) && SPEC_VALUE_COLUMN.test(columns[1]!.trim());
}

function SpecSheet({ artifact }: { artifact: ProcedureArtifact }) {
  return (
    <dl className="spec-sheet">
      {artifact.rows.map((row, index) => (
        <div className="spec-row" key={`${row[0] ?? ""}-${index}`}>
          <dt>{row[0] ?? ""}</dt>
          <dd>
            <InlineText text={row[1] ?? ""} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

const STEP_NAME_COLUMN = /^(단계|스텝|step|절차)$/i;
const STEP_WHO_COLUMN = /^(누가|담당|who|역할)$/i;
const STEP_OUT_COLUMN = /^(결과물|산출물|파일|output)$/i;
const STEP_NOTE_COLUMN = /^(작업|내용|설명|note)$/i;

export interface StepColumns {
  name: number;
  who: number | null;
  out: number | null;
  note: number | null;
}

/**
 * A 단계 table is a procedure, not a grid -- render it as a track. Detected by
 * column name so any project whose 실행.md lists steps gets it, the same way
 * `RoadmapTrack` keys off 관문/완료 columns.
 *
 * Needs a 누가 or 결과물 column: a lone 단계 column is a plain list and a table
 * serves it fine.
 */
export function findStepColumns(columns: string[]): StepColumns | null {
  const at = (pattern: RegExp) => {
    const index = columns.findIndex((column) => pattern.test(column.trim()));
    return index >= 0 ? index : null;
  };
  const name = at(STEP_NAME_COLUMN);
  if (name === null) return null;
  const who = at(STEP_WHO_COLUMN);
  const out = at(STEP_OUT_COLUMN);
  if (who === null && out === null) return null;
  return { name, who, out, note: at(STEP_NOTE_COLUMN) };
}

/** 나·사용자 단계는 채운 칩, 그 밖(모델)은 외곽선 -- 주·보조를 무게로 구분한다. */
const MINE = /(^|[^가-힣])(나|사용자|본인)([^가-힣]|$)/;

function StepTrack({
  artifact,
  cols,
  onOpenFile,
}: {
  artifact: ProcedureArtifact;
  cols: StepColumns;
  onOpenFile?: (path: string) => void;
}) {
  return (
    <ol className="step-track">
      {artifact.rows.map((row, index) => {
        const who = cols.who === null ? "" : (row[cols.who] ?? "");
        const out = cols.out === null ? "" : (row[cols.out] ?? "");
        const note = cols.note === null ? "" : (row[cols.note] ?? "");
        return (
          <li className="step-item" key={`${row[cols.name] ?? ""}-${index}`}>
            <span className="step-dot">{index + 1}</span>
            <div className="step-body">
              <div className="step-line">
                <strong>{row[cols.name] ?? ""}</strong>
                {who
                  .split(/\s*[+·,]\s*/)
                  .filter(Boolean)
                  .map((actor) => (
                    <span key={actor} className={`step-who${MINE.test(actor) ? " is-mine" : ""}`}>
                      {actor}
                    </span>
                  ))}
              </div>
              {note ? (
                <p className="step-note">
                  <InlineText text={note} />
                </p>
              ) : null}
              {out ? <StepOutputs text={out} onOpenFile={onOpenFile} /> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StepOutputs({ text, onOpenFile }: { text: string; onOpenFile?: (path: string) => void }) {
  const files = markdownFileRefs(text);
  if (files.length === 0) {
    return <span className="step-out is-none">{text.replace(/`/g, "")}</span>;
  }
  return (
    <span className="step-outs">
      {files.map((rel) => (
        <button type="button" key={rel} className="step-out" onClick={() => onOpenFile?.(rel)}>
          {rel}
        </button>
      ))}
    </span>
  );
}

const NUMBER_CELL = /-?\d+(?:[.,]\d+)?/;

function cellNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = NUMBER_CELL.exec(raw.replace(/,/g, ""));
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

const SCALE_GROUP_COLUMN = /^(구역|그룹|묶음|group)$/i;
const SCALE_COUNT_COLUMN = /^(레슨|개수|건수|count)$/i;
const SCALE_DONE_COLUMN = /^(완료|done)$/i;

export interface ScaleColumns {
  group: number;
  name: number;
  count: number;
  done: number | null;
}

/**
 * 묶음 + 이름 + 개수 표는 목록이 아니라 **구성도**다. 각 항목을 개수에 비례하는
 * 막대로 그려 어디에 분량이 몰려 있는지 한눈에 보이게 한다. 컬럼 이름으로만
 * 판정하므로 커리큘럼이든 모듈 목록이든 같은 모양이면 적용된다.
 */
export function findScaleColumns(columns: string[]): ScaleColumns | null {
  const at = (pattern: RegExp) => {
    const index = columns.findIndex((column) => pattern.test(column.trim()));
    return index >= 0 ? index : null;
  };
  const group = at(SCALE_GROUP_COLUMN);
  const count = at(SCALE_COUNT_COLUMN);
  if (group === null || count === null) return null;
  const done = at(SCALE_DONE_COLUMN);
  const name = columns.findIndex((_, index) => index !== group && index !== count && index !== done);
  if (name < 0) return null;
  return { group, name, count, done };
}

function ScaleMap({ artifact, cols }: { artifact: ProcedureArtifact; cols: ScaleColumns }) {
  const groups: { name: string; items: { name: string; count: number; done: number }[] }[] = [];
  let widest = 1;
  let total = 0;
  let cleared = 0;
  for (const row of artifact.rows) {
    const count = cellNumber(row[cols.count]) ?? 0;
    const done = cols.done === null ? 0 : (cellNumber(row[cols.done]) ?? 0);
    const key = (row[cols.group] ?? "").trim();
    let group = groups.find((entry) => entry.name === key);
    if (!group) {
      group = { name: key, items: [] };
      groups.push(group);
    }
    group.items.push({ name: (row[cols.name] ?? "").trim(), count, done });
    widest = Math.max(widest, count);
    total += count;
    cleared += done;
  }
  return (
    <div className="curri-map">
      {groups.map((group) => {
        const sum = group.items.reduce((acc, item) => acc + item.count, 0);
        const hit = group.items.reduce((acc, item) => acc + item.done, 0);
        return (
          <section className="curri-group" key={group.name}>
            <header className="curri-group-head">
              <h4>{group.name}</h4>
              <span className="curri-group-count">
                <b>{hit}</b> / {sum}
              </span>
            </header>
            <ul className="curri-rows">
              {group.items.map((item) => {
                const state = item.count > 0 && item.done >= item.count ? "done" : item.done > 0 ? "running" : "idle";
                return (
                  <li className={`curri-row is-${state}`} key={item.name}>
                    <span className="curri-name">{item.name}</span>
                    <span className="curri-bar">
                      <span className="curri-len" style={{ width: `${(item.count / widest) * 100}%` }}>
                        <span
                          className="curri-fill"
                          style={{ width: `${item.count > 0 ? (item.done / item.count) * 100 : 0}%` }}
                        />
                      </span>
                    </span>
                    <span className="curri-n">{item.count}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <footer className="curri-total">
        <span>전체</span>
        <strong>
          {cleared} / {total}
        </strong>
        <span className="curri-left">남음 {total - cleared}</span>
      </footer>
    </div>
  );
}

const GAUGE_LABEL_COLUMN = /^(영역|지표|항목)$/i;
const GAUGE_NOW_COLUMN = /^(현재|실적|now)$/i;
const GAUGE_TARGET_COLUMN = /^(목표|target)$/i;
const GAUGE_MIN_COLUMN = /^(하한|최소|min)$/i;
const GAUGE_MAX_COLUMN = /^(상한|최대|max)$/i;

export interface GaugeColumns {
  label: number;
  now: number;
  target: number;
  min: number | null;
  max: number | null;
}

/**
 * 목표치 표(영역·현재·목표·하한·상한)는 숫자 격자가 아니라 **계기판**이다.
 * 행마다 0부터 상한까지의 트랙에 현재를 채우고 목표에 눈금을 세운다.
 *
 * 현재 컬럼이 없으면 계기판이 아니다 -- 바늘 없는 눈금만 남아 표보다 못하다.
 */
export function findGaugeColumns(columns: string[]): GaugeColumns | null {
  const at = (pattern: RegExp) => {
    const index = columns.findIndex((column) => pattern.test(column.trim()));
    return index >= 0 ? index : null;
  };
  const label = at(GAUGE_LABEL_COLUMN);
  const target = at(GAUGE_TARGET_COLUMN);
  const now = at(GAUGE_NOW_COLUMN);
  if (label === null || target === null || now === null) return null;
  return { label, now, target, min: at(GAUGE_MIN_COLUMN), max: at(GAUGE_MAX_COLUMN) };
}

function TargetGauges({ artifact, cols }: { artifact: ProcedureArtifact; cols: GaugeColumns }) {
  return (
    <ul className="gauge-list">
      {artifact.rows.map((row, index) => {
        const target = cellNumber(row[cols.target]);
        const now = cellNumber(row[cols.now]);
        const min = cols.min === null ? null : cellNumber(row[cols.min]);
        const max = cols.max === null ? null : cellNumber(row[cols.max]);
        const ceiling = Math.max(max ?? 0, target ?? 0, now ?? 0);
        const pct = (value: number) => (ceiling > 0 ? Math.min(100, Math.max(0, (value / ceiling) * 100)) : 0);
        const met = now !== null && target !== null && now >= target;
        return (
          <li className={`gauge-row${met ? " is-met" : ""}`} key={`${row[cols.label] ?? ""}-${index}`}>
            <span className="gauge-label">{row[cols.label] ?? ""}</span>
            <span className="gauge-track">
              {now === null ? null : <span className="gauge-fill" style={{ width: `${pct(now)}%` }} />}
              {min !== null && min > 0 ? <span className="gauge-floor" style={{ left: `${pct(min)}%` }} /> : null}
              {target === null ? null : <span className="gauge-mark" style={{ left: `${pct(target)}%` }} />}
            </span>
            <span className="gauge-nums">
              <b>{now === null ? "—" : row[cols.now]}</b>
              <i>/ {row[cols.target] ?? ""}</i>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const ROADMAP_GATE_COLUMN = /관문|통과|목표|점수/;
const ROADMAP_DONE_COLUMN = /완료|기준/;
const ROADMAP_AGENT_COLUMN = /agent|에이전트|준비/i;
const ROADMAP_CHECKLIST_COLUMN = /세부\s*계획|체크리스트|일일\s*과제/;
const CHECKLIST_ITEM_SPLIT = /\s+·\s+/;
const CHECKLIST_ITEM_LABEL = /^([^:：]{1,6}[:：])\s*(.+)$/;

/**
 * "방향" 마일스톤 표를 카드 레일로 보여준다. 컬럼 이름으로만 분류하므로
 * 어떤 프로젝트의 방향.md든 (제목열 + 관문/Agent/완료 계열 컬럼) 모양이면 적용된다.
 */
function RoadmapTrack({ artifact }: { artifact: ProcedureArtifact }) {
  const restColumns = artifact.columns.slice(1);
  return (
    <div className="roadmap-track-wrap">
      <div className="roadmap-track">
        <div className="roadmap-rail" aria-hidden="true" />
        {artifact.rows.map((row, index) => (
          <article className="roadmap-card" key={`${row[0] ?? ""}-${index}`}>
            <div className="roadmap-card-head">
              <span className="roadmap-badge">{index + 1}</span>
              <h4>{row[0] ?? ""}</h4>
            </div>
            <div className="roadmap-card-body">
              {restColumns.map((column, colIndex) => {
                const value = row[colIndex + 1] ?? "";
                if (!value) return null;
                if (ROADMAP_GATE_COLUMN.test(column)) {
                  return (
                    <span className="roadmap-gate" key={column}>
                      {value}
                    </span>
                  );
                }
                if (ROADMAP_CHECKLIST_COLUMN.test(column)) {
                  const items = value
                    .split(CHECKLIST_ITEM_SPLIT)
                    .map((item) => item.trim())
                    .filter(Boolean);
                  return (
                    <div className="roadmap-field roadmap-field-checklist" key={column}>
                      <div className="roadmap-field-label">{column}</div>
                      <ul className="roadmap-checklist">
                        {items.map((item, itemIndex) => {
                          const match = CHECKLIST_ITEM_LABEL.exec(item);
                          return (
                            <li key={itemIndex}>
                              {match ? (
                                <>
                                  <b>{match[1]}</b> {match[2]}
                                </>
                              ) : (
                                item
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                }
                const kind = ROADMAP_DONE_COLUMN.test(column) ? "done" : ROADMAP_AGENT_COLUMN.test(column) ? "agent" : "field";
                return (
                  <div className={`roadmap-field roadmap-field-${kind}`} key={column}>
                    <div className="roadmap-field-label">{column}</div>
                    <div className="roadmap-field-value">
                  <InlineText text={value} />
                </div>
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

const BOX_W = 140;
const BOX_H = 40;
const PHASE_BOX_W = 168;
const PHASE_BOX_H = 56;

function phaseLabel(phase: WorkLogPhase | undefined): string | null {
  if (phase === "done") return "완료";
  if (phase === "running") return "진행 중";
  if (phase === "idle") return "예정";
  return null;
}

function ProcedureDiagram({
  artifact,
  phases,
}: {
  artifact: ProcedureArtifact;
  phases?: Map<string, WorkLogPhase>;
}) {
  const boxW = phases ? PHASE_BOX_W : BOX_W;
  const boxH = phases ? PHASE_BOX_H : BOX_H;
  const graphNodes = artifact.nodes.map((node) => ({ id: node.id, portId: `node:${node.id}` }));
  const graphEdges = artifact.edges.map((edge) => ({ from: edge.from, to: edge.to, kind: "next" }));
  const positions = layout(graphNodes, graphEdges);
  let width = boxW + 24;
  let height = boxH + 24;
  for (const node of artifact.nodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;
    width = Math.max(width, pos.x + boxW + 24);
    height = Math.max(height, pos.y + boxH + 24);
  }
  return (
    <div className="proc-diagram" style={{ width, height }}>
      <svg className="proc-diagram-edges" width={width} height={height} aria-hidden="true">
        {artifact.edges.map((edge) => {
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);
          if (!from || !to) return null;
          return (
            <line
              key={`${edge.from}-${edge.to}`}
              x1={from.x + boxW}
              y1={from.y + boxH / 2}
              x2={to.x}
              y2={to.y + boxH / 2}
            />
          );
        })}
      </svg>
      {artifact.nodes.map((node) => {
        const pos = positions.get(node.id) ?? { x: 0, y: 0 };
        const phase = phases?.get(node.label);
        const mark = phaseLabel(phase);
        return (
          <div
            key={node.id}
            className={`proc-diagram-node${phase ? ` is-${phase}` : ""}`}
            style={{ left: pos.x, top: pos.y, width: boxW, minHeight: boxH }}
          >
            {node.label}
            {mark ? <span className="proc-diagram-phase">{mark}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

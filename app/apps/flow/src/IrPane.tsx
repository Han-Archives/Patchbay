import { useEffect, useMemo, useState } from "react";
import { Background, Controls, Position, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { IrCellEditor } from "./IrCellEditor.js";
import { PhaseRail, PhaseWindow, type PhaseStep, type PhaseTone } from "./IrPhaseRail.js";
import { RefitOnChange } from "./RefitOnChange.js";
import { irNodeText, shortEdgeLabel, stateTraffic, toIrCanvas } from "./irCanvas.js";
import {
  CELL_FILL_LABEL,
  GATE_STATUS_LABEL,
  countCompleteCells,
  isPartialCell,
  phaseOf,
  type IrAdoptResponse,
  type IrCheckResult,
  type IrGateCellView,
  type IrViewReady,
  type IrStartDraftResponse,
  type IrDraftProgress,
  type IrViewDrafting,
  type IrViewResponse,
} from "./irContract.js";
import "@xyflow/react/dist/style.css";

/**
 * The 설계 segment: 1단계의 열 칸을 화면에서 통과시키는 자리 (구현준비 M3).
 *
 * Not a fifth tab (architecture-map forbids one) -- a third segment inside the
 * 프로젝트 tab, beside 개발 and 구조.
 *
 * The screen's job is to answer two questions without reading a file: **어느
 * 칸이 막혔나**, and **무엇을 고쳐야 하나**. So every panel is anchored to a
 * cell number, and the check results name the cell rather than a field path.
 *
 * 칸은 Phase 1~9 와 최종 검사로 위에서 아래로 그리고, 누른 칸의 창만 그 아래에 연다.
 */
export function IrPane({
  project,
  revision = 0,
  onOpenFile,
  onGoBuild,
}: {
  project: string;
  /** Bumped by the SSE `overlay` event -- editing the draft's State re-runs the checks here. */
  revision?: number;
  onOpenFile?: (path: string) => void;
  /** 채택한 뒤 2단계로 가는 길. 채택이 끝난 자리에서 다음 단계를 내준다. */
  onGoBuild?: () => void;
}) {
  const [view, setView] = useState<IrViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"current" | "proposed" | null>(null);
  const [tick, setTick] = useState(0);
  const [adopting, setAdopting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [adoptNote, setAdoptNote] = useState<string | null>(null);
  // 채택이 됐을 때만 2단계 입구를 낸다 — 실패한 채택 뒤에 다음 단계를 권하면 거짓말이 된다.
  const [adopted, setAdopted] = useState(false);
  // 여기 둔다 — 마지막 칸을 채워 진행 화면이 판정 화면으로 바뀌어도 고른 칸이 남는다.
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ alias: project });
    if (source) query.set("source", source);
    fetch(`/api/ir?${query.toString()}`)
      .then(async (res) => {
        const body = (await res.json()) as IrViewResponse | { error: string };
        if (cancelled) return;
        // `drafting`·`broken` 도 `error` 를 싣는다 — 실패는 `status` 가 없는 응답이다.
        if (!res.ok || !("status" in body)) {
          setError("error" in body ? body.error : `HTTP ${res.status}`);
          return;
        }
        setError(null);
        setView(body);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [project, source, tick, revision]);

  useEffect(() => {
    setSource(null);
    setAdoptNote(null);
    setSelected(null);
  }, [project]);

  async function startDraft() {
    setStarting(true);
    setAdoptNote(null);
    try {
      const res = await fetch("/api/ir/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: project }),
      });
      const body = (await res.json()) as IrStartDraftResponse;
      // 성공 문구는 두지 않는다 — 진행 화면이 초안 파일을 보여 주고, 남겨 두면 채택 화면까지 따라온다.
      if (!body.ok) setAdoptNote(body.error ?? "초안을 만들지 못했다");
      setTick((n) => n + 1);
    } catch (err) {
      setAdoptNote(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  async function adopt() {
    setAdopting(true);
    setAdoptNote(null);
    try {
      const res = await fetch("/api/ir/adopt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: project }),
      });
      const body = (await res.json()) as IrAdoptResponse;
      setAdoptNote(
        body.ok
          ? `채택했다 — v${body.version}${body.previousVersion ? ` (이전 v${body.previousVersion} 보관)` : ""}`
          : (body.error ?? "채택하지 못했다"),
      );
      setAdopted(body.ok);
      setSource("current");
      setTick((n) => n + 1);
    } catch (err) {
      setAdoptNote(err instanceof Error ? err.message : String(err));
    } finally {
      setAdopting(false);
    }
  }

  if (error) {
    return (
      <div className="empty">
        <p>{error}</p>
      </div>
    );
  }
  if (!view) return <p>불러오는 중</p>;

  if (view.status === "missing") {
    return (
      <div className="empty">
        <p>아직 설계(IR)가 없다 — 1단계를 시작하지 않았다.</p>
        <p className="path">
          시작하면 Phase 1~9가 <b>빈 채로</b> 위에서 아래로 뜬다. 무엇을 채워야 하는지가 화면에 보이고, 다 채우면 채택할 수 있다.
        </p>
        <button type="button" className="flow-btn" data-action="start-draft" onClick={() => void startDraft()} disabled={starting}>
          {starting ? "만드는 중" : "1단계 시작"}
        </button>
        {adoptNote ? <p className="ir-note">{adoptNote}</p> : null}
      </div>
    );
  }

  if (view.status === "drafting") {
    return (
      <IrDrafting
        view={view}
        note={adoptNote}
        project={project}
        selected={selected}
        onSelect={setSelected}
        onRefresh={() => setTick((n) => n + 1)}
      />
    );
  }

  if (view.status === "broken") {
    return (
      <div className="empty">
        <p>승인된 IR을 읽지 못했다 — 통과했던 설계가 깨졌다.</p>
        <pre className="ir-error">{view.error}</pre>
        <p className="path">
          <code>overlay.yaml</code>의 <code>ir</code> 절을 확인한다. 보관본은{" "}
          <code>versions/&lt;n&gt;/ir.yaml</code>에 있다.
        </p>
      </div>
    );
  }

  return (
    <IrReady
      view={view}
      project={project}
      selected={selected}
      onSelect={setSelected}
      onSource={setSource}
      onAdopt={adopt}
      adopting={adopting}
      adoptNote={adoptNote}
      {...(adopted && onGoBuild ? { onGoBuild } : {})}
      onRefresh={() => setTick((n) => n + 1)}
      onOpenFile={onOpenFile}
    />
  );
}

const PICK_HINT = "왼쪽 칸을 누르면 여기서 보고, 적고, 고칩니다.";

/**
 * 1단계 중 — 초안은 있는데 아직 IR로 읽히지 않는다.
 *
 * 이 상태가 1단계의 대부분이다. 그래서 「못 읽었다」가 아니라 「어디까지 왔나」를
 * 먼저 보여 준다. 오류 문장은 최종 검사 창에 두되 지우지는 않는다 — 형식이 깨진 것과
 * 아직 안 채운 것은 다르고, 사람이 그 둘을 구분해야 할 때가 온다.
 */
function IrDrafting({
  view,
  note,
  project,
  selected,
  onSelect,
  onRefresh,
}: {
  view: IrViewDrafting;
  note: string | null;
  project: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onRefresh: () => void;
}) {
  const [progress, setProgress] = useState<IrDraftProgress>(view.progress);
  useEffect(() => setProgress(view.progress), [view.progress]);

  // 키 하나만 적어도 「답한」 칸이지만, 프로세스에서는 다 적은 칸과 갈려야 어디서 멈췄는지 보인다.
  const partial = isPartialCell;
  const complete = countCompleteCells(progress);

  const steps: PhaseStep[] = [
    ...progress.cells.map((cell) => ({
      id: cell.id,
      label: cell.label,
      tone: (partial(cell) ? "partial" : cell.fill === "filled" ? "ok" : cell.fill) as PhaseTone,
      status: partial(cell) ? "일부 적음" : CELL_FILL_LABEL[cell.fill],
      detail: cell.missing.length ? (
        <>
          <span>아직:</span>
          {cell.missing.map((key) => (
            <code className="ir-cell-key" key={key}>
              {key}
            </code>
          ))}
        </>
      ) : (
        <span className="ir-cell-done">{cell.fixes}</span>
      ),
    })),
    {
      id: "1.9",
      label: "설계 규칙 검사",
      tone: "locked",
      status: `${complete} / ${progress.total} 다 적음`,
      detail: "아홉 Phase를 다 적으면 검사가 돌고 채택이 열린다",
    },
  ];
  const openCell = selected ? progress.cells.find((cell) => cell.id === selected) : undefined;

  return (
    <div className="ir">
      <header className="ir-head">
        <b>1단계 진행 중</b>
        <span className="ir-note-inline">
          아홉 Phase 중 <b>{complete}</b>개를 다 적었다
          {progress.answered > complete ? ` · ${progress.answered - complete}개는 일부만` : ""}
        </span>
        <span className="ir-grow" />
        <span className="ir-gate-status ir-warn">아직 채택할 수 없다</span>
      </header>

      <PhaseRail steps={steps} selected={selected} onSelect={onSelect} guides={view.guides}>
        {openCell ? (
          <IrCellEditor
            project={project}
            cellId={openCell.id}
            cellLabel={openCell.label}
            fields={view.fields[openCell.id] ?? []}
            guide={view.guides?.[openCell.id]}
            doc={view.doc}
            onSaved={(next) => {
              setProgress(next);
              onRefresh();
            }}
            onClose={() => onSelect(null)}
          />
        ) : selected === "1.9" ? (
          <PhaseWindow id="1.9" label="설계 규칙 검사" onClose={() => onSelect(null)}>
            <p className="ir-note">
              검사는 초안이 IR로 읽힐 때 돈다. 지금은 아래 이유로 아직 읽히지 않는다 — 대부분은 앞 Phase가 비어서다.
            </p>
            <pre className="ir-error">{view.error}</pre>
          </PhaseWindow>
        ) : (
          <p className="ir-note phase-pick">{PICK_HINT}</p>
        )}
      </PhaseRail>

      <p className="ir-note">
        초안 파일: <code>{view.file}</code> — 화면 대신 직접 고쳐도 된다.
        <br />
        <code>[]</code>는 「없는 것이 답이다」라는 뜻이라 「아직」과 다르게 센다.
      </p>
      {note ? <p className="ir-note">{note}</p> : null}
    </div>
  );
}

const GATE_TONE: Record<IrGateCellView["status"], PhaseTone> = {
  pass: "ok",
  fail: "fail",
  invalid: "invalid",
  unknown: "unknown",
};

function phaseName(cellId: string): string {
  const phase = phaseOf(cellId);
  return phase !== null ? `Phase ${phase}` : cellId;
}

function IrReady({
  view,
  project,
  selected,
  onSelect,
  onSource,
  onAdopt,
  adopting,
  adoptNote,
  onRefresh,
  onOpenFile,
  onGoBuild,
}: {
  view: IrViewReady;
  project: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onSource: (source: "current" | "proposed") => void;
  onAdopt: () => void;
  adopting: boolean;
  adoptNote: string | null;
  onRefresh: () => void;
  onOpenFile?: (path: string) => void;
  /** 방금 채택했을 때만 온다. */
  onGoBuild?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [selected, view.source]);

  // 고치는 것은 초안에서만 — 승인된 판은 `ir adopt` 로만 바뀐다 (명세 §2.3).
  const canEdit = view.source === "proposed" && view.hasProposed;

  const steps: PhaseStep[] = view.gates.map((gate) => ({
    id: gate.id,
    label: gate.label,
    tone: GATE_TONE[gate.status],
    status: GATE_STATUS_LABEL[gate.status],
    detail: gateDetail(gate, view),
  }));
  const gate = selected ? view.gates.find((entry) => entry.id === selected) : undefined;
  const fields = gate ? view.fields[gate.id] : undefined;

  return (
    <section className="ir">
      <header className="ir-head">
        <div className="seg" role="tablist" aria-label="어느 판을 보나">
          <button
            type="button"
            role="tab"
            aria-selected={view.source === "proposed"}
            className={`seg-btn${view.source === "proposed" ? " is-on" : ""}`}
            disabled={!view.hasProposed}
            onClick={() => onSource("proposed")}
          >
            초안
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view.source === "current"}
            className={`seg-btn${view.source === "current" ? " is-on" : ""}`}
            disabled={!view.hasCurrent}
            onClick={() => onSource("current")}
          >
            승인됨{view.currentVersion ? ` v${view.currentVersion}` : ""}
          </button>
        </div>
        <span className={`ir-verdict${view.passed ? " is-pass" : " is-fail"}`}>
          {view.passed ? "검사 통과" : `돌아갈 곳: ${view.failedGates.map(phaseName).join(" · ")}`}
        </span>
        <button type="button" className="ir-adopt" disabled={!view.canAdopt || adopting} onClick={onAdopt}>
          {adopting ? "채택하는 중" : "이 초안을 채택"}
        </button>
      </header>
      {/* 채택할 수 없는 이유는 버튼 옆에 둔다 — 눌러 보고 알게 하지 않는다. */}
      {!view.canAdopt && view.adoptBlockedBy ? <p className="ir-blocked">{view.adoptBlockedBy}</p> : null}
      {adoptNote ? (
        <p className="ir-note ir-adopted">
          <span>{adoptNote}</span>
          {/* 채택 뒤의 다음 걸음을 이 자리에서 내준다 — 사람이 어디로 가야 하는지 찾지 않게. */}
          {onGoBuild ? (
            <button type="button" className="flow-btn primary" onClick={onGoBuild}>
              2 구현으로 — 뼈대 생성
            </button>
          ) : null}
        </p>
      ) : null}

      <PhaseRail steps={steps} selected={selected} onSelect={onSelect} guides={view.guides}>
        {!gate ? (
          <p className="ir-note phase-pick">{PICK_HINT}</p>
        ) : editing && canEdit && fields ? (
          <IrCellEditor
            project={project}
            cellId={gate.id}
            cellLabel={gate.label}
            fields={fields}
            guide={view.guides?.[gate.id]}
            doc={view.ir as unknown as Record<string, unknown>}
            onSaved={() => onRefresh()}
            onClose={() => setEditing(false)}
          />
        ) : (
          <PhaseWindow
            id={gate.id}
            label={gate.label}
            guide={view.guides?.[gate.id]}
            onClose={() => onSelect(null)}
            actions={
              canEdit && fields ? (
                <button type="button" className="flow-btn" data-action="edit-cell" onClick={() => setEditing(true)}>
                  이 Phase 고치기
                </button>
              ) : null
            }
          >
            {gate.id === "1.9" ? (
              <FinalCheck view={view} />
            ) : (
              <>
                <FailedChecks checks={view.checks.filter((check) => check.gate === gate.id && check.ok === false)} />
                {gate.status === "invalid" ? (
                  <p className="ir-note">다른 Phase가 막혀서 같이 무효가 됐다 — 그쪽을 고친 뒤 이 Phase를 다시 확인한다.</p>
                ) : null}
                <ReadyCellBody id={gate.id} view={view} onOpenFile={onOpenFile} />
              </>
            )}
          </PhaseWindow>
        )}
      </PhaseRail>
    </section>
  );
}

/** 프로세스 한 줄 아래에 붙는 설명 — 막혔으면 무엇이, 아니면 무엇을 적는 칸인가. */
function gateDetail(gate: IrGateCellView, view: IrViewReady) {
  if (gate.id === "1.9") {
    return view.passed ? "아홉 Phase가 다 통과했다" : `돌아갈 곳: ${view.failedGates.map(phaseName).join(" · ")}`;
  }
  if (gate.failed.length) {
    return (
      <>
        <span>막힌 검사:</span>
        {gate.failed.map((id) => (
          <code className="ir-cell-key" key={id}>
            {id}
          </code>
        ))}
      </>
    );
  }
  if (gate.status === "invalid") return "다른 Phase 때문에 무효 — 그쪽을 고친 뒤 다시 확인";
  // 통과한 칸은 오른쪽 「통과」가 다 말한다 — 칸 키를 또 늘어놓으면 목록이 개발 말로 덮인다.
  return undefined;
}

function FailedChecks({ checks }: { checks: IrCheckResult[] }) {
  if (!checks.length) return null;
  return (
    <div className="phase-fails">
      <h4>막힌 검사 {checks.length}</h4>
      <ul className="ir-fails">
        {checks.map((check) => (
          <li key={check.id}>
            <code>{check.id}</code>
            {check.note ? <span className="ir-note-inline"> — {check.note}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 최종 검사 창 — 아홉 Phase 전체의 판정과, 승인된 판과의 차이. */
function FinalCheck({ view }: { view: IrViewReady }) {
  const failed = view.checks.filter((check) => check.ok === false);
  const skipped = view.checks.filter((check) => check.ok === null);
  return (
    <>
      <p className="ir-note">
        검사 {view.checks.length}개 중 통과 {view.checks.filter((check) => check.ok === true).length} · 막힘 {failed.length}
        {skipped.length ? ` · 판정 안 함 ${skipped.length}` : ""}
      </p>
      <FailedChecks checks={failed} />
      {view.invalidated.length ? (
        <p className="ir-note">
          같이 무효가 된 곳: {view.invalidated.map(phaseName).join(" · ")} — 고친 뒤 다시 확인한다.
        </p>
      ) : null}
      {skipped.length ? (
        <p className="ir-note">판정하지 않은 검사: {skipped.map((check) => check.id).join(", ")}</p>
      ) : null}

      {view.diff ? (
        <>
          <h4>승인된 판과의 차이</h4>
          {view.diff.identical ? (
            <p className="ir-note">차이 없음 — 채택해도 버전 번호만 오른다.</p>
          ) : (
            <ul className="ir-fails">
              {view.diff.scalars.map((line) => (
                <li key={line}>{line}</li>
              ))}
              {view.diff.sections.map((section) => (
                <li key={section.section}>
                  <code>{section.section}</code>
                  {section.added.length ? <span className="ir-add"> +{section.added.join(", ")}</span> : null}
                  {section.removed.length ? <span className="ir-del"> −{section.removed.join(", ")}</span> : null}
                  {section.changed.length ? <span className="ir-chg"> ~{section.changed.join(", ")}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </>
  );
}

/** Phase마다 그 칸이 적은 것. 관계가 있는 1.5는 회로로, 목록이 전부인 칸만 표로. */
function ReadyCellBody({
  id,
  view,
  onOpenFile,
}: {
  id: string;
  view: IrViewReady;
  onOpenFile?: (path: string) => void;
}) {
  const ir = view.ir;
  const canvas = useMemo(() => toIrCanvas(ir), [ir]);
  const traffic = useMemo(() => stateTraffic(ir), [ir]);

  const KIND: Record<string, string> = { input: "받는 것", output: "내놓는 것", enum: "정해진 값", resource: "미리 있는 자료", internal: "안쪽" };
  const CARD: Record<string, string> = { one: "정확히 하나", optional: "없거나 하나", many: "여럿" };
  const PRIORITY: Record<string, string> = { must: "꼭", should: "있으면 좋음", could: "나중에" };
  const label = (cid: string) => ir.concepts.find((c) => c.id === cid)?.label ?? cid;

  switch (id) {
    case "0.0":
      return (
        <>
          <table className="ir-table">
            <thead>
              <tr>
                <th>개념</th>
                <th>코드 이름</th>
                <th>종류</th>
                <th>값 목록</th>
              </tr>
            </thead>
            <tbody>
              {ir.concepts.map((c) => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td>
                    <code>{c.id}</code>
                  </td>
                  <td>{KIND[c.kind] ?? c.kind}</td>
                  <td>{c.values.join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ir.relations.length ? (
            <ul className="ir-fails">
              {ir.relations.map((r) => (
                <li key={`${r.from}>${r.to}`}>
                  {label(r.from)} → {label(r.to)} · {CARD[r.cardinality] ?? r.cardinality}
                </li>
              ))}
            </ul>
          ) : null}
          {ir.competencyQuestions.length ? (
            <>
              <h4>역량 질문 — 이 관계로 답한다</h4>
              <ul className="ir-fails">
                {ir.competencyQuestions.map((q) => (
                  <li key={q.id}>
                    {q.text} <small className="muted">({label(q.from)} → {label(q.to)})</small>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {ir.rules.length ? (
            <>
              <h4>늘 참인 규칙</h4>
              <ul className="ir-fails">
                {ir.rules.map((r) => (
                  <li key={r.id}>{r.text}</li>
                ))}
              </ul>
            </>
          ) : null}
          {ir.references.length ? (
            <>
              <h4>참고 자료</h4>
              <div className="pv-refs">
                {ir.references.map((ref) =>
                  ref.kind === "image" ? (
                    <img key={ref.id} src={`/api/refs/raw?alias=${encodeURIComponent(view.alias)}&id=${ref.id}`} alt={ref.title} title={ref.title} />
                  ) : (
                    <span key={ref.id} className="pv-ref" title={ref.uri}>
                      {ref.kind === "link" ? "링크" : "파일"} · {ref.title}
                    </span>
                  ),
                )}
              </div>
            </>
          ) : null}
        </>
      );

    case "1.0":
      return (
        <dl className="phase-dl">
          <dt>모델 없이 하면</dt>
          <dd>{ir.why.alternative}</dd>
          <dt>표로 안 되는 일</dt>
          <dd>{ir.why.modelNeed}</dd>
          <dt>그래서 결론</dt>
          <dd>{ir.why.verdict}</dd>
          <dt>모델을 불러야 하나</dt>
          <dd>{ir.why.needsModel ? "예 — Phase 3·4·6이 따라 움직인다" : "아니오"}</dd>
          {ir.why.note ? (
            <>
              <dt>덧붙임</dt>
              <dd>{ir.why.note}</dd>
            </>
          ) : null}
        </dl>
      );

    case "1.1":
      return (
        <dl className="phase-dl">
          <dt>목적</dt>
          <dd>{ir.goal}</dd>
          <dt>완료 조건</dt>
          <dd>
            <ul className="ir-fails">
              {ir.done.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </dd>
          {ir.jobStory ? (
            <>
              <dt>일의 맥락</dt>
              <dd>{ir.jobStory}</dd>
            </>
          ) : null}
          {ir.riskLevel || ir.autonomy || ir.memory ? (
            <>
              <dt>위험 · 자율 · 기억</dt>
              <dd>
                틀리면 피해 {({ low: "조금 불편", medium: "시간 · 돈 손해", high: "사람에게 피해" } as Record<string, string>)[ir.riskLevel ?? ""] ?? "—"} · 자율{" "}
                {({ suggest: "제안만", approve: "확인 뒤 실행", notify: "실행 뒤 알림", full: "끝까지 알아서" } as Record<string, string>)[ir.autonomy ?? ""] ?? "—"} · 기억{" "}
                {({ none: "없음", thread: "한 대화 안", long: "오래" } as Record<string, string>)[ir.memory ?? ""] ?? "—"}
              </dd>
            </>
          ) : null}
          {ir.alternatives.length ? (
            <>
              <dt>검토한 대안</dt>
              <dd>
                <ul className="ir-fails">
                  {ir.alternatives.map((a) => (
                    <li key={a.what}>
                      {a.what} — {a.whyNot}
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          ) : null}
          {ir.openQuestions.length ? (
            <>
              <dt>아직 정하지 않은 것</dt>
              <dd>
                <ul className="ir-fails">
                  {ir.openQuestions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </dd>
            </>
          ) : null}
          {ir.stakeholders.length ? (
            <>
              <dt>쓰는 사람</dt>
              <dd>{ir.stakeholders.map((s) => `${s.role} — ${s.need}`).join(" / ")}</dd>
            </>
          ) : null}
          {ir.metrics.length ? (
            <>
              <dt>성공 지표</dt>
              <dd>
                <ul className="ir-fails">
                  {ir.metrics.map((m) => (
                    <li key={m.id}>
                      {m.what} — 목표: {m.target}
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          ) : null}
          {ir.nonGoals.length ? (
            <>
              <dt>하지 않는 것</dt>
              <dd>
                <ul className="ir-fails">
                  {ir.nonGoals.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </dd>
            </>
          ) : null}
          {ir.constraints.length ? (
            <>
              <dt>제약</dt>
              <dd>{ir.constraints.join(" · ")}</dd>
            </>
          ) : null}
          {ir.assumptions.length ? (
            <>
              <dt>가정</dt>
              <dd>{ir.assumptions.join(" · ")}</dd>
            </>
          ) : null}
        </dl>
      );

    case "1.2":
      return (
        <>
          <table className="ir-table">
            <thead>
              <tr>
                <th>권한</th>
                <th>무엇에</th>
                <th>되돌림</th>
                <th>사람 확인</th>
              </tr>
            </thead>
            <tbody>
              {ir.caps.map((cap) => (
                <tr key={cap.id}>
                  <td>
                    <code>{cap.id}</code>
                  </td>
                  <td>{cap.scope}</td>
                  <td>{cap.undo}</td>
                  <td>{cap.humanApproval ? "필요" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ir-note">
            모델 {ir.models.length}
            {ir.models.length ? ` (${ir.models.map((model) => model.id).join(", ")})` : ""} · 툴 {ir.tools.length}
            {ir.tools.some((tool) => tool.irreversible) ? " · 되돌릴 수 없는 툴 있음" : ""}
          </p>
        </>
      );

    case "1.3":
      return (
        <>
          <h4>읽는 것</h4>
          <table className="ir-table">
            <thead>
              <tr>
                <th>경로</th>
                <th>민감도</th>
                <th>왜</th>
              </tr>
            </thead>
            <tbody>
              {ir.reads.map((read) => (
                <tr key={read.path}>
                  <td>
                    <code>{read.path}</code>
                  </td>
                  <td>L{read.level}</td>
                  <td>{read.why ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4>내보내는 것</h4>
          {ir.emits.length ? (
            <table className="ir-table">
              <thead>
                <tr>
                  <th>무엇</th>
                  <th>민감도</th>
                  <th>어디로</th>
                  <th>근거</th>
                </tr>
              </thead>
              <tbody>
                {ir.emits.map((emit) => (
                  <tr key={`${emit.what}:${emit.to}`}>
                    <td>{emit.what}</td>
                    <td>L{emit.level}</td>
                    <td>{emit.to}</td>
                    <td>{emit.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="ir-note">없음으로 적었다 — 밖으로 나가는 것이 없다.</p>
          )}
        </>
      );

    case "1.4":
      return (
        <table className="ir-table">
          <thead>
            <tr>
              <th>값 이름</th>
              <th>종류</th>
              <th>합치는 법</th>
              <th>기본값</th>
              <th>쓰는 단계</th>
              <th>읽는 단계</th>
            </tr>
          </thead>
          <tbody>
            {ir.state.map((field) => {
              const flow = traffic.get(field.field);
              return (
                <tr key={field.field}>
                  <td>
                    <code>{field.field}</code>
                  </td>
                  <td>{field.type}</td>
                  <td>{field.reducer}</td>
                  <td>
                    <code>{field.default}</code>
                  </td>
                  <td>{flow?.writers.join(", ") || <span className="ir-warn">없음</span>}</td>
                  <td>{flow?.readers.join(", ") || <span className="ir-warn">없음</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      );

    case "1.5":
      return (
        <div className="ir-canvas">
          <ReactFlowProvider>
            <ReactFlow
              nodes={canvas.nodes.map((node) => ({
                id: node.id,
                position: node.position,
                data: { label: irNodeText(node) },
                sourcePosition: Position.Right,
                targetPosition: Position.Left,
                className: node.className,
              }))}
              edges={canvas.edges.map((edge) => ({ ...edge, label: shortEdgeLabel(edge.label) }))}
              fitView
              fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
              nodesDraggable={false}
              nodesConnectable={false}
              proOptions={{ hideAttribution: true }}
            >
              <RefitOnChange signature={`${canvas.nodes.length}:${canvas.edges.length}`} />
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      );

    case "1.6":
      return ir.documents.length ? (
        <table className="ir-table">
          <thead>
            <tr>
              <th>단계</th>
              <th>언제</th>
              <th>문서</th>
              <th>민감도</th>
            </tr>
          </thead>
          <tbody>
            {ir.documents.map((doc) => (
              <tr key={doc.id}>
                <td>{doc.node}</td>
                <td>{doc.when}</td>
                <td>
                  <button type="button" className="ir-path" onClick={() => onOpenFile?.(doc.path)}>
                    {doc.path}
                  </button>
                </td>
                <td>L{doc.level}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="ir-note">없음으로 적었다 — 노드가 기대는 문서가 없다.</p>
      );

    case "1.7":
      return (
        <table className="ir-table">
          <thead>
            <tr>
              <th>규칙</th>
              <th>우선순위</th>
              <th>패턴</th>
              <th>문장</th>
              <th>적합 기준</th>
            </tr>
          </thead>
          <tbody>
            {ir.requirements.map((requirement) => (
              <tr key={requirement.id}>
                <td>
                  <code>{requirement.id}</code>
                </td>
                <td>{PRIORITY[requirement.priority ?? "must"]}</td>
                <td>
                  {requirement.pattern}
                  {requirement.kind && requirement.kind !== "functional" ? ` · ${requirement.kind === "quality" ? "품질" : "제약"}` : ""}
                </td>
                <td>{requirement.text}</td>
                <td>{requirement.fit ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );

    case "1.8":
      return (
        <>
          <h4>평가</h4>
          <table className="ir-table">
            <thead>
              <tr>
                <th>시험</th>
                <th>단계</th>
                <th>종류</th>
                <th>넣을 것</th>
                <th>기대</th>
              </tr>
            </thead>
            <tbody>
              {ir.evals.map((evaluation) => (
                <tr key={evaluation.id}>
                  <td>
                    <code>{evaluation.id}</code>
                  </td>
                  <td>{evaluation.node}</td>
                  <td>{evaluation.kind}</td>
                  <td>{evaluation.input}</td>
                  <td>{evaluation.expect}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4>추적 표 — 요구사항 × 노드 × 평가</h4>
          <table className="ir-table">
            <thead>
              <tr>
                <th>요구사항</th>
                <th>패턴</th>
                <th>단계</th>
                <th>시험</th>
              </tr>
            </thead>
            <tbody>
              {ir.requirements.map((requirement) => {
                const links = ir.requirementLinks.filter((link) => link.requirement === requirement.id);
                return (
                  <tr key={requirement.id}>
                    <td title={requirement.text}>
                      <code>{requirement.id}</code>
                    </td>
                    <td>{requirement.pattern}</td>
                    <td>{links.map((link) => link.node).join(", ") || <span className="ir-warn">빈 칸</span>}</td>
                    <td>{links.map((link) => link.eval).join(", ") || <span className="ir-warn">빈 칸</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      );

    default:
      return null;
  }
}

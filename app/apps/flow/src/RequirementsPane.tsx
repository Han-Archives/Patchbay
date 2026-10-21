import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Background, Controls, ReactFlow, ReactFlowProvider, type Edge, type Node } from "@xyflow/react";
import type { RequirementWorkspace, RequirementRow, RequirementDetail } from "@patchbay/core";
import { ChatText } from "./ChatText.js";
import { RefitOnChange } from "./RefitOnChange.js";
import { layout } from "./layout.js";
import "@xyflow/react/dist/style.css";
import "./requirements.css";

const text = (v: unknown): string => typeof v === "string" ? v : "";
const words = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
const rec = (v: unknown): Record<string, unknown> => v && typeof v === "object" ? v as Record<string, unknown> : {};
const CHANGE_LABEL = { same: "유지", added: "추가", changed: "변경", removed: "제외" };
const DECISION_LABEL = { approved: "검토 확정", held: "보류", pending: "검토 대기" };
const FIELD_LABEL: Record<string, string> = {
  text: "요구사항 문장", summary: "짧은 제목", group: "기능 묶음", goal: "목적", pattern: "적용 상황",
  condition: "조건·사건", response: "시스템 반응", exceptions: "경계·예외", acceptance: "합격 예시",
  fit: "수치 기준", openQuestions: "미결 질문", changeReason: "변경 이유", sourceRef: "대화 출처",
  priority: "우선순위", kind: "요구사항 종류", note: "메모", nodes: "흐름 단계", edges: "흐름 연결선",
  tests: "시험 계획", links: "요구사항·흐름·시험 연결",
};
type Filter = "all" | "changes" | "impact" | "questions" | "approved";
type DetailTab = "detail" | "diff" | "flow" | "history";
interface Evidence {
  reference: { kind: string; id: string; turn?: number } | null;
  messages: { turn: number; role: string; at: string; text: string }[];
  note: string;
}

export function RequirementsPane({ project, revision, readOnly = false, onConsult, onManage, onAdopt, onGoBuild }: {
  project: string; revision: number; readOnly?: boolean; onConsult: (note?: string) => void;
  onManage: () => void; onAdopt: () => void; onGoBuild: () => void;
}) {
  const [view, setView] = useState<RequirementWorkspace | null>(null);
  const [source, setSource] = useState<"current" | "proposed">("proposed");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState(""), [group, setGroup] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>("diff");
  const [checks, setChecks] = useState<Set<string>>(new Set());
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false), [tick, setTick] = useState(0);
  const [editor, setEditor] = useState<{ row: RequirementRow | null; snapshot: RequirementWorkspace } | null>(null);
  const [summary, setSummary] = useState(false), [evidence, setEvidence] = useState<Evidence | null>(null);
  const focusRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetch("/api/requirements?" + new URLSearchParams({ alias: project, source }), { signal: controller.signal })
      .then(async res => { const b = await res.json(); if (!res.ok) throw Error(b.error ?? "요구사항을 읽지 못했습니다."); return b as RequirementWorkspace; })
      .then(body => { if (!controller.signal.aborted) setView(body); })
      .catch((e: Error) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [project, source, revision, tick]);
  const rows = view?.rows ?? [];
  const changed = rows.filter(r => r.change !== "same");
  const visible = useMemo(() => rows.filter(r => {
    const d = r.after ?? r.before, q = query.toLowerCase();
    return (!group || r.group === group) && (!q || (r.id + " " + r.title + " " + JSON.stringify(d?.requirement)).toLowerCase().includes(q)) &&
      (filter === "all" || filter === "changes" && r.change !== "same" || filter === "impact" && r.impactBy.length > 0 ||
        filter === "questions" && words(d?.requirement.openQuestions).length > 0 || filter === "approved" && r.decision === "approved");
  }), [rows, group, query, filter]);
  const row = rows.find(r => r.id === selected) ?? visible[0] ?? rows[0] ?? null;
  const display = row?.after ?? row?.before;
  const canWrite = !readOnly && !busy && !view?.draftError;
  const currentOnly = view?.source === "current";
  useEffect(() => {
    setEvidence(null);
    if (!row || !view) return;
    const controller = new AbortController();
    fetch("/api/requirements/evidence?" + new URLSearchParams({ alias: project, source: view.source, id: row.id }), { signal: controller.signal })
      .then(async r => { const b = await r.json(); if (!r.ok) throw Error(b.error); return b as Evidence; })
      .then(b => { if (!controller.signal.aborted) setEvidence(b); })
      .catch((e: Error) => { if (!controller.signal.aborted) setEvidence({ reference: null, messages: [], note: e.message }); });
    return () => controller.abort();
  }, [project, row?.id, row?.digest, view?.source, revision, tick]);
  useEffect(() => { setChecks(s => new Set([...s].filter(id => rows.some(r => r.id === id && r.change !== "same")))); }, [view]);
  async function mutate(url: string, payload: object) {
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: project, ...payload }) });
      const body = await res.json();
      if (!res.ok) { if (res.status === 409) setTick(n => n + 1); throw Error(body.error ?? "저장하지 못했습니다."); }
      setView(body as RequirementWorkspace); setSource("proposed"); setTick(n => n + 1);
      return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  }
  async function mark(items: RequirementRow[], action: "approved" | "held" | "pending") {
    if (!items.length) return;
    const ok = await mutate("/api/requirements/review", { items: items.map(r => ({ id: r.id, digest: r.digest })), action });
    if (ok) { setChecks(new Set()); setNotice(items.length + "건을 " + DECISION_LABEL[action] + " 상태로 저장했습니다. 설계 판 전체의 채택은 PRD에서 진행합니다."); }
  }
  function choose(id: string) {
    setSelected(id);
    if (window.matchMedia("(max-width:720px)").matches) focusRef.current?.scrollIntoView({ block: "start" });
  }
  function chooseFilter(f: Filter) { setFilter(f); setSelected(null); }
  function jump(id: string) { setFilter("all"); setQuery(""); setGroup(""); setSelected(id); setTab("diff"); }
  function ask(r?: RequirementRow) {
    onConsult(r ? "요구사항 " + r.id + "를 구체화하거나 수정해 주세요. ID를 유지하고 다른 요구사항을 보존하세요.\n현재 내용: " +
      JSON.stringify((r.after ?? r.before)?.requirement) + "\n미결·검토할 항목: " + r.blockers.join(" ") +
      "\n상담에서 답을 확인한 뒤 exceptions, acceptance, openQuestions, changeReason과 연결된 흐름·시험을 초안에 반영해주세요." : undefined);
  }
  const readySelected = changed.filter(r => checks.has(r.id) && !r.blockers.length && r.decision !== "approved");
  return <section className="rq-workspace" aria-label="요구사항 개요와 초점">
    <div className="rq-heading"><div><small>요구사항 · 개요 + 초점</small><h1>{rows.length}개 요구사항{!currentOnly ? ", 이번 변경은 " + changed.length + "개" : " · 현재 설계"}</h1>
      <p>{view?.goal || "대화에서 정리한 요구사항과 변경 이유, 흐름·시험을 연결해 확인합니다."}</p></div>
      <div className="rq-version" role="group" aria-label="설계 판 선택">
        <button disabled={!view?.hasCurrent || busy} aria-pressed={currentOnly} onClick={() => { setSource("current"); setChecks(new Set()); }}>현재 설계 {view?.currentVersion ? "v" + view.currentVersion : ""}</button>
        <button disabled={!view?.hasProposed || busy} aria-pressed={!currentOnly} onClick={() => setSource("proposed")}>변경 초안 {view?.proposedVersion ? "v" + view.proposedVersion : ""}</button>
      </div>
    </div>
    <div className="rq-toolbar">
      <button className="flow-btn primary" disabled={!canWrite || !!currentOnly && !!view?.hasProposed} onClick={() => view && setEditor({ row: null, snapshot: view })}>+ 새 요구사항</button>
      <button className="flow-btn" onClick={() => ask()} disabled={readOnly}>설계 상담</button>
      <button className="flow-btn" onClick={onManage}>설계도·연결 관리</button>
      <button className="flow-btn" onClick={onAdopt}>PRD 검토·판 채택</button>
      <button className="flow-btn" onClick={() => setTick(n => n + 1)} disabled={busy}>새로고침</button>
    </div>
    {error ? <p role="alert" className="rq-error">{error}</p> : null}
    {view?.draftError ? <p role="alert" className="rq-error">{view.draftError} — 설계도·연결 관리에서 초안을 확인해주세요.</p> : null}
    {notice ? <p role="status" className="rq-notice">{notice}</p> : null}
    {!view ? <p>요구사항을 불러오는 중…</p> : <>
      <div className="rq-metrics" aria-label="요구사항 필터">
        {([
          ["all", "전체 요구사항", rows.length, "기능별로 확인"],
          ["changes", "직접 변경", changed.length, "추가·변경·제외"],
          ["impact", "영향 확인", rows.filter(r => r.impactBy.length).length, "현재 문장은 유지"],
          ["questions", "미결 질문", rows.filter(r => words((r.after ?? r.before)?.requirement.openQuestions).length).length, "결정할 내용이 남음"],
          ["approved", "확정한 변경", changed.filter(r => r.decision === "approved").length, "구현·시험은 별도"],
        ] as const).map(([id, label, n, hint]) => <button key={id} className={"rq-metric rq-" + id} aria-pressed={filter === id} onClick={() => chooseFilter(id)}><strong>{n}</strong><span>{label}<small>{hint}</small></span></button>)}
      </div>
      {!rows.length ? <div className="rq-empty"><h2>아직 정리된 요구사항이 없습니다</h2><p>설계 상담으로 목적과 요구를 구체화하거나 새 요구사항을 직접 추가하세요.</p><p>대화 기록은 보존됩니다. 요구사항으로 정리한 내용부터 이 화면에서 확인할 수 있습니다.</p><button className="flow-btn primary" disabled={readOnly} onClick={() => ask()}>상담으로 요구사항 만들기</button></div> :
      <div className="rq-columns">
        <aside className="rq-panel rq-list" aria-label="요구사항 목록">
          <div className="rq-panel-head"><b>요구사항 개요</b><span>{visible.length} / {rows.length}</span></div>
          <div className="rq-search"><input aria-label="요구사항 검색" placeholder="ID, 제목, 내용 검색" value={query} onChange={e => setQuery(e.target.value)} />
            <select aria-label="기능 묶음" value={group} onChange={e => setGroup(e.target.value)}><option value="">모든 기능 묶음</option>{[...new Set(rows.map(r => r.group))].map(g => <option key={g}>{g}</option>)}</select>
            <button disabled={!canWrite || !!currentOnly || !changed.some(r => !r.blockers.length && r.decision === "pending")} onClick={() => { setFilter("changes"); setChecks(new Set(changed.filter(r => !r.blockers.length && r.decision === "pending").map(r => r.id))); }}>확정 가능한 변경 선택</button>
          </div>
          <div className="rq-list-scroll">{[...new Set(visible.map(r => r.group))].map(g => <div key={g}><div className="rq-group">{g}</div>{visible.filter(r => r.group === g).map(r => <div className={"rq-row" + (row?.id === r.id ? " is-selected" : "")} key={r.id}>
            {r.change !== "same" ? <input type="checkbox" aria-label={r.id + " 변경 선택"} disabled={!canWrite} checked={checks.has(r.id)} onChange={e => setChecks(s => { const next = new Set(s); e.target.checked ? next.add(r.id) : next.delete(r.id); return next; })} /> : <span className="rq-check-space" />}
            <button className="rq-pick" aria-pressed={row?.id === r.id} onClick={() => choose(r.id)}><span className="rq-id">{r.id}</span><span className={"rq-badge rq-" + r.change}>{r.change === "same" && r.impactBy.length ? "영향 확인" : CHANGE_LABEL[r.change]}</span><b>{r.title}</b>
              <span className="rq-mini-slots" aria-label="6칸 상태">{r.slots.map(slot => <i key={slot.name} title={slot.name + (slot.filled ? " 채움" : " 확인 필요")} className={!slot.filled ? "is-missing" : slot.changed ? "is-changed" : ""} />)}<small>{r.decision === "pending" && r.blockers.length ? "구체화 필요" : DECISION_LABEL[r.decision]}</small></span>
            </button></div>)}</div>)}
            {!visible.length ? <div className="rq-empty"><p>조건에 맞는 요구사항이 없습니다.</p><button onClick={() => { setFilter("all"); setQuery(""); setGroup(""); }}>검색·필터 초기화</button></div> : null}
          </div><div className="rq-legend">왜 · 무엇 · 경계 · 확인 · 연결 · 미결<br />보라 채움 / 주황 변경 / 점선 확인 필요</div>
        </aside>
        {row && display ? <section ref={focusRef} className="rq-panel rq-focus" aria-label="선택 요구사항">
          <div className="rq-focus-head"><div><span className="rq-id">{row.id}</span> <span>{row.group}</span> <span className="rq-badge">{text(display.requirement.priority) || "must"}</span> <span className={"rq-badge rq-" + row.change}>{CHANGE_LABEL[row.change]}</span></div><h2>{row.title}</h2>
            <p>{row.impactBy.length ? "연결된 변경의 영향을 확인할 항목입니다. 요구사항 문장은 자동 수정하지 않습니다." : row.change === "same" ? "현재 설계의 요구사항과 관련 흐름·시험입니다." : "대화에서 나온 변경을 검토한 뒤 확정하거나 보류합니다."}</p>
            <div className="rq-slot-strip">{row.slots.map(slot => <span key={slot.name} className={!slot.filled ? "is-missing" : slot.changed ? "is-changed" : ""}><b>{slot.filled ? slot.changed ? "↗" : "●" : "○"}</b>{slot.name}</span>)}</div>
          </div>
          <div className="rq-tabs" role="tablist" aria-label="요구사항 상세 보기">{([["detail", "요구사항"], ["diff", "변경 전후"], ["flow", "흐름·시험"], ["history", "변경 이력"]] as const).map(([id, label]) => <button role="tab" aria-selected={tab === id} key={id} onClick={() => setTab(id)}>{label}</button>)}</div>
          <div className="rq-detail" role="tabpanel">
            {row.stale ? <p className="rq-warning">검토 후 내용이나 관련 흐름·시험이 바뀌어 다시 확인해야 합니다.</p> : row.decision !== "pending" && row.change !== "same" ? <p className="rq-notice">{DECISION_LABEL[row.decision]} 상태로 저장되었습니다. <button disabled={!canWrite} onClick={() => void mark([row], "pending")}>검토 대기로 되돌리기</button></p> : null}
            {tab === "detail" ? <Detail row={row} /> : tab === "diff" ? <Comparison row={row} /> : tab === "flow" ? <FlowComparison row={row} /> : <History row={row} />}
            {row.blockers.length && row.after ? <div className="rq-box rq-warning"><b>확정 전에 확인할 내용</b><ul>{row.blockers.map(b => <li key={b}>{b}</li>)}</ul>{words(display.requirement.openQuestions).map(q => <p key={q}>? {q}</p>)}</div> : null}
            {row.impactBy.length ? <div className="rq-box"><b>영향의 출처</b><div className="rq-trace">{row.impactBy.map(id => rows.some(r => r.id === id) ? <button key={id} onClick={() => jump(id)}>{id} 변경 보기 →</button> : <span key={id}>{id}</span>)}</div></div> : null}
            {row.change !== "same" && rows.some(r => r.impactBy.includes(row.id)) ? <div className="rq-box"><b>연결된 영향 확인</b>{rows.filter(r => r.impactBy.includes(row.id)).map(r => <button className="rq-related" key={r.id} onClick={() => jump(r.id)}>{r.id} · {r.title}<span>현재 내용 유지 ↗</span></button>)}</div> : null}
          </div>
          <div className="rq-focus-actions"><button disabled={!canWrite || !!currentOnly && view.hasProposed} onClick={() => setEditor({ row, snapshot: view })}>{currentOnly ? "수정 초안 작성" : "요구사항 편집"}</button>
            {!currentOnly && row.change !== "same" ? <><button disabled={!canWrite || row.decision === "held"} onClick={() => void mark([row], "held")}>보류</button><button className="flow-btn primary" disabled={!canWrite || !!row.blockers.length || row.decision === "approved"} onClick={() => void mark([row], "approved")}>이 변경 검토 확정</button></> : null}
          </div>
        </section> : null}
        <aside className="rq-panel rq-evidence" aria-label="대화 근거"><div className="rq-panel-head"><b>대화 근거</b>{evidence?.reference ? <span>{evidence.reference.kind === "room" ? "프로젝트 대화" : "설계 상담"}</span> : null}</div>
          <div className="rq-evidence-body">{!evidence ? <p>근거를 불러오는 중…</p> : <>{evidence.reference ? <p className="rq-caption">{evidence.reference.id}{evidence.reference.turn !== undefined ? " · 발언 " + evidence.reference.turn : ""}</p> : null}
            {evidence.messages.map(m => <div key={m.turn} className={"rq-message" + (m.role === "user" ? " is-user" : "") + (evidence.reference?.turn === m.turn ? " is-origin" : "")}>{evidence.reference?.turn === m.turn ? <b className="rq-source-mark">연결된 근거</b> : null}<small>{m.role === "user" ? "나" : "상담·실행 기록"} · {formatDate(m.at)}</small><ChatText text={m.text} project={project} /></div>)}{evidence.note ? <p className="rq-caption">{evidence.note}</p> : null}</>}
            <button className="flow-btn" disabled={readOnly} onClick={() => ask(row ?? undefined)}>선택 항목으로 상담 시작</button>
            <div className="rq-review-counts"><b>이번 검토</b><span>확정 <strong>{changed.filter(r => r.decision === "approved").length}</strong></span><span>보류 <strong>{changed.filter(r => r.decision === "held").length}</strong></span><span>남은 검토 <strong>{changed.filter(r => r.decision === "pending").length}</strong></span></div>
            <button className="flow-btn primary" onClick={() => setSummary(true)}>검토 결과 모아보기</button>
            <p className="rq-caption">검토 확정은 요구사항에 대한 결정입니다. 구현 완료·시험 통과와 별도로 관리합니다.</p><button className="flow-btn" onClick={onGoBuild}>개발 상태 확인 →</button>
          </div>
        </aside>
      </div>}
      {rows.length ? <div className="rq-batch"><span><b>{checks.size}건 선택</b> / 변경 {changed.length}건 <small>{changed.some(r => checks.has(r.id) && r.blockers.length) ? "미결·빈칸이 있는 항목은 확정에서 제외합니다." : "검토 후 내용이 바뀌면 다시 확인합니다."}</small></span><div><button disabled={!checks.size || busy} onClick={() => setChecks(new Set())}>선택 해제</button><button disabled={!canWrite || !checks.size || !!currentOnly} onClick={() => void mark(changed.filter(r => checks.has(r.id)), "held")}>선택 보류</button><button className="flow-btn primary" disabled={!canWrite || !readySelected.length || !!currentOnly} onClick={() => void mark(readySelected, "approved")}>선택한 {readySelected.length}건 검토 확정</button></div></div> : null}
    </>}
    {editor ? <RequirementEditor key={editor.row?.id ?? "new"} project={project} snapshot={editor.snapshot} row={editor.row} busy={busy} error={error} onClose={() => setEditor(null)} onManage={() => { setEditor(null); onManage(); }} onSave={async input => {
      if (await mutate("/api/requirements/edit", input)) { setEditor(null); setSelected(input.id); setFilter("all"); setQuery(""); setGroup(""); setNotice("변경 초안을 저장했습니다. 검토 확정 후 PRD에서 설계 판을 채택하세요."); }
    }} /> : null}
    {summary ? <Modal title="이번 변경의 검토 결과" onClose={() => setSummary(false)}>{(["approved", "held", "pending"] as const).map(state => <section className="rq-summary-group" key={state}><h3>{DECISION_LABEL[state]} · {changed.filter(r => r.decision === state).length}건</h3>{changed.filter(r => r.decision === state).map(r => <button key={r.id} className="rq-related" onClick={() => { setSummary(false); jump(r.id); }}>{r.id} · {r.title}<span>{r.blockers.length ? "확인할 내용 " + r.blockers.length + "건" : "보기 →"}</span></button>)}</section>)}<p className="rq-caption">개별 요구사항의 검토 기록입니다. 설계 전체는 기존 PRD 검토와 설계 검사를 거쳐 채택합니다.</p><button className="flow-btn" onClick={() => { setSummary(false); onAdopt(); }}>PRD 검토·판 채택으로 이동</button></Modal> : null}
  </section>;
}

function formatDate(value: string) { const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
function Box({ title, children }: { title: string; children: ReactNode }) { return <div className="rq-box"><h3>{title}</h3>{children}</div>; }
function Detail({ row }: { row: RequirementRow }) {
  const d = (row.after ?? row.before)!, r = d.requirement;
  return <><Box title="왜 · 목적"><p>{d.goal || "아직 정하지 않았습니다."}</p></Box><Box title="무엇 · 조건과 반응"><p>{text(r.condition)}</p><p>{text(r.text)}</p>{text(r.response) ? <p className="rq-caption">시스템 반응: {text(r.response)}</p> : null}</Box>
    <Box title="경계 · 예외">{r.exceptions === undefined ? <p className="rq-caption">{r.pattern === "unwanted" ? "이 요구사항 자체가 예외를 다룹니다." : "예외 범위를 아직 정하지 않았습니다."}</p> : <p>{words(r.exceptions).join("\n") || "예외 없음으로 정했습니다."}</p>}</Box>
    <Box title="확인 · 합격 예시"><p>{text(r.acceptance) || d.tests.map(t => text(t.expect)).join("\n") || "아직 없습니다."}</p>{text(r.fit) ? <p>수치 기준: {text(r.fit)}</p> : null}</Box>
    <Box title="연결 · 목적에서 시험까지"><div className="rq-trace"><span>{d.goal || "목적 미정"}</span><b>→</b><span>{row.id}</span><b>→</b><span>{d.nodes.map(n => text(n.label) || text(n.id)).join(" · ") || "단계 미연결"}</span><b>→</b><span>{d.tests.map(t => text(t.id)).join(" · ") || "시험 미연결"}</span></div></Box></>;
}
function fieldValue(d: RequirementDetail | null, key: string): string {
  if (!d) return "이 판에 없음";
  if (key === "goal") return d.goal || "없음";
  if (key === "sourceRef") { const ref = rec(d.requirement.sourceRef); return ref.id ? (ref.kind === "room" ? "프로젝트 대화" : "설계 상담") + " · " + text(ref.id) + (ref.turn !== undefined ? " · 발언 " + String(ref.turn) : "") : "연결 없음"; }
  if (key === "pattern") return ({ ubiquitous: "항상", event: "사건이 발생하면", state: "상태가 유지되는 동안", unwanted: "예외·오류가 발생하면", optional: "특정 기능이 있으면" } as Record<string, string>)[text(d.requirement.pattern)] || "미정";
  if (key === "kind") return ({ functional: "기능", quality: "품질", constraint: "제약" } as Record<string, string>)[text(d.requirement.kind)] || "미정";
  if (key === "nodes") return d.nodes.map(n => text(n.id) + " · " + text(n.label)).join("\n") || "없음";
  if (key === "edges") return d.edges.map(e => text(e.from) + " → " + text(e.to) + (e.when ? " (" + text(e.when) + ")" : "")).join("\n") || "없음";
  if (key === "tests") return d.tests.map(t => text(t.id) + ": " + text(t.input) + " → " + text(t.expect)).join("\n") || "없음";
  if (key === "links") return d.links.map(l => text(l.node) + " × " + text(l.eval)).join("\n") || "없음";
  const v = d.requirement[key]; return Array.isArray(v) ? v.join("\n") || "없음" : typeof v === "object" ? JSON.stringify(v) : text(v) || "없음";
}
function Highlight({ before, after, next }: { before: string; after: string; next: boolean }) {
  const a = before.split(" "), b = after.split(" "); let i = 0, j = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const parts = next ? b : a;
  return <>{parts.slice(0, i).join(" ")}{i ? " " : ""}{next ? <ins>{parts.slice(i, parts.length - j).join(" ")}</ins> : <del>{parts.slice(i, parts.length - j).join(" ")}</del>}{j ? " " + parts.slice(parts.length - j).join(" ") : ""}</>;
}
function Comparison({ row }: { row: RequirementRow }) {
  const [showSame, setShowSame] = useState(false);
  if (row.change === "same" && !row.changedFields.length) return <><p className="rq-caption">요구사항 문장은 현재 설계와 같습니다.{row.impactBy.length ? " 관련 흐름·시험의 영향을 확인해주세요." : ""}</p><Detail row={row} /></>;
  const reason = text((row.after ?? row.before)?.requirement.changeReason) || row.events.filter(e => e.action === "edited").at(-1)?.note;
  const fields = [...new Set([...row.changedFields, ...(showSame ? ["text", "condition", "goal", "exceptions", "acceptance", "fit", "openQuestions", "links"] : [])])];
  return <>{reason ? <p className="rq-reason"><small>바꾼 이유</small>{reason}</p> : <p className="rq-caption">저장된 변경 이유가 없습니다. 요구사항 편집에서 이유와 대화 출처를 남길 수 있습니다.</p>}
    <div className="rq-diff-head"><b>바뀐 내용 {row.changedFields.length}개</b><button onClick={() => setShowSame(s => !s)}>{showSame ? "유지 항목 접기" : "유지 항목도 보기"}</button></div><div className="rq-compare-labels"><span>AS-IS · 현재</span><span>TO-BE · 변경 초안</span></div>
    {fields.map(k => <div className={"rq-diff-field" + (!row.changedFields.includes(k) ? " is-same" : "")} key={k}><h3>{FIELD_LABEL[k] ?? k}<small>{row.changedFields.includes(k) ? "변경" : "유지"}</small></h3><div><p><Highlight before={fieldValue(row.before, k)} after={fieldValue(row.after, k)} next={false} /></p><p><Highlight before={fieldValue(row.before, k)} after={fieldValue(row.after, k)} next /></p></div></div>)}</>;
}
function MiniFlow({ detail, other, proposed }: { detail: RequirementDetail | null; other: RequirementDetail | null; proposed: boolean }) {
  const data = useMemo(() => {
    if (!detail) return { nodes: [] as Node[], edges: [] as Edge[] };
    const ids = [...new Set([...detail.nodes.map(n => text(n.id)), ...detail.edges.flatMap(e => [text(e.from), text(e.to)])])];
    const positions = layout(ids.map(id => ({ id, portId: id })), detail.edges.map(e => ({ from: text(e.from), to: text(e.to), kind: "flow" })));
    const nodes: Node[] = ids.map(id => { const n = detail.nodes.find(n => n.id === id);
      const changed = proposed && !!other && !other.nodes.some(o => o.id === id && JSON.stringify(o) === JSON.stringify(n));
      return { id, position: positions.get(id)!, data: { label: n ? text(n.label) || id : id }, style: { background: changed ? "#342c23" : "#24252a", border: "1px solid " + (changed ? "#c4965d" : "#66616f"), color: "#eeeaf3", borderRadius: 8, fontSize: 12 } };
    });
    const edges: Edge[] = detail.edges.map((e, i) => ({ id: "e" + i, source: text(e.from), target: text(e.to), label: text(e.when),
      style: { stroke: proposed && other && !other.edges.some(o => JSON.stringify(o) === JSON.stringify(e)) ? "#e6af6e" : "#8e879b", strokeWidth: 1.5 }, labelStyle: { fill: "#ddd6e4", fontSize: 11 }, labelBgStyle: { fill: "#25232b" } }));
    return { nodes, edges };
  }, [detail, other, proposed]);
  if (!detail) return <p className="rq-caption">이 판에 없습니다.</p>;
  if (!data.nodes.length) return <p className="rq-caption">연결된 흐름이 없습니다. 설계도·연결 관리에서 단계를 연결하세요.</p>;
  return <div className="rq-flow-canvas"><ReactFlowProvider><ReactFlow nodes={data.nodes} edges={data.edges} fitView nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} minZoom={0.15} maxZoom={1.5} proOptions={{ hideAttribution: true }}><Background gap={20} /><Controls showInteractive={false} /><RefitOnChange signature={JSON.stringify(data)} /></ReactFlow></ReactFlowProvider></div>;
}
function FlowComparison({ row }: { row: RequirementRow }) {
  const d = row.after ?? row.before;
  return <><div className="rq-flow-pair"><Box title="AS-IS · 현재 흐름"><MiniFlow detail={row.before} other={row.after} proposed={false} /></Box>{row.change !== "same" || row.impactBy.length ? <Box title="TO-BE · 초안 · 주황은 변경"><MiniFlow detail={row.after} other={row.before} proposed /></Box> : null}</div>
    <Box title="시험 계획">{d?.tests.length ? d.tests.map(t => <div className="rq-test" key={text(t.id)}><b>{text(t.id)}</b><p>상황·입력: {text(t.input)}</p><p>기대 결과: {text(t.expect)}</p><small>시험 계획 · 실행 결과는 테스트에서 확인</small></div>) : <p className="rq-caption">연결된 시험이 없습니다.</p>}</Box>
    <div className="rq-progress"><span>요구 검토<b>{DECISION_LABEL[row.decision]}</b></span><span>구현<b>개발에서 확인</b></span><span>시험<b>실행 결과 별도 확인</b></span></div></>;
}
function History({ row }: { row: RequirementRow }) {
  return <div className="rq-history">{row.before ? <div><small>현재 채택된 설계</small><p>{text(row.before.requirement.text)}</p></div> : null}{row.events.length ? row.events.map((e, i) => <div key={i}><small>{formatDate(e.at)}</small><b>{e.action === "edited" ? "변경 초안 저장" : DECISION_LABEL[e.action]}</b><p>{e.note || "검토 상태를 저장했습니다."}</p>{e.before || e.after ? <details><summary>당시 요구사항 보기</summary><p>이전: {text(e.before?.text) || "없음"}</p><p>이후: {text(e.after?.text) || "없음"}</p></details> : null}</div>) : <p className="rq-caption">이 화면에서 남긴 검토 이력이 없습니다. 대화 근거는 오른쪽에서 확인합니다.</p>}</div>;
}
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
  return <dialog className="rq-modal" ref={ref} aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }}><div className="rq-modal-heading"><h2>{title}</h2><button type="button" aria-label="닫기" onClick={onClose}>×</button></div>{children}</dialog>;
}
type SaveInput = { id: string; documentDigest: string; values: Record<string, unknown>; links: { node: string; eval: string }[]; remove?: boolean; create?: boolean };
function RequirementEditor({ project, row, snapshot, busy, error, onClose, onSave, onManage }: {
  project: string; row: RequirementRow | null; snapshot: RequirementWorkspace; busy: boolean; error: string; onClose: () => void; onSave: (input: SaveInput) => Promise<void>; onManage: () => void;
}) {
  const r = (row?.after ?? row?.before)?.requirement ?? {};
  const [draft, setDraft] = useState<Record<string, string>>(() => ({
    id: row?.id ?? "R-" + crypto.randomUUID().slice(0, 8), summary: text(r.summary), text: text(r.text), group: text(r.group),
    goal: text(r.goal) || snapshot.goal, pattern: text(r.pattern) || "event", kind: text(r.kind) || "functional", priority: text(r.priority) || "must",
    condition: text(r.condition), response: text(r.response), exceptions: words(r.exceptions).join("\n"), acceptance: text(r.acceptance),
    fit: text(r.fit), openQuestions: words(r.openQuestions).join("\n"), changeReason: text(r.changeReason), sourceKind: text(rec(r.sourceRef).kind) || "consult",
    sourceId: text(rec(r.sourceRef).id), sourceTurn: rec(r.sourceRef).turn === undefined ? "" : String(rec(r.sourceRef).turn),
  }));
  const [sources, setSources] = useState<{ kind: string; id: string; title: string }[]>([]);
  const [turns, setTurns] = useState<{ seq: number; role: string; text: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([fetch("/api/rooms?alias=" + encodeURIComponent(project)).then(r => r.json()), fetch("/api/consult/list?alias=" + encodeURIComponent(project)).then(r => r.json())]).then(results => {
      if (cancelled) return;
      const rooms = results[0]?.status === "fulfilled" ? rec(results[0].value) : {};
      const consults = results[1]?.status === "fulfilled" ? rec(results[1].value) : {};
      const list = (v: unknown) => Array.isArray(v) ? v.map(rec) : [];
      setSources([...list(rooms.rooms).map(r => ({ kind: "room", id: text(r.id), title: text(r.title) || text(r.id) })), ...[...list(consults.consults), ...list(consults.archived)].map(r => ({ kind: "consult", id: text(r.id), title: text(r.title) || text(r.id) }))]);
    });
    return () => { cancelled = true; };
  }, [project]);
  useEffect(() => {
    setTurns([]);
    if (!draft.sourceId) return;
    const controller = new AbortController();
    fetch((draft.sourceKind === "room" ? "/api/room?" : "/api/consult?") + new URLSearchParams({ alias: project, id: draft.sourceId }), { signal: controller.signal }).then(r => r.json()).then(b => {
      if (!controller.signal.aborted && Array.isArray(b.messages)) setTurns(b.messages.filter((m: { text?: unknown }) => typeof m.text === "string").slice(-30));
    }).catch(() => undefined);
    return () => controller.abort();
  }, [project, draft.sourceKind, draft.sourceId]);
  const [testIds, setTestIds] = useState(() => new Set((row?.after ?? row?.before)?.links.map(l => text(l.eval)) ?? []));
  const set = (key: string, value: string) => setDraft(d => {
    const next = { ...d, [key]: value };
    if (key === "text") { next.condition = ""; next.response = ""; }
    if ((key === "condition" || key === "response") && next.response?.trim()) next.text = [next.condition?.trim(), "시스템은", next.response.trim()].filter(Boolean).join(" ");
    return next;
  });
  const field = (key: string, label: string, multi = false, required = false) => <label key={key}>{label}{multi ? <textarea aria-label={label} rows={key === "text" ? 3 : 2} value={draft[key]} required={required} onChange={e => set(key, e.target.value)} /> : <input aria-label={label} value={draft[key]} required={required} onChange={e => set(key, e.target.value)} />}</label>;
  function submit(e: FormEvent, remove = false) {
    e.preventDefault();
    const split = (s: string) => s.split("\n").map(s => s.trim()).filter(Boolean);
    const values = { ...r, ...Object.fromEntries(["summary", "text", "group", "goal", "pattern", "kind", "priority", "condition", "response", "acceptance", "fit", "changeReason"].map(k => [k, draft[k]?.trim() ?? ""])),
      exceptions: split(draft.exceptions!), openQuestions: split(draft.openQuestions!),
      sourceRef: draft.sourceId?.trim() ? { kind: draft.sourceKind, id: draft.sourceId.trim(), ...(draft.sourceTurn ? { turn: Number(draft.sourceTurn) } : {}) } : undefined };
    void onSave({ id: row?.id ?? draft.id!.trim(), values, documentDigest: snapshot.documentDigest,
      create: !row, links: snapshot.tests.filter(t => testIds.has(text(t.id))).map(t => ({ node: text(t.node), eval: text(t.id) })), ...(remove ? { remove: true } : {}) });
  }
  return <Modal title={row ? row.id + " 요구사항 편집" : "새 요구사항"} onClose={onClose}><form className="rq-editor" onSubmit={submit}>
    {error ? <p className="rq-error" role="alert">{error}</p> : null}
    {!row ? field("id", "요구사항 ID", false, true) : null}
    <div className="rq-editor-pair">{field("summary", "짧은 제목")}{field("group", "기능 묶음")}</div>
    {field("text", "요구사항 문장", true, true)}{field("goal", "목적")}
    <div className="rq-editor-pair"><label>적용 상황<select aria-label="적용 상황" value={draft.pattern} onChange={e => set("pattern", e.target.value)}>{[["ubiquitous", "항상"], ["event", "사건이 발생하면"], ["state", "상태가 유지되는 동안"], ["unwanted", "예외·오류가 발생하면"], ["optional", "특정 기능이 있으면"]].map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label><label>요구사항 종류<select aria-label="요구사항 종류" value={draft.kind} onChange={e => set("kind", e.target.value)}><option value="functional">기능</option><option value="quality">품질</option><option value="constraint">제약</option></select></label></div>
    <label>우선순위<select value={draft.priority} onChange={e => set("priority", e.target.value)}><option value="must">Must · 꼭</option><option value="should">Should · 해야 함</option><option value="could">Could · 있으면 좋음</option></select></label>
    <div className="rq-editor-pair">{field("condition", "조건·사건")}{field("response", "시스템 반응")}</div>
    {field("exceptions", "경계·예외 (줄마다 하나, 비우면 예외 없음으로 저장)", true)}
    {field("acceptance", "합격 예시·확인 방법", true)}{field("fit", "수치 기준 (품질 요구사항 필수)")}
    {field("openQuestions", "미결 질문 (줄마다 하나, 해결한 질문은 삭제)", true)}{field("changeReason", "변경 이유", true)}
    <fieldset><legend>흐름·시험 연결</legend>{snapshot.tests.length ? snapshot.tests.map(t => <label className="rq-check-label" key={text(t.id)}><input type="checkbox" checked={testIds.has(text(t.id))} onChange={e => setTestIds(s => { const next = new Set(s); e.target.checked ? next.add(text(t.id)) : next.delete(text(t.id)); return next; })} />{text(t.id)} · {text(t.node)} · {text(t.expect)}</label>) : <p className="rq-caption">등록된 시험이 없습니다. 설계도·연결 관리 또는 상담에서 흐름 단계와 시험을 먼저 작성하세요.</p>}<button type="button" onClick={onManage}>설계도·연결 관리로 이동</button></fieldset>
    <fieldset><legend>대화 근거</legend><label>근거 대화 선택<select aria-label="근거 대화 선택" value={draft.sourceId ? draft.sourceKind + ":" + draft.sourceId : ""} onChange={e => { const at = e.target.value.indexOf(":"); setDraft(d => ({ ...d, sourceKind: at < 0 ? "consult" : e.target.value.slice(0, at), sourceId: at < 0 ? "" : e.target.value.slice(at + 1), sourceTurn: "" })); }}><option value="">대화 연결 안 함</option>{draft.sourceId && !sources.some(s => s.kind === draft.sourceKind && s.id === draft.sourceId) ? <option value={draft.sourceKind + ":" + draft.sourceId}>현재 연결 · {draft.sourceId}</option> : null}{sources.map(s => <option key={s.kind + s.id} value={s.kind + ":" + s.id}>{s.kind === "room" ? "프로젝트 대화" : "설계 상담"} · {s.title}</option>)}</select></label>
    {turns.length ? <label>근거 발언 선택<select aria-label="근거 발언 선택" value={draft.sourceTurn} onChange={e => set("sourceTurn", e.target.value)}><option value="">최근 문맥 표시</option>{draft.sourceTurn && !turns.some(t => String(t.seq) === draft.sourceTurn) ? <option value={draft.sourceTurn}>현재 발언 {draft.sourceTurn}</option> : null}{turns.map(t => <option key={t.seq} value={t.seq}>{t.seq} · {t.role === "user" ? "나" : "응답"} · {t.text.slice(0, 70)}</option>)}</select></label> : null}
    <details><summary>대화 ID로 직접 연결</summary><label>대화 종류<select aria-label="대화 종류" value={draft.sourceKind} onChange={e => set("sourceKind", e.target.value)}><option value="consult">설계 상담</option><option value="room">프로젝트 대화</option></select></label><div className="rq-editor-pair">{field("sourceId", "대화 ID")}{field("sourceTurn", "발언 번호 (선택)")}</div></details><p className="rq-caption">설계 상담에서 고친 항목은 해당 대화의 근거가 자동으로 연결됩니다.</p></fieldset>
    <div className="rq-editor-actions">{row?.after ? <button type="button" disabled={busy} onClick={e => submit(e, true)}>초안에서 제외</button> : null}<button type="button" disabled={busy} onClick={onClose}>취소</button><button className="flow-btn primary" type="submit" disabled={busy}>{busy ? "저장 중…" : "변경 초안 저장"}</button></div>
  </form></Modal>;
}

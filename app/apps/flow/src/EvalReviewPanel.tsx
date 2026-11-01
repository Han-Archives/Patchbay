import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { EvalResultStatus } from "@patchbay/core";
import type { EvalsReviewResponse } from "./evalsContract.js";
import { isWorkPlace, WORK_PLACES, type WorkPlace } from "./workspaceNavigation.js";

/**
 * Review 칸의 「평가 결과 받기」 — 실행 · 사람 채점으로 나온 결과를 콘솔에서 받아 승인된 판에 붙인다
 * (사용자 요청 2026-10-31). `patchbay evals record` 와 같은 길이고 판이 다르면 거절한다.
 * 결과 파일(JSON)을 올리거나 붙여 넣으면 건마다 채워지고, 여기서 바로 고르거나 고쳐서 기록한다.
 */
type Draft = Record<string, { status?: EvalResultStatus; note?: string }>;
const STATUS: { value: EvalResultStatus; label: string }[] = [{ value: "pass", label: "통과" }, { value: "fail", label: "실패" }, { value: "skip", label: "건너뜀" }];

type Evidence = NonNullable<Extract<EvalsReviewResponse, { status: "ok" }>["evals"][number]["evidence"]>;
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;

/** 근거의 `screen` → 지금 화면으로 가는 링크 (B). 작업 화면이거나 대화방이고, 그 밖의 값은 링크를 만들지 않는다. */
export function screenLink(screen: string | undefined): { kind: "place"; place: WorkPlace; label: string } | { kind: "room"; id: string; label: string } | null {
  if (!screen) return null;
  if (screen.startsWith("room:") && screen.length > 5) return { kind: "room", id: screen.slice(5), label: "대화방" };
  return isWorkPlace(screen) ? { kind: "place", place: screen, label: WORK_PLACES[screen] } : null;
}

/** 다른 화면에 다녀와도 고르던 값이 남게 — 창이 닫혀도 기록 전 채점은 이 탭에 둔다. */
const draftKey = (project: string, version: number) => `pb-eval-draft:${project}:v${version}`;
function readDraft(project: string, version: number): { draft: Draft; how?: string } | null {
  try { const raw = sessionStorage.getItem(draftKey(project, version)); return raw ? JSON.parse(raw) as { draft: Draft; how?: string } : null; } catch { return null; }
}

/** 받은 JSON을 건마다의 값으로. 판이 다르거나 형식이 아니면 이유를 돌려준다. */
export function draftFromJson(text: string, irVersion: number): { ok: true; draft: Draft; how?: string } | { ok: false; error: string } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: "JSON이 아닙니다." }; }
  const rec = raw && typeof raw === "object" ? raw as { irVersion?: unknown; how?: unknown; results?: unknown } : {};
  if (rec.irVersion !== irVersion) return { ok: false, error: `결과는 v${String(rec.irVersion)} 인데 승인된 설계는 v${irVersion} 입니다. 다른 판의 결과는 붙이지 않습니다.` };
  if (!Array.isArray(rec.results)) return { ok: false, error: "results 칸이 없습니다." };
  const draft: Draft = {};
  for (const row of rec.results as { evalId?: unknown; status?: unknown; note?: unknown }[]) {
    if (typeof row?.evalId !== "string" || !STATUS.some(s => s.value === row.status)) continue;
    draft[row.evalId] = { status: row.status as EvalResultStatus, ...(typeof row.note === "string" && row.note ? { note: row.note } : {}) };
  }
  return { ok: true, draft, ...(typeof rec.how === "string" ? { how: rec.how } : {}) };
}

export function EvalReviewPanel({ project, readOnly, onClose, onOpenPlace, guided = false, onRecorded }: { project: string; readOnly: boolean; onClose: () => void; onOpenPlace: (place: WorkPlace) => void; guided?: boolean; onRecorded?: () => void }) {
  const [view, setView] = useState<EvalsReviewResponse | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [how, setHow] = useState("사람 채점");
  const [paste, setPaste] = useState<string | null>(null);
  const [only, setOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const located = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/evals?alias=${encodeURIComponent(project)}`).then(async res => {
      const body = await res.json() as EvalsReviewResponse & { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? "평가 목록을 불러오지 못했습니다.");
      if (cancelled) return;
      setView(body);
      if (body.status !== "ok") return;
      const kept = readDraft(project, body.irVersion);
      if (kept) { setDraft(kept.draft); if (kept.how) setHow(kept.how); setDirty(true); setNotice("기록하지 않은 채점을 이어서 보입니다."); }
      else if (body.current) {
        setDraft(Object.fromEntries(body.current.run.results.map(r => [r.evalId, { status: r.status, ...(r.note ? { note: r.note } : {}) }])));
        if (body.current.run.how) setHow(body.current.run.how);
      }
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [project]);

  useEffect(() => {
    if (view?.status !== "ok" || !dirty) return;
    try { sessionStorage.setItem(draftKey(project, view.irVersion), JSON.stringify({ draft, how })); } catch { /* 이 탭에서만 잃는다. */ }
  }, [project, view, draft, how, dirty]);
  const evals = view?.status === "ok" ? view.evals : [];
  const counts = useMemo(() => {
    const c = { pass: 0, fail: 0, skip: 0 };
    for (const e of evals) { const s = draft[e.id]?.status; if (s) c[s] += 1; }
    return c;
  }, [evals, draft]);
  const scored = counts.pass + counts.fail + counts.skip;
  const nextEval = guided && !readOnly ? evals.find(e => !draft[e.id]?.status)?.id : undefined;
  useEffect(() => {
    if (!nextEval || located.current) return;
    located.current = true;
    if (nextEval !== evals[0]?.id) root.current?.querySelector(".eval-review-current")?.scrollIntoView({ block: "start" });
  }, [nextEval, evals]);

  function take(text: string) {
    if (view?.status !== "ok") return;
    const read = draftFromJson(text, view.irVersion);
    if (!read.ok) { setError(read.error); return; }
    const filled = evals.filter(e => read.draft[e.id]).length;
    setDraft(current => ({ ...current, ...read.draft })); setDirty(true);
    if (read.how) setHow(read.how);
    setPaste(null); setError(null);
    setNotice(`받은 결과 ${filled}건을 채웠습니다. 확인하고 「v${view.irVersion}에 기록」을 누르세요.`);
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) take(await file.text());
  }
  function set(id: string, patch: { status?: EvalResultStatus; note?: string }) {
    setDraft(current => ({ ...current, [id]: { ...current[id], ...patch } })); setDirty(true);
    setNotice(null);
  }
  async function record() {
    if (view?.status !== "ok") return;
    const kinds = new Map(evals.map(e => [e.id, e.kind]));
    const results = evals.filter(e => draft[e.id]?.status).map(e => ({ evalId: e.id, kind: kinds.get(e.id)!, status: draft[e.id]!.status!, ...(draft[e.id]?.note?.trim() ? { note: draft[e.id]!.note!.trim() } : {}) }));
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/evals/record", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: project, run: { irVersion: view.irVersion, ranAt: new Date().toISOString(), how: how.trim(), results } }) });
      const body = await res.json() as { score?: { passed: number; failed: number; skipped: number }; missing?: string[]; error?: string };
      if (!res.ok || body.error || !body.score) throw new Error(body.error ?? "기록하지 못했습니다.");
      setDirty(false);
      try { sessionStorage.removeItem(draftKey(project, view.irVersion)); } catch { /* 남아도 다음에 열 때 이어 보일 뿐이다. */ }
      setNotice(`v${view.irVersion}에 기록했습니다 — 통과 ${body.score.passed} · 실패 ${body.score.failed} · 건너뜀 ${body.score.skipped}${body.missing?.length ? ` · 결과 없음 ${body.missing.length}` : ""}`);
      onRecorded?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  const total = evals.length || 1;
  return <div ref={root} className="main-repo eval-review" role="dialog" aria-modal="true" aria-label="평가 결과 받기">
    <header>
      <h3>평가 결과 받기{view?.status === "ok" ? <small> · v{view.irVersion} · 평가 {evals.length}건</small> : null}</h3>
      {nextEval ? <button type="button" className="flow-btn eval-review-next" onClick={() => root.current?.querySelector(".eval-review-current")?.scrollIntoView({ block: "start" })}>다음 채점 위치 ↓</button> : null}
      <button type="button" className="flow-btn" onClick={onClose}>닫기</button>
    </header>
    <p className="eval-review-lead">실행하거나 사람이 채점한 결과를 승인된 판에 붙입니다. 결과 파일을 올리거나 붙여 넣으면 건마다 채워지고, 여기서 바로 고를 수도 있습니다.</p>
    {view?.status === "no-design" ? <p className="main-empty">승인된 설계가 없어 결과를 붙일 판이 없습니다. 설계에서 채택한 뒤에 받습니다.</p> : null}
    {view?.status === "ok" ? <>
      <div className="eval-review-meter" aria-label={`통과 ${counts.pass} · 실패 ${counts.fail} · 건너뜀 ${counts.skip} · 남음 ${evals.length - scored}`}>
        <span className="is-pass" style={{ width: `${counts.pass / total * 100}%` }} />
        <span className="is-fail" style={{ width: `${counts.fail / total * 100}%` }} />
        <span className="is-skip" style={{ width: `${counts.skip / total * 100}%` }} />
      </div>
      <div className="eval-review-legend">
        <span><i className="is-pass" />통과 {counts.pass}</span><span><i className="is-fail" />실패 {counts.fail}</span><span><i className="is-skip" />건너뜀 {counts.skip}</span><span><i />남음 {evals.length - scored}</span>
        <span className="eval-review-recorded">{view.current ? `지금 기록 · ${new Date(view.current.run.ranAt).toLocaleString("ko-KR")} · 통과 ${view.current.score.passed}/${view.current.score.total}` : "아직 기록된 결과 없음"}</span>
      </div>
      <div className="eval-review-tools">
        <label className="flow-btn">결과 파일 올리기<input type="file" accept="application/json,.json" hidden onChange={event => void upload(event)} /></label>
        <button type="button" className="flow-btn" onClick={() => setPaste(paste === null ? "" : null)}>{paste === null ? "JSON 붙여 넣기" : "붙여 넣기 닫기"}</button>
        <label className="eval-review-only"><input type="checkbox" checked={only} onChange={event => setOnly(event.target.checked)} /> 남은 것만</label>
      </div>
      {paste !== null ? <div className="eval-review-paste">
        <textarea value={paste} onChange={event => setPaste(event.target.value)} placeholder='{"irVersion": 3, "results": [...]}' aria-label="결과 JSON" />
        <button type="button" className="flow-btn primary" disabled={!paste.trim()} onClick={() => take(paste)}>채우기</button>
      </div> : null}
      {error ? <p className="flow-error">{error}</p> : null}
      {notice ? <p className="eval-review-notice" role="status">{notice}</p> : null}
      <ol className="eval-review-list">
        {evals.filter(e => !only || !draft[e.id]?.status).map(e => {
          const row = draft[e.id] ?? {};
          return <li key={e.id} className={`${row.status ? `is-${row.status}` : ""}${nextEval === e.id ? " eval-review-current" : ""}`}>
            <div className="eval-review-head">
              <b>{e.requirements.map(r => r.id).join(" · ") || e.id}</b>
              <span>{e.requirements[0]?.summary ?? ""}</span>
              {nextEval === e.id ? <span className="user-action-label">여기부터 확인해 주세요</span> : null}
              <small>{e.id}{e.kind === "model" ? " · 모델 채점" : ""}</small>
            </div>
            <p className="eval-review-expect"><span>기대</span>{e.expect}</p>
            {e.evidence ? <EvidenceView project={project} version={view.irVersion} evidence={e.evidence} onZoom={setZoom} onOpenPlace={onOpenPlace} /> : <p className="eval-review-noevidence">근거 없음 — 실행한 쪽이 <code>patchbay evals evidence</code>로 붙이면 여기 보입니다.</p>}
            <div className={`eval-review-score${nextEval === e.id ? " user-action-pulse" : ""}`}>
              <div role="radiogroup" aria-label={`${e.id} 결과`}>{STATUS.map(s => <button type="button" key={s.value} role="radio" aria-checked={row.status === s.value} className={`is-${s.value}`} disabled={readOnly} onClick={() => set(e.id, { status: s.value })}>{s.label}</button>)}</div>
              <input type="text" value={row.note ?? ""} placeholder="메모 (선택)" disabled={readOnly} onChange={event => set(e.id, { note: event.target.value })} aria-label={`${e.id} 메모`} />
            </div>
          </li>;
        })}
      </ol>
      <footer className="eval-review-foot">
        <label>어떻게 냈나<input type="text" value={how} onChange={event => setHow(event.target.value)} disabled={readOnly} placeholder="예: 사람 채점 2026-10-31" /></label>
        <button type="button" className={`flow-btn primary${guided && !nextEval && dirty && !readOnly && !busy ? " user-action-pulse" : ""}`} disabled={readOnly || busy || scored === 0} onClick={() => void record()}>{busy ? "기록 중" : `v${view.irVersion}에 기록 (${scored}/${evals.length})`}</button>
      </footer>
    </> : null}
    {zoom ? <button type="button" className="eval-review-zoom" onClick={() => setZoom(null)} aria-label="크게 보기 닫기"><img src={zoom} alt="" /></button> : null}
    {!view && !error ? <p role="status">평가 목록을 불러오는 중</p> : null}
  </div>;
}

function EvidenceView({ project, version, evidence, onZoom, onOpenPlace }: { project: string; version: number; evidence: Evidence; onZoom: (src: string) => void; onOpenPlace: (place: WorkPlace) => void }) {
  const url = (name: string) => `/api/evals/evidence-file?alias=${encodeURIComponent(project)}&version=${version}&eval=${encodeURIComponent(evidence.evalId)}&name=${encodeURIComponent(name)}`;
  const images = evidence.files.filter(name => IMAGE.test(name));
  const texts = evidence.files.filter(name => !IMAGE.test(name));
  const link = screenLink(evidence.screen);
  return <div className="eval-review-evidence">
    <dl>
      {evidence.how ? <><dt>한 일</dt><dd>{evidence.how}</dd></> : null}
      {evidence.observed ? <><dt>본 것</dt><dd>{evidence.observed}</dd></> : null}
    </dl>
    {images.length ? <div className="eval-review-shots">{images.map(name => <button type="button" key={name} onClick={() => onZoom(url(name))} title={name} aria-label={`${name} 크게 보기`}><img loading="lazy" src={url(name)} alt={name} /></button>)}</div> : null}
    <div className="eval-review-links">
      {texts.map(name => <a key={name} href={url(name)} target="_blank" rel="noreferrer">{name}</a>)}
      {link ? link.kind === "room"
        ? <a href={`#room/${encodeURIComponent(project)}/${encodeURIComponent(link.id)}`} title="그때 쓴 대화방을 지금 모습으로 엽니다">지금 화면 열기 · {link.label}</a>
        : <button type="button" className="eval-review-screen" onClick={() => onOpenPlace(link.place)} title="평가한 그때가 아니라 지금 모습입니다. 고르던 채점은 남아 있습니다">지금 화면 열기 · {link.label}</button>
        : null}
      <small>근거 {new Date(evidence.at).toLocaleString("ko-KR")}</small>
    </div>
  </div>;
}

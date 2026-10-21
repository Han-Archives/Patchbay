import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Background, Controls, MarkerType, Position, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import type { SemanticView, SemanticChunk, SemanticEvidenceRow, SemanticPredicate, EvidenceDecision } from "@patchbay/core";
import { RefitOnChange } from "./RefitOnChange.js";
import { layout } from "./layout.js";
import type { AdapterStatus } from "./shellContract.js";
import "@xyflow/react/dist/style.css";
import "./semantic.css";

const predicates = { USES: "사용한다", DEPENDS_ON: "의존한다", PART_OF: "일부다" };
const decisions = { pending: "검토 대기", approved: "승인", rejected: "기각", withdrawn: "철회" };
interface SourcePreview { path: string; hash: string; sourceId: string; chunks: SemanticChunk[] }
type Filter = "pending" | "approved" | "stale" | "all";

export function SemanticKnowledgePane({ project, revision = 0, readOnly = false, onNeo4jStatus, onReplica }: {
  project: string; revision?: number; readOnly?: boolean; onNeo4jStatus?: (status: AdapterStatus) => void; onReplica: () => void;
}) {
  const [view, setView] = useState<SemanticView | null>(null), [tick, setTick] = useState(0);
  const [tab, setTab] = useState<"review" | "explore">("review"), [filter, setFilter] = useState<Filter>("pending");
  const [sourceId, setSourceId] = useState(""), [selectedId, setSelectedId] = useState("");
  const [path, setPath] = useState(""), [preview, setPreview] = useState<SourcePreview | null>(null), [chunkId, setChunkId] = useState("");
  const [subject, setSubject] = useState(""), [predicate, setPredicate] = useState<SemanticPredicate>("USES"), [object, setObject] = useState(""), [quote, setQuote] = useState("");
  const [memberId, setMemberId] = useState("");
  const [extractors, setExtractors] = useState<{ id: string; name: string; model: string; speaker: string }[]>([]);
  const [localModels, setLocalModels] = useState<{ id: string; name: string }[]>([]), [modelsLoading, setModelsLoading] = useState(false);
  const [query, setQuery] = useState(""), [draft, setDraft] = useState(""), [entity, setEntity] = useState("");
  const [claimId, setClaimId] = useState(""), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [extracting, setExtracting] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const sourceRequest = useRef(0), actionController = useRef<AbortController | null>(null), modelsController = useRef<AbortController | null>(null);
  const statusCb = useRef(onNeo4jStatus); statusCb.current = onNeo4jStatus;
  useEffect(() => () => { sourceRequest.current++; actionController.current?.abort(); modelsController.current?.abort(); }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true);
    fetch("/api/knowledge/semantic?" + new URLSearchParams({ alias: project, q: query, entity }), { signal: controller.signal })
      .then(async r => { const b = await r.json(); if (!r.ok) throw Error(b.error); return b as SemanticView; })
      .then(b => { if (controller.signal.aborted) return; setView(b); setError(""); statusCb.current?.(b.projection.status === "disconnected" ? "disconnected" : "connected"); })
      .catch((e: Error) => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [project, revision, tick, query, entity]);
  useEffect(() => {
    const controller = new AbortController();
    // Configuration only. Reading registered members never starts or probes an LLM.
    fetch("/api/knowledge/semantic/extractors?" + new URLSearchParams({ alias: project }), { signal: controller.signal })
      .then(r => r.json()).then(b => { if (!controller.signal.aborted) setExtractors(b.members ?? []); }).catch(() => undefined);
    fetch("/api/room/files?" + new URLSearchParams({ alias: project }), { signal: controller.signal }).then(r => r.json())
      .then(b => { if (!controller.signal.aborted) setFiles((b.files ?? []).filter((p: string) => /\.(md|txt)$/i.test(p))); }).catch(() => undefined);
    return () => controller.abort();
  }, [project]);
  const canWrite = !readOnly && !busy && !loading && !modelsLoading && !!view;
  const rows = view?.rows ?? [];
  const visible = rows.filter(r => (!sourceId || r.sourceId === sourceId) && (filter === "all" || (filter === "stale" ? !r.current : r.current && r.decision === filter)));
  const row = visible.find(r => r.id === selectedId) ?? visible[0] ?? null;
  const sourceChunk = preview?.chunks.find(c => c.id === chunkId) ?? preview?.chunks[0];
  const claimRows = rows.filter(r => r.claimId === claimId && r.current && r.decision === "approved");
  const selectedClaim = claimRows[0];
  useEffect(() => { setNote(""); }, [row?.id]);
  const canvas = useMemo(() => {
    const graph = view?.graph;
    if (!graph) return { nodes: [], edges: [] };
    const pos = layout(graph.entities.map(e => ({ id: e.id, portId: "entity" })), graph.claims.map(c => ({ from: c.from, to: c.to, kind: c.predicate })));
    return {
      nodes: graph.entities.map(e => ({ id: e.id, data: { label: e.name }, position: pos.get(e.id) ?? { x: 0, y: 0 }, sourcePosition: Position.Right, targetPosition: Position.Left,
        className: e.id === entity ? "semantic-node is-current" : "semantic-node", style: { width: 160 }, selected: e.id === entity })),
      edges: graph.claims.map(c => ({ id: c.id, source: c.from, target: c.to, label: predicates[c.predicate],
        markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: c.id === claimId ? "#c4a0ef" : "#8a71af", strokeWidth: c.id === claimId ? 3 : 1.6 },
        labelStyle: { fill: "#eee3ff", fontSize: 12 }, labelBgStyle: { fill: "#24202c" } })),
    };
  }, [view?.graph, entity, claimId]);
  async function mutate(action: string, payload: object) {
    setBusy(true); setError(""); setNotice("");
    const controller = new AbortController(); actionController.current = controller;
    try {
      const response = await fetch("/api/knowledge/semantic/" + action, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: project, revision: view?.revision, ...payload }), signal: controller.signal });
      const body = await response.json();
      if (!response.ok) { if (response.status === 409) setTick(t => t + 1); throw Error(body.error ?? "저장하지 못했습니다."); }
      if (!controller.signal.aborted) { setView(body as SemanticView); setTick(t => t + 1); }
      return body as SemanticView;
    } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); return null; }
    finally { if (!controller.signal.aborted) { setBusy(false); setExtracting(false); } }
  }
  async function loadSource(nextPath = path) {
    const request = ++sourceRequest.current; setError(""); setPreview(null);
    try {
      const r = await fetch("/api/knowledge/semantic/source?" + new URLSearchParams({ alias: project, path: nextPath.trim() }));
      const body = await r.json(); if (!r.ok) throw Error(body.error);
      if (request !== sourceRequest.current) return;
      setPath(body.path); setPreview(body); setChunkId(body.chunks[0]?.id ?? ""); setSubject(""); setObject(""); setQuote("");
    } catch (e) { if (request === sourceRequest.current) setError((e as Error).message); }
  }
  async function add(e: FormEvent) {
    e.preventDefault(); if (!preview || !sourceChunk) return;
    const saved = await mutate("import", { path: preview.path, hash: preview.hash, candidates: [{ chunkId: sourceChunk.id, subject, predicate, object, quote }] });
    if (saved) { setFilter("pending"); setSourceId(preview.sourceId); setSubject(""); setObject(""); setQuote(""); setNotice("원문 인용을 확인해 후보를 저장했습니다. 검토 후 승인해주세요."); }
  }
  async function extract() {
    if (!preview) return; setExtracting(true);
    const selection = memberId.startsWith("local:") ? { localModel: memberId.slice(6) } : { memberId: memberId.replace(/^member:/, "") };
    const result = await mutate("extract", { path: preview.path, hash: preview.hash, ...selection });
    if (result) { setFilter("pending"); setSourceId(preview.sourceId); setNotice("관계 후보 추출을 마쳤습니다. 원문과 비교해 검토해주세요."); }
  }
  async function loadLocalModels() {
    const controller = new AbortController(); modelsController.current = controller; setModelsLoading(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/knowledge/semantic/local-models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: project }), signal: controller.signal });
      const body = await response.json(); if (!response.ok) throw Error(body.error ?? "LM Studio 모델 목록을 읽지 못했습니다.");
      if (controller.signal.aborted) return;
      setLocalModels(body.models);
      setMemberId(current => current.startsWith("local:") && !body.models.some((m: { id: string }) => m.id === current.slice(6)) ? "" : current);
      setNotice(body.models.length ? `LM Studio 대화 모델 ${body.models.length}개를 불러왔습니다. 추출할 모델을 선택해주세요.` : "LM Studio에 다운로드한 대화 모델이 없습니다.");
    } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    finally { if (!controller.signal.aborted) setModelsLoading(false); }
  }
  async function decide(decision: EvidenceDecision) {
    if (!row) return;
    if (await mutate("review", { id: row.id, decision, note })) setNotice("근거 검토를 " + decisions[decision] + " 상태로 저장했습니다.");
  }
  return <div className="flow-pane semantic-pane" aria-busy={busy || loading || modelsLoading}>
    <header className="semantic-heading"><div><h2>지식 그래프</h2><p>선택한 자료에서 관계를 모으고, 확인한 근거로 연결을 탐색합니다.</p></div>
      <button className="flow-btn" onClick={onReplica}>파일·설계·실행 관계</button></header>
    <nav className="semantic-tabs" aria-label="지식 그래프 작업">
      <button className={tab === "review" ? "is-active" : ""} aria-pressed={tab === "review"} onClick={() => setTab("review")}>A · 근거 검토 <b>{view?.counts.pending ?? 0}</b></button>
      <button className={tab === "explore" ? "is-active" : ""} aria-pressed={tab === "explore"} onClick={() => setTab("explore")}>B · 관계 탐색 <b>{view?.counts.approved ?? 0}</b></button>
    </nav>
    <ol className="semantic-steps" aria-label="지식 구축 순서"><li>자료 선택</li><li>관계 후보</li><li>근거 검토</li><li>관계 탐색</li></ol>
    {error && <p className="flow-error" role="alert">{error}</p>}
    {notice && <p className="semantic-notice" role="status">{notice}</p>}
    {readOnly && <p className="semantic-muted">조회 전용 연결입니다.</p>}
    {view && <section className={"semantic-projection " + (view.projection.status === "ready" ? "is-ready" : "")} aria-label="그래프 반영 상태">
      <div><strong>{({ ready: "그래프 반영 완료", pending: "그래프 반영 대기", disconnected: "Neo4j 연결 대기", failed: "그래프 반영 실패" })[view.projection.status]}</strong>
        <span>{view.projection.error ?? "승인되고 현재 원문에서 확인되는 근거만 탐색합니다."}</span></div>
      <div className="semantic-actions"><button className="flow-btn" disabled={busy} onClick={() => setTick(t => t + 1)}>새로고침</button>
        {view.projection.status !== "ready" && <button className="flow-btn" disabled={!canWrite} onClick={() => void mutate("sync", {})}>다시 반영</button>}</div>
    </section>}
    {loading && !view && <p>불러오는 중</p>}
    {tab === "review" ? <>
      <section className="semantic-source" aria-label="자료 선택">
        <div className="semantic-section-title"><h3>자료 선택</h3><span>마크다운·텍스트 · 최대 10개</span></div>
        <form className="semantic-source-form" onSubmit={e => { e.preventDefault(); void loadSource(); }}>
          <label>프로젝트 안 문서 경로<input list="semantic-files" value={path} onChange={e => { sourceRequest.current++; setPath(e.target.value); setPreview(null); }} placeholder="knowledge/…/자료.md" disabled={busy} /></label>
          <datalist id="semantic-files">{files.map(p => <option key={p} value={p} />)}</datalist>
          <button className="flow-btn" disabled={!path.trim() || busy}>원문 불러오기</button>
        </form>
        {view && view.sources.length > 0 && <div className="semantic-source-chips">{view.sources.map(s => <button key={s.id} className={sourceId === s.id ? "is-selected" : ""}
          disabled={s.status === "unavailable" || busy} onClick={() => { setSourceId(s.id); void loadSource(s.path); }}>
          {s.path.split("/").at(-1)} <small>{s.status === "changed" ? "원문 변경" : s.status === "unavailable" ? "열람 불가" : s.versions + "판"}</small></button>)}</div>}
        {preview && <div className="semantic-preview">
          <div className="semantic-document"><div className="semantic-section-title"><h3>원문</h3><span>{preview.hash.slice(0, 8)}</span></div>
            <label>문단<select aria-label="문단" value={sourceChunk?.id ?? ""} onChange={e => { setChunkId(e.target.value); setQuote(""); }}>
              {preview.chunks.map(c => <option key={c.id} value={c.id}>{c.line}줄 · {c.heading || c.text.slice(0, 32)}</option>)}</select></label>
            {sourceChunk ? <><small>{sourceChunk.heading || "본문"} · {sourceChunk.line}줄부터</small><pre>{sourceChunk.text}</pre></> : <p>관계를 추가할 본문 문단이 없습니다.</p>}
          </div>
          <div className="semantic-candidate-form"><div className="semantic-section-title"><h3>관계 후보 추가</h3><span>원문에서 확인되는 주장만</span></div>
            <form onSubmit={e => void add(e)}><div className="semantic-triple-input">
              <label>주어<input value={subject} onChange={e => setSubject(e.target.value)} maxLength={160} required disabled={!canWrite} /></label>
              <label>관계<select aria-label="관계" value={predicate} onChange={e => setPredicate(e.target.value as SemanticPredicate)} disabled={!canWrite}>{Object.entries(predicates).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
              <label>대상<input value={object} onChange={e => setObject(e.target.value)} maxLength={160} required disabled={!canWrite} /></label>
            </div><label>정확한 원문 인용<textarea aria-label="정확한 원문 인용" value={quote} onChange={e => setQuote(e.target.value)} placeholder="왼쪽 문단에서 근거 문장을 그대로 복사해주세요." maxLength={4000} required disabled={!canWrite} /></label>
            <button className="flow-btn" disabled={!canWrite || !sourceChunk}>검토 대기로 저장</button></form>
            <div className="semantic-local"><label>추출 담당<select aria-label="추출 담당" value={memberId} onChange={e => setMemberId(e.target.value)} disabled={!canWrite}><option value="">Claude·Codex·LM Studio 선택</option>
              {extractors.length > 0 && <optgroup label="등록한 LLM">{extractors.map(m => <option key={m.id} value={"member:" + m.id}>{m.speaker === "local" ? "LM Studio · " : ""}{m.name} · {m.model}</option>)}</optgroup>}
              {localModels.length > 0 && <optgroup label="LM Studio 대화 모델">{localModels.map(m => <option key={m.id} value={"local:" + m.id}>{m.name}</option>)}</optgroup>}
            </select></label>
              <button className="flow-btn" disabled={!canWrite} onClick={() => void loadLocalModels()}>{modelsLoading ? "모델 목록 읽는 중…" : "LM Studio 모델 불러오기"}</button>
              <button className="flow-btn" disabled={!canWrite || !memberId || !preview.chunks.length} onClick={() => void extract()}>{extracting ? "추출 중…" : "관계 후보 추출"}</button>
              {extracting && <button className="flow-btn" onClick={() => void fetch("/api/knowledge/semantic/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: project }) })}>추출 중지</button>}
              <small>버튼을 누르면 선택한 LLM에 이 문서를 전달합니다. 추출한 후보는 원문과 비교한 뒤 승인해주세요.</small></div>
            {!extractors.length && !localModels.length && <p className="semantic-muted">등록한 LLM을 선택하거나 LM Studio 모델을 불러와 추출할 수 있습니다. 후보는 위에서 직접 추가할 수도 있습니다.</p>}
          </div>
        </div>}
      </section>
      <section className="semantic-review" aria-label="근거 검토">
        <div className="semantic-section-title"><h3>근거 검토</h3><span>현재 근거 {view?.counts.approved ?? 0} · 낡은 근거 {view?.counts.stale ?? 0}</span></div>
        <div className="semantic-filters"><label>자료<select aria-label="자료" value={sourceId} onChange={e => setSourceId(e.target.value)}><option value="">전체 자료</option>{view?.sources.map(s => <option key={s.id} value={s.id}>{s.path.split("/").at(-1)}</option>)}</select></label>
          <label>상태<select aria-label="상태" value={filter} onChange={e => { setFilter(e.target.value as Filter); setSelectedId(""); }}><option value="pending">검토 대기</option><option value="approved">승인</option><option value="stale">원문 변경</option><option value="all">전체 이력</option></select></label><span>{visible.length}건</span></div>
        {row ? <div className="semantic-review-grid"><aside className="semantic-candidates" aria-label="근거 후보 목록">{visible.map(r => <button key={r.id} className={r.id === row.id ? "is-selected" : ""} onClick={() => setSelectedId(r.id)}>
          <strong>{r.subject} → {r.object}</strong><span>{predicates[r.predicate]}</span><small>{r.current ? decisions[r.decision] : "원문 변경 · 재검토 필요"} · {r.path.split("/").at(-1)}</small></button>)}</aside>
          <article className="semantic-evidence"><EvidenceContent row={row} project={project} />
            <label>검토 메모<input value={note} maxLength={4000} onChange={e => setNote(e.target.value)} disabled={!canWrite} placeholder="판단 이유를 남길 수 있습니다." /></label>
            <div className="semantic-actions"><button className="flow-btn is-primary" disabled={!canWrite || !row.current || row.decision === "approved"} onClick={() => void decide("approved")}>근거 승인</button>
              <button className="flow-btn" disabled={!canWrite || row.decision === "rejected"} onClick={() => void decide("rejected")}>기각</button>
              <button className="flow-btn" disabled={!canWrite || row.decision !== "approved"} onClick={() => void decide("withdrawn")}>승인 철회</button>
              <button className="flow-btn" disabled={!canWrite || row.decision === "pending"} onClick={() => void decide("pending")}>다시 검토</button></div>
            {row.history.length > 0 && <details><summary>검토 이력 {row.history.length}</summary><ul>{row.history.map(h => <li key={h.id}><time>{new Date(h.at).toLocaleString("ko-KR")}</time> · {h.decision ? decisions[h.decision] : "추가"}{h.note && " · " + h.note}</li>)}</ul></details>}
          </article></div> : <div className="semantic-empty"><div className="semantic-empty-graph" aria-hidden="true"><span>자료</span><i>→</i><span>관계</span><i>→</i><span>근거</span></div>
          <h3>{rows.length ? "이 조건에 해당하는 근거가 없습니다." : "첫 자료에서 관계를 만들어보세요."}</h3><p>{rows.length ? "자료 또는 상태 필터를 바꿔 확인할 수 있습니다." : "위에서 문서를 불러오고 관계 후보를 추가하면, 원문과 비교하며 승인할 수 있습니다."}</p></div>}
      </section>
    </> : <section className="semantic-explore" aria-label="관계 탐색">
      <form className="semantic-explore-form" onSubmit={e => { e.preventDefault(); setQuery(draft); setEntity(""); setClaimId(""); }}><label>개체 찾기<input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Neo4j, 검색, 프로젝트 이름…" /></label><button className="flow-btn">찾기</button>
        <button type="button" className="flow-btn" onClick={() => { setEntity(""); setQuery(""); setDraft(""); setClaimId(""); }}>전체 관계</button></form>
      <p className="semantic-muted">개체를 누르면 직접 연결된 이웃을 봅니다. 연결선이나 아래 관계를 누르면 원문 근거를 확인합니다.</p>
      {view?.projection.status === "ready" && canvas.nodes.length > 0 ? <>
        <div className="semantic-explore-grid"><div><div className="semantic-canvas" data-canvas="semantic"><ReactFlowProvider><ReactFlow nodes={canvas.nodes} edges={canvas.edges} fitView minZoom={0.12} nodesDraggable={false} nodesConnectable={false}
          onNodeClick={(_e, n) => { setEntity(n.id); setQuery(""); setDraft(""); setClaimId(""); }} onEdgeClick={(_e, edge) => setClaimId(edge.id)} proOptions={{ hideAttribution: true }}>
          <Background /><Controls showInteractive={false} /><RefitOnChange signature={canvas.nodes.map(n => n.id).join(",")} /></ReactFlow></ReactFlowProvider></div>
          <div className="semantic-relations" aria-label="탐색 관계">{view.graph.claims.map(c => {
            const a = view.graph.entities.find(e => e.id === c.from), b = view.graph.entities.find(e => e.id === c.to);
            return <button key={c.id} className={c.id === claimId ? "is-selected" : ""} onClick={() => setClaimId(c.id)}>{a?.name} <span>{predicates[c.predicate]} →</span> {b?.name} <small>근거 {c.evidenceIds.length}</small></button>;
          })}</div></div>
          <aside className="semantic-evidence">{selectedClaim ? <><h3>연결의 원문 근거</h3>{claimRows.map(r => <EvidenceContent key={r.id} row={r} project={project} />)}</> : <div className="semantic-empty"><h3>이 연결은 왜 생겼을까요?</h3><p>관계를 선택하면 인용문과 원문 위치가 여기에 나타납니다.</p></div>}</aside></div>
        {view.graph.truncated && <p className="semantic-muted">최대 80개 근거를 표시합니다. 개체 이름으로 범위를 좁혀주세요.</p>}
      </> : <div className="semantic-empty"><div className="semantic-empty-graph" aria-hidden="true"><span>개체</span><i>↔</i><span>관계</span><i>↔</i><span>개체</span></div><h3>{view?.projection.status === "ready" ? "탐색할 관계가 없습니다." : "그래프 반영을 기다리고 있습니다."}</h3><p>{view?.projection.status === "ready" ? "검색 조건을 바꾸거나 A · 근거 검토에서 관계의 근거를 승인해주세요." : "위의 연결 상태를 확인한 뒤 다시 반영해주세요."}</p>
        <button className="flow-btn" onClick={() => { setTab("review"); setFilter("pending"); }}>근거 검토로 이동</button></div>}
      <p className="semantic-muted">같은 이름이어도 서로 다른 자료의 개체는 분리합니다. 근거 승인은 원문 확인 기록입니다.</p>
    </section>}
    <details className="semantic-maintenance"><summary>그래프 복구</summary><p>검토 기록과 원문 버전에서 의미 그래프를 다시 만듭니다.</p><button className="flow-btn" disabled={!canWrite} onClick={() => void mutate("sync", { rebuild: true })}>원문에서 다시 만들기</button></details>
  </div>;
}

function EvidenceContent({ row, project }: { row: SemanticEvidenceRow; project: string }) {
  return <section className="semantic-evidence-content"><div className="semantic-triple"><strong>{row.subject}</strong><span>{predicates[row.predicate]} →</span><strong>{row.object}</strong></div>
    <div className="semantic-evidence-meta"><span className={"semantic-badge " + row.decision}>{decisions[row.decision]}</span>{!row.current && <span className="semantic-badge stale">원문 변경 · 재검토 필요</span>}<small>{row.model}</small></div>
    <blockquote>{row.quote}</blockquote><p className="semantic-location">{row.path} · 수집 원문 {row.versionHash.slice(0, 8)} · {row.originalLine}줄{row.current && row.line !== row.originalLine ? ` · 현재 ${row.line}줄` : ""} · <a href={"/api/knowledge/semantic/version?" + new URLSearchParams({ alias: project, id: row.versionId })} target="_blank" rel="noreferrer">수집 원문 열기</a></p>
    <details><summary>문단 전체 보기</summary><pre>{row.context}</pre></details></section>;
}

import { Background, Controls, Position, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { matchAssistant, nodeDetail, nodeRunStates, threadForGraph, verticalPosition, type ArchitectureNodeDetail, type NodeRunState } from "./architectureView.js";
import { existingTone, type BuildViewExisting, type BuildViewResponse } from "./buildContract.js";
import { CheckpointRail } from "./FlowPane.js";
import { irNodeText, shortEdgeLabel, toIrCanvas } from "./irCanvas.js";
import type { Ir, IrViewResponse } from "./irContract.js";
import { isFlowViewConnected, type FlowViewResponse } from "./langgraphContract.js";
import { RefitOnChange } from "./RefitOnChange.js";
import type { AdapterStatus } from "./shellContract.js";
import "@xyflow/react/dist/style.css";

/**
 * 아키텍처 — 승인된 설계(IR)의 그래프에 LangGraph 실행 상태를 겹친다 (B안, 사용자 결정 2026-10-16).
 * 노드를 누르면 그 노드가 닿는 것을 보고, 그래프 전체나 그 노드만 실행한다. 실행은 LangGraph가 하고
 * Patchbay는 요청만 넘긴다. 설계가 없으면 그릴 것이 없다 — 빈 화면에서 설계로 보낸다.
 */
type Stage = "design";

const STATE_LABEL: Record<NodeRunState, string> = { now: "● 지금", reached: "✓ 실행됨", idle: "" };

export function ArchitecturePane({
  project,
  revision = 0,
  onOpenStage,
  onLangGraphStatus,
}: {
  project: string;
  revision?: number;
  onOpenStage: (id: Stage) => void;
  onLangGraphStatus?: (status: AdapterStatus) => void;
}) {
  const [design, setDesign] = useState<IrViewResponse | null>(null);
  const [flow, setFlow] = useState<FlowViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [inputOpen, setInputOpen] = useState(false);
  const [inputText, setInputText] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  /** 「이미 구현됨」 길이면 그 요약, 아니면 null. 읽기 전에는 undefined — 그동안 LangGraph를 부르지 않는다. */
  const [existing, setExisting] = useState<BuildViewExisting | null | undefined>(undefined);
  const statusCb = useRef(onLangGraphStatus);
  statusCb.current = onLangGraphStatus;

  useEffect(() => {
    let cancelled = false;
    setSelected(null);
    fetch(`/api/ir?alias=${encodeURIComponent(project)}&source=current`)
      .then(async (res) => {
        const body = (await res.json()) as IrViewResponse | { error: string };
        if (cancelled) return;
        if (!res.ok || "error" in body && !("status" in body)) throw new Error("error" in body ? body.error : `HTTP ${res.status}`);
        setDesign(body as IrViewResponse);
        setError(null);
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [project, revision]);

  const ir: Ir | null = design?.status === "ready" ? design.ir : null;

  useEffect(() => {
    let cancelled = false;
    setExisting(undefined);
    fetch(`/api/build?alias=${encodeURIComponent(project)}`)
      .then((res) => (res.ok ? (res.json() as Promise<BuildViewResponse>) : null))
      .then((body) => { if (!cancelled) setExisting(body?.status === "existing" ? body : null); })
      .catch(() => { if (!cancelled) setExisting(null); });
    return () => { cancelled = true; };
  }, [project, revision]);

  // 사이드카 목록에는 프로젝트 구분이 없다 — 설계의 graph 칸으로 그래프와 스레드를 고른 뒤 한 번 더 읽는다.
  useEffect(() => {
    if (!ir || existing !== null) return;
    let cancelled = false;
    async function load() {
      const first = (await (await fetch("/api/flow")).json()) as FlowViewResponse;
      if (!isFlowViewConnected(first)) return first;
      const assistant = matchAssistant(first.assistants, ir!.graph);
      if (!assistant) return first;
      const thread = threadForGraph(first.threads, assistant.graphId);
      const params = new URLSearchParams({ assistant: assistant.id });
      if (thread) params.set("thread", thread.id);
      const second = (await (await fetch(`/api/flow?${params}`)).json()) as FlowViewResponse;
      return isFlowViewConnected(second) && !thread ? { ...second, selectedThreadId: null, currentNodes: [], history: [], checkpoint: null } : second;
    }
    load()
      .then((body) => {
        if (cancelled) return;
        setFlow(body);
        statusCb.current?.(body.status === "connected" ? "connected" : "disconnected");
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [ir, tick, existing]);

  const connected = flow && isFlowViewConnected(flow) ? flow : null;
  const assistant = connected && ir ? matchAssistant(connected.assistants, ir.graph) : null;
  const states = useMemo(() => nodeRunStates(assistant ? connected : null), [assistant, connected]);
  const canvas = useMemo(() => (ir ? toIrCanvas(ir) : null), [ir]);
  const detail = ir && selected ? nodeDetail(ir, selected) : null;

  async function run(extra: { node?: string; checkpointId?: string }) {
    if (!assistant) return;
    let input: unknown = {};
    if (!extra.node && !extra.checkpointId) {
      try { input = JSON.parse(inputText || "{}"); } catch { setError("입력이 JSON이 아닙니다."); return; }
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/flow/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assistantId: assistant.id, threadId: connected?.selectedThreadId ?? undefined, input, ...extra }),
      });
      const body = (await res.json()) as FlowViewResponse | { error: string };
      if (!res.ok || "error" in body && !("status" in body)) throw new Error("error" in body ? body.error : `HTTP ${res.status}`);
      setFlow(body as FlowViewResponse);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!design) return <section className="arch-page"><h2>아키텍처</h2>{error ? <p className="flow-error">{error}</p> : <p>불러오는 중</p>}</section>;

  if (!ir) {
    const broken = design.status === "broken" && design.hasCurrent;
    return (
      <section className="arch-page">
        <h2>아키텍처</h2>
        <div className="empty arch-empty">
          <h3>{broken ? "승인된 설계를 읽지 못했습니다" : "아직 승인된 설계가 없습니다"}</h3>
          {broken ? <p className="ir-error">{design.error}</p> : (
            <p>이 화면은 승인된 설계(IR)의 노드와 연결을 그리고, 그 그래프를 LangGraph로 실행합니다.
              {design.hasProposed ? " 설계 초안이 있습니다 — 채택하면 여기 그려집니다." : " 설계를 쓰고 채택하면 여기 그려집니다."}</p>
          )}
          <div className="arch-empty-act">
            <button type="button" className="flow-btn primary" onClick={() => onOpenStage("design")}>{design.hasProposed ? "설계 이어 쓰기" : "설계 시작"}</button>
          </div>
        </div>
      </section>
    );
  }

  if (existing) return <ExistingArchitecture ir={ir} view={existing} canvas={canvas!} project={project} selected={selected} onSelect={setSelected} />;

  const runBlocked = !connected ? "LangGraph 연결 안 됨" : !assistant ? `LangGraph에 「${ir.graph || "(graph 칸 비어 있음)"}」 그래프가 없습니다` : null;

  return (
    <section className="arch-page">
      <header className="arch-head">
        <div>
          <h2>아키텍처 · 실행 그래프</h2>
          <p>승인된 설계 v{ir.version}의 그래프입니다. 노드를 눌러 읽고 쓰는 것을 보고, 그래프 전체나 그 노드만 실행합니다.</p>
        </div>
        <div className="arch-actions">
          <span className={`arch-status${assistant ? " is-on" : ""}`} title={connected?.url ?? flow?.url}>
            {runBlocked ?? `LangGraph 연결됨 · ${assistant!.name}`}
          </span>
          <button type="button" className="flow-btn" onClick={() => setTick((n) => n + 1)}>다시 연결</button>
          <button type="button" className="flow-btn" aria-expanded={inputOpen} onClick={() => setInputOpen(!inputOpen)}>입력 편집</button>
          <button type="button" className="flow-btn primary" disabled={busy || Boolean(runBlocked)} title={runBlocked ?? undefined} onClick={() => void run({})}>
            {busy ? "실행 중" : "▶ 그래프 실행"}
          </button>
        </div>
      </header>
      {inputOpen ? (
        <label className="flow-input">
          입력 (JSON) — 그래프 실행에 넘기는 처음 state
          <textarea value={inputText} onChange={(event) => setInputText(event.target.value)} rows={3} spellCheck={false} />
        </label>
      ) : null}
      {error ? <p className="flow-error">{error}</p> : null}
      {connected?.warning ? <p className="flow-error">{connected.warning}</p> : null}
      {assistant && connected?.run.status === "error" && connected.run.error ? <p className="flow-error">실패: {connected.run.error}</p> : null}

      <div className="arch-body">
        <div className="arch-main">
          <p className="arch-legend">
            <span><code>graph: {ir.graph || "—"}</code></span>
            <span>점선 = 조건이 붙은 연결</span>
            <span className="is-now">● 지금 스레드가 기다리는 노드</span>
            <span className="is-reached">✓ 이 스레드에서 실행된 노드</span>
          </p>
          <div className="ir-canvas arch-canvas">
            <ReactFlowProvider>
              <ReactFlow
                nodes={canvas!.nodes.map((node) => {
                  const state = states.get(node.id) ?? "idle";
                  return {
                    id: node.id,
                    position: verticalPosition(node.position),
                    data: { label: <span className="arch-node-text"><b>{irNodeText(node)}</b>{STATE_LABEL[state] ? <small>{STATE_LABEL[state]}</small> : null}</span> },
                    sourcePosition: Position.Bottom,
                    targetPosition: Position.Top,
                    className: [node.className, `is-${state}`, node.id === selected ? "is-selected" : undefined].filter(Boolean).join(" "),
                  };
                })}
                edges={canvas!.edges.map((edge) => ({ ...edge, label: shortEdgeLabel(edge.label) }))}
                onNodeClick={(_event, node) => setSelected(node.id)}
                onPaneClick={() => setSelected(null)}
                fitView
                fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
                nodesDraggable={false}
                nodesConnectable={false}
                proOptions={{ hideAttribution: true }}
              >
                <RefitOnChange signature={`${project}:${ir.version}:${canvas!.nodes.length}`} />
                <Background />
                <Controls showInteractive={false} />
              </ReactFlow>
            </ReactFlowProvider>
          </div>
          {assistant && connected ? (
            connected.history.length > 0
              ? <CheckpointRail entries={connected.history} currentId={connected.checkpoint?.id ?? null} busy={busy} onRewind={(checkpointId) => void run({ checkpointId })} />
              : <p className="arch-legend">이 그래프는 아직 실행 기록이 없습니다. 「▶ 그래프 실행」으로 한 번 돌리면 노드마다 상태가 붙습니다.</p>
          ) : null}
        </div>
        <aside className="arch-side" aria-label="고른 노드">
          {detail ? (
            <NodePanel
              detail={detail}
              state={states.get(detail.id) ?? "idle"}
              busy={busy}
              blocked={runBlocked ?? (!connected?.selectedThreadId ? "이 그래프의 스레드가 아직 없습니다" : null)}
              onRun={() => void run({ node: detail.id })}
            />
          ) : (
            <p className="arch-hint">{selected ? "시작 · 끝은 노드가 아니라 그래프의 양 끝입니다." : "노드를 누르면 여기에 그 노드가 읽고 쓰는 state, 부르는 모델 · 도구, 문서와 요구사항이 나옵니다."}</p>
          )}
        </aside>
      </div>
    </section>
  );
}

function NodePanel({
  detail,
  state,
  busy,
  blocked,
  onRun,
}: {
  detail: ArchitectureNodeDetail;
  state: NodeRunState;
  busy: boolean;
  blocked: string | null;
  onRun: () => void;
}) {
  // 앞 노드들이 만든 state가 이 노드의 입력이라, 이 스레드에서 한 번은 이 노드 차례까지 와 있어야 한다.
  const why = blocked ?? (state === "idle" ? "이 스레드는 아직 이 노드에 닿은 적이 없습니다. 그래프를 먼저 실행하세요." : null);
  return (
    <>
      <div className="arch-side-head">
        <small>LangGraph 노드{STATE_LABEL[state] ? ` · ${STATE_LABEL[state]}` : ""}</small>
        <h3>{detail.label} <code>{detail.id}</code></h3>
      </div>
      <dl className="arch-facts">
        <div><dt>들어옴</dt><dd>{detail.incoming.join(", ") || "—"}</dd></div>
        <div><dt>나감</dt><dd>{detail.outgoing.map((edge) => edge.when ? `${edge.to} (조건)` : edge.to).join(", ") || "—"}</dd></div>
        <div><dt>읽는 state</dt><dd><code>{detail.reads.join(" · ") || "—"}</code></dd></div>
        <div><dt>쓰는 state</dt><dd><code>{detail.writes.join(" · ") || "—"}</code></dd></div>
      </dl>
      <section className="arch-list">
        <h4>모델</h4>
        {detail.models.length ? <ul>{detail.models.map((model) => <li key={model.id}><code>{model.id}</code>{model.provider ? <small>{model.provider}</small> : null}</li>)}</ul> : <p>부르지 않음</p>}
      </section>
      <section className="arch-list">
        <h4>도구</h4>
        {detail.tools.length ? (
          <ul>{detail.tools.map((tool) => (
            <li key={tool.id}>
              <code>{tool.id}</code>
              <small>{tool.via === "mcp" ? `MCP · ${tool.server ?? "서버 미정"}` : "코드"}{tool.caps.length ? ` · ${tool.caps.join(", ")}` : ""}</small>
              {tool.what ? <span>{tool.what}</span> : null}
            </li>
          ))}</ul>
        ) : <p>붙은 도구 없음</p>}
      </section>
      {detail.documents.length ? (
        <section className="arch-list">
          <h4>문서</h4>
          <ul>{detail.documents.map((doc) => <li key={doc.path}><code>{doc.path}</code><small>{doc.when}</small></li>)}</ul>
        </section>
      ) : null}
      {detail.requirements.length ? (
        <section className="arch-list">
          <h4>요구사항</h4>
          <ul>{detail.requirements.map((req) => <li key={req.id}><b>{req.id}</b> <span>{req.text}</span></li>)}</ul>
        </section>
      ) : null}
      <div className="arch-run">
        <button type="button" className="flow-btn primary" disabled={busy || Boolean(why)} title={why ?? undefined} onClick={onRun}>
          {busy ? "실행 중" : "▶ 이 노드만 실행"}
        </button>
        <small>{why ?? "이 노드 직전 체크포인트에서 갈라 이 노드만 돌리고 멈춥니다."}</small>
      </div>
    </>
  );
}

/**
 * 「이미 구현됨」 길의 아키텍처 (사용자 결정 2026-10-20). 실행할 LangGraph 그래프가 없으므로 실행 버튼은 없다.
 * 노드에는 그 노드 요구사항의 통과 수를, 옆에는 요구사항마다 이은 테스트와 결과를 둔다.
 */
function ExistingArchitecture({
  ir,
  view,
  canvas,
  project,
  selected,
  onSelect,
}: {
  ir: Ir;
  view: BuildViewExisting;
  canvas: ReturnType<typeof toIrCanvas>;
  project: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { summary } = view;
  const toneOf = (id: string) => {
    const count = summary.nodes[id];
    if (!count || count.total === 0) return "idle";
    return count.passed === count.total ? "reached" : count.passed > 0 ? "now" : "idle";
  };
  const node = selected ? ir.nodes.find((item) => item.id === selected) ?? null : null;
  const requirements = node ? summary.requirements.filter((req) => req.nodes.includes(node.id)) : [];
  return (
    <section className="arch-page">
      <header className="arch-head">
        <div>
          <h2>아키텍처 · 이미 구현됨</h2>
          <p>승인된 설계 v{ir.version}의 노드마다, 그 요구사항을 지키는 기존 테스트가 통과하는지 봅니다. 연결과 실행은 2 구현 · 3 테스트에서 합니다.</p>
        </div>
        <div className="arch-actions">
          <span className={`arch-status${summary.passed === summary.total && summary.total > 0 ? " is-on" : ""}`}>
            요구사항 이음 {summary.linked}/{summary.total} · 통과 {summary.passed}/{summary.total}
          </span>
        </div>
      </header>
      <div className="arch-body">
        <div className="arch-main">
          <p className="arch-legend">
            <span className="is-reached">✓ 노드의 요구사항이 모두 통과</span>
            <span className="is-now">● 일부 통과</span>
            <span>테두리만 = 아직 통과 없음</span>
          </p>
          <div className="ir-canvas arch-canvas">
            <ReactFlowProvider>
              <ReactFlow
                nodes={canvas.nodes.map((item) => {
                  const count = summary.nodes[item.id];
                  const tone = toneOf(item.id);
                  return {
                    id: item.id,
                    position: verticalPosition(item.position),
                    data: { label: <span className="arch-node-text"><b>{irNodeText(item)}</b>{count ? <small>통과 {count.passed}/{count.total}</small> : null}</span> },
                    sourcePosition: Position.Bottom,
                    targetPosition: Position.Top,
                    className: [item.className, `is-${tone}`, item.id === selected ? "is-selected" : undefined].filter(Boolean).join(" "),
                  };
                })}
                edges={canvas.edges.map((edge) => ({ ...edge, label: shortEdgeLabel(edge.label) }))}
                onNodeClick={(_event, item) => onSelect(item.id)}
                onPaneClick={() => onSelect(null)}
                fitView
                fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
                nodesDraggable={false}
                nodesConnectable={false}
                proOptions={{ hideAttribution: true }}
              >
                <RefitOnChange signature={`${project}:${ir.version}:${canvas.nodes.length}:existing`} />
                <Background />
                <Controls showInteractive={false} />
              </ReactFlow>
            </ReactFlowProvider>
          </div>
        </div>
        <aside className="arch-side" aria-label="고른 노드">
          {node ? (
            <>
              <div className="arch-side-head">
                <small>설계 노드 · 이미 구현됨</small>
                <h3>{node.label || node.id} <code>{node.id}</code></h3>
              </div>
              <section className="arch-list">
                <h4>요구사항 · 이은 테스트</h4>
                {requirements.length ? (
                  <ul>{requirements.map((req) => (
                    <li key={req.id}>
                      <b>{req.id}</b> <span>{req.text}</span>
                      <small className={`ex-tone is-${existingTone(req).tone}`}>{existingTone(req).label}</small>
                      {req.links.filter((link) => link.state === "confirmed").map((link) => (
                        <small key={link.id}><code>{link.file}</code>{link.test ? ` › ${link.test}` : ""}{link.result ? ` — ${link.result.state === "pass" ? "통과" : link.result.state === "fail" ? "실패" : "못 찾음"}` : ""}</small>
                      ))}
                    </li>
                  ))}</ul>
                ) : <p>이 노드에 이어진 요구사항이 없다</p>}
              </section>
            </>
          ) : (
            <p className="arch-hint">{selected ? "시작 · 끝은 노드가 아니라 그래프의 양 끝입니다." : "노드를 누르면 그 노드의 요구사항과, 요구사항마다 이은 테스트 · 결과가 나옵니다."}</p>
          )}
        </aside>
      </div>
    </section>
  );
}

import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { langgraphBoardId, langgraphBoardRef } from "./boardContract.js";
import { compareFlowGraphs, planGraphFromProcess, runtimeGraph } from "./compareFlow.js";
import { toComparedFlowCanvas, toFlowCanvas, type FlowCanvasEdge, type FlowCanvasNode } from "./flowCanvas.js";
import {
  DEFAULT_LANGGRAPH_URL,
  isFlowViewConnected,
  type FlowHistoryEntryView,
  type FlowViewConnected,
  type FlowViewResponse,
} from "./langgraphContract.js";
import { OpsPanel } from "./OpsPanel.js";
import { placeOnCanvas } from "./placeOnCanvas.js";
import { CANVAS_MIN_ZOOM, RefitOnChange } from "./RefitOnChange.js";
import { EMPTY_PROCESS_VIEW, type ProcessView } from "./projectContract.js";
import type { AdapterStatus } from "./shellContract.js";
import "@xyflow/react/dist/style.css";

type LgData = { label: string; current: boolean; lane: "plan" | "actual" | "both"; actualLabel?: string };

function LangGraphNode({ data }: NodeProps<Node<LgData>>) {
  return (
    <div className={`lg-node lg-node-${data.lane}${data.current ? " lg-node-current" : ""}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span>{data.label}</span>
      {data.actualLabel ? <small className="lg-sub">{data.actualLabel}</small> : null}
      {data.lane === "plan" ? <small className="lg-sub">기획만</small> : null}
      {data.lane === "actual" ? <small className="lg-sub">실제만</small> : null}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

const NODE_TYPES = { langgraph: LangGraphNode };

export function FlowPane({
  project,
  revision = 0,
  onLangGraphStatus,
  showOps = true,
}: {
  project: string;
  revision?: number;
  onLangGraphStatus?: (status: AdapterStatus) => void;
  /** false 면 5단계 운영 면을 빼 둔다 — 작업 공간에서 「동작」이 따로 연다. */
  showOps?: boolean;
}) {
  const [view, setView] = useState<FlowViewResponse | null>(null);
  const [process, setProcess] = useState<ProcessView>(EMPTY_PROCESS_VIEW);
  const [error, setError] = useState<string | null>(null);
  const [placeNotice, setPlaceNotice] = useState<string | null>(null);
  const [assistantId, setAssistantId] = useState("");
  const [threadId, setThreadId] = useState("");
  const [inputText, setInputText] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const statusCb = useRef(onLangGraphStatus);
  statusCb.current = onLangGraphStatus;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/project?alias=${encodeURIComponent(project)}`)
      .then(async (res) => {
        const body = (await res.json()) as { process?: ProcessView };
        if (!cancelled && res.ok && body.process) setProcess(body.process);
      })
      .catch(() => {
        if (!cancelled) setProcess(EMPTY_PROCESS_VIEW);
      });
    return () => {
      cancelled = true;
    };
  }, [project, revision]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (assistantId) params.set("assistant", assistantId);
    if (threadId) params.set("thread", threadId);
    const qs = params.toString();
    fetch(qs ? `/api/flow?${qs}` : "/api/flow")
      .then(async (res) => {
        const body = (await res.json()) as FlowViewResponse | { error: string };
        if (cancelled) return;
        if (!res.ok || ("error" in body && !("status" in body))) {
          setError("error" in body ? body.error : `HTTP ${res.status}`);
          return;
        }
        const next = body as FlowViewResponse;
        setError(null);
        setView(next);
        statusCb.current?.(next.status === "connected" ? "connected" : "disconnected");
        if (isFlowViewConnected(next)) {
          if (!assistantId && next.selectedAssistantId) setAssistantId(next.selectedAssistantId);
          if (!threadId && next.selectedThreadId) setThreadId(next.selectedThreadId);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [assistantId, threadId, tick]);

  const connected = view && isFlowViewConnected(view) ? view : null;
  const canvas = useMemo(() => {
    if (!process.configured) {
      return connected ? toFlowCanvas(connected.graph, connected.currentNodes) : { nodes: [], edges: [] };
    }
    const plan = planGraphFromProcess(process);
    const actual = connected ? runtimeGraph(connected.graph) : { nodes: [], edges: [] };
    return toComparedFlowCanvas(
      compareFlowGraphs(plan, actual, process.bind),
      connected?.currentNodes ?? [],
    );
  }, [process, connected]);

  const selectedNode = connected?.graph.nodes.find((node) => node.id === selectedNodeId) ?? null;

  /** `both === 0` while both lanes have nodes means 실행.md and the graph drifted apart. */
  const laneCounts = useMemo(() => {
    const counts = { plan: 0, actual: 0, both: 0 };
    for (const node of canvas.nodes) counts[node.data.lane] += 1;
    return counts;
  }, [canvas]);

  /**
   * `checkpointId` rewinds: LangGraph forks the thread from that snapshot
   * and replays forward. Patchbay still runs nothing itself -- the fork is
   * one field on the same delegated run request.
   */
  async function run(checkpointId?: string) {
    if (!connected?.selectedAssistantId && !assistantId) return;
    let parsed: unknown = {};
    if (!checkpointId && inputText.trim()) {
      try {
        parsed = JSON.parse(inputText) as unknown;
      } catch {
        setError("입력이 JSON이 아닙니다.");
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/flow/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assistantId: assistantId || connected?.selectedAssistantId,
          threadId: threadId || undefined,
          input: parsed,
          ...(checkpointId ? { checkpointId } : {}),
        }),
      });
      const body = (await res.json()) as FlowViewResponse | { error: string };
      if (!res.ok) {
        setError("error" in body ? body.error : `HTTP ${res.status}`);
        if (res.status === 503) onLangGraphStatus?.("disconnected");
        return;
      }
      const next = body as FlowViewResponse;
      setView(next);
      onLangGraphStatus?.(next.status === "connected" ? "connected" : "disconnected");
      if (isFlowViewConnected(next) && next.selectedThreadId) setThreadId(next.selectedThreadId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function placeSelected() {
    const assistant = assistantId || (connected?.selectedAssistantId ?? "");
    if (!connected || !selectedNode || !assistant) return;
    setPlaceNotice(null);
    const result = await placeOnCanvas({
      alias: project,
      id: langgraphBoardId(assistant, selectedNode.id),
      kind: "langgraph",
      ref: langgraphBoardRef(assistant, selectedNode.id),
      title: `${connected.assistants.find((item) => item.id === assistant)?.name ?? assistant} · ${selectedNode.label}`,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPlaceNotice(result.already ? "이미 배치도에 있습니다." : "배치도에 올렸습니다.");
  }

  return (
    <div className="flow-pane">
      {error ? <p className="flow-error">{error}</p> : null}
      {placeNotice ? <p className="board-notice">{placeNotice}</p> : null}
      {showOps ? <OpsPanel project={project} revision={revision + tick} /> : null}
      {!view && !error ? <p>불러오는 중</p> : null}
      {view && view.status === "disconnected" ? (
        <Disconnected url={view.url} onReconnect={() => setTick((n) => n + 1)} />
      ) : null}
      {!process.configured ? (
        <p>레일의 「기획」에서 실행 단계를 정하면, 그 기획 그래프가 실행 그래프 위에 다른 색으로 겹친다.</p>
      ) : (
        <FlowLegend lanes={laneCounts} />
      )}
      {canvas.nodes.length > 0 ? (
        <ComparedCanvas canvas={canvas} onSelectNode={setSelectedNodeId} />
      ) : null}
      {connected ? (
        <Connected
          view={connected}
          assistantId={assistantId}
          threadId={threadId}
          inputText={inputText}
          busy={busy}
          selectedNodeId={selectedNodeId}
          selectedNode={selectedNode}
          onAssistant={(id) => {
            setAssistantId(id);
            setThreadId("");
            setSelectedNodeId(null);
          }}
          onThread={setThreadId}
          onInput={setInputText}
          onReconnect={() => setTick((n) => n + 1)}
          onRun={() => void run()}
          onPlace={() => void placeSelected()}
        />
      ) : null}
    </div>
  );
}

function Disconnected({ url, onReconnect }: { url: string; onReconnect: () => void }) {
  return (
    <div className="empty">
      <h3>LangGraph 연결 안 됨</h3>
      <p>
        실행 그래프는 로컬 LangGraph 런타임이 붙으면 여기에 그린다. 스캔 그래프(<code>/api/graph</code>)와 같은 면이
        아니다.
      </p>
      <p className="path">{url || DEFAULT_LANGGRAPH_URL}</p>
      <p>
        그래프가 있는 레포에서 <code>langgraph dev</code>를 켠 뒤 다시 연결하세요. URL은{" "}
        <code>PATCHBAY_LANGGRAPH_URL</code>로 바꿉니다.
      </p>
      <button type="button" className="flow-btn" data-action="reconnect" onClick={onReconnect}>
        다시 연결
      </button>
    </div>
  );
}

function FlowLegend({ lanes }: { lanes?: { plan: number; actual: number; both: number } }) {
  return (
    <>
      <ul className="flow-legend">
        <li>
          <i className="swatch swatch-plan" aria-hidden="true" />
          기획만 — 이렇게 가려던 길
          {lanes ? <b className="lane-n">{lanes.plan}</b> : null}
        </li>
        <li>
          <i className="swatch swatch-actual" aria-hidden="true" />
          실제만 — 다른 방향으로 이어진 길
          {lanes ? <b className="lane-n">{lanes.actual}</b> : null}
        </li>
        <li>
          <i className="swatch swatch-both" aria-hidden="true" />
          둘 다 — 기획대로 실행
          {lanes ? <b className="lane-n">{lanes.both}</b> : null}
        </li>
      </ul>
      {lanes && lanes.both === 0 && lanes.plan > 0 && lanes.actual > 0 ? (
        <p className="lane-gap">
          선언한 절차와 실제 그래프가 한 단계도 겹치지 않습니다. <code>docs/기획/실행.md</code> 와 LangGraph
          그래프 중 하나가 낡았습니다.
        </p>
      ) : null}
    </>
  );
}

function ComparedCanvas({
  canvas,
  onSelectNode,
}: {
  canvas: { nodes: FlowCanvasNode[]; edges: FlowCanvasEdge[] };
  onSelectNode: (id: string) => void;
}) {
  return (
    <div className="flow-canvas" data-canvas="langgraph">
      <ReactFlowProvider>
        <ReactFlow
          nodes={canvas.nodes}
          edges={canvas.edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={(_event, node) => onSelectNode(node.id)}
          fitView
          minZoom={CANVAS_MIN_ZOOM}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
        >
          <RefitOnChange signature={canvas.nodes.map((node) => node.id).join("|")} />
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

function Connected({
  view,
  assistantId,
  threadId,
  inputText,
  busy,
  selectedNodeId,
  selectedNode,
  onAssistant,
  onThread,
  onInput,
  onReconnect,
  onRun,
  onPlace,
}: {
  view: FlowViewConnected;
  assistantId: string;
  threadId: string;
  inputText: string;
  busy: boolean;
  selectedNodeId: string | null;
  selectedNode: { id: string; label: string } | null;
  onAssistant: (id: string) => void;
  onThread: (id: string) => void;
  onInput: (value: string) => void;
  onReconnect: () => void;
  onRun: (checkpointId?: string) => void;
  onPlace: () => void;
}) {
  const currentLabel = view.currentNodes.length > 0 ? view.currentNodes.join(", ") : "없음";
  return (
    <>
      <div className="flow-toolbar">
        <label>
          그래프
          <select
            value={assistantId || view.selectedAssistantId || ""}
            onChange={(event) => onAssistant(event.target.value)}
            disabled={view.assistants.length === 0}
          >
            {view.assistants.length === 0 ? <option value="">등록된 그래프 없음</option> : null}
            {view.assistants.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          스레드
          <select
            value={threadId || view.selectedThreadId || ""}
            onChange={(event) => onThread(event.target.value)}
            disabled={view.threads.length === 0}
          >
            {view.threads.length === 0 ? <option value="">스레드 없음</option> : null}
            {view.threads.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="flow-btn" data-action="reconnect" onClick={onReconnect}>
          다시 연결
        </button>
        <button
          type="button"
          className="flow-btn"
          data-action="run"
          onClick={() => onRun()}
          disabled={busy || view.assistants.length === 0}
        >
          {busy ? "실행 중" : "실행"}
        </button>
      </div>

      {view.warning ? <p className="flow-error">{view.warning}</p> : null}
      {view.run.status === "error" && view.run.error ? <p className="flow-error">실패: {view.run.error}</p> : null}
      {view.empty === "no_assistants" ? (
        <div className="empty">
          <p>등록된 그래프가 없습니다. 레포의 langgraph.json에 graph를 넣고 langgraph dev를 켜세요.</p>
        </div>
      ) : null}

      <p>
        현재 노드: <code>{currentLabel}</code>
        {view.checkpoint?.id ? (
          <>
            {" "}
            · 체크포인트 <code>{view.checkpoint.id}</code>
          </>
        ) : null}
        {view.run.status === "running" ? " · 실행 중" : null}
      </p>

      <CheckpointRail
        entries={view.history}
        currentId={view.checkpoint?.id ?? null}
        busy={busy}
        onRewind={onRun}
      />
      {selectedNode ? (
        <div className="flow-toolbar">
          <p>
            고른 노드: <code>{selectedNode.label}</code>
            {selectedNodeId && view.currentNodes.includes(selectedNodeId) ? " (현재 실행 위치)" : null}
          </p>
          <button type="button" className="flow-btn" data-action="place" onClick={onPlace}>
            배치도에 올리기
          </button>
        </div>
      ) : (
        <p>노드를 고르면 이 스레드의 원문/정리본과 함께 표시합니다. 원문·정리본은 스레드 state입니다.</p>
      )}

      <div className="flow-panels">
        <section className="flow-panel" data-panel="original">
          <h3>원문</h3>
          {view.original ? <pre>{view.original}</pre> : <p>이 스레드 state에 원문 필드가 없습니다.</p>}
        </section>
        <section className="flow-panel" data-panel="summary">
          <h3>정리본</h3>
          {view.summary ? <pre>{view.summary}</pre> : <p>이 스레드 state에 정리본 필드가 없습니다.</p>}
        </section>
      </div>

      <label className="flow-input">
        입력 (JSON)
        <textarea value={inputText} onChange={(event) => onInput(event.target.value)} rows={4} spellCheck={false} />
      </label>
    </>
  );
}

/**
 * Every checkpoint the thread passed through, oldest first. Picking one asks
 * LangGraph to fork the thread there and replay forward -- no input is sent,
 * the values already stored at that snapshot are the input.
 */
function CheckpointRail({
  entries,
  currentId,
  busy,
  onRewind,
}: {
  entries: FlowHistoryEntryView[];
  currentId: string | null;
  busy: boolean;
  onRewind: (checkpointId: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <section className="ckpt-rail">
      <div className="ckpt-head">
        <h3>체크포인트</h3>
        <span className="ckpt-hint">고르면 그 지점부터 LangGraph가 다시 실행합니다</span>
      </div>
      <ol className="ckpt-track">
        {entries.map((entry, index) => {
          const isCurrent = entry.id === currentId;
          const label = entry.next.length > 0 ? entry.next.join(", ") : "완료";
          return (
            <li key={entry.id} className="ckpt-stop">
              {index > 0 ? <i className="ckpt-wire" aria-hidden="true" /> : null}
              <button
                type="button"
                className={`ckpt-pip${isCurrent ? " is-now" : ""}`}
                disabled={busy}
                aria-current={isCurrent ? "step" : undefined}
                title={entry.id}
                onClick={() => onRewind(entry.id)}
              >
                <span className="ckpt-dot" aria-hidden="true" />
                <span className="ckpt-label">{label}</span>
                <span className="ckpt-time">{clockTime(entry.createdAt)}</span>
                <span className="ckpt-again">여기서 다시</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function clockTime(raw: string | null): string {
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toTimeString().slice(0, 8);
}

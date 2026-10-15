import { Background, Controls, Position, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import {
  generateNote,
  type BuildGenerateResponse,
  type BuildViewReady,
  type BuildViewResponse,
} from "./buildContract.js";
import { FlowPane } from "./FlowPane.js";
import { irNodeText, shortEdgeLabel, toIrCanvas } from "./irCanvas.js";
import { RefitOnChange } from "./RefitOnChange.js";
import type { AdapterStatus } from "./shellContract.js";
import "@xyflow/react/dist/style.css";

/**
 * 2단계(구현)의 자리. **채택 뒤의 입구다** — 설계를 채택하면 여기서 뼈대를 생성하고,
 * 생성된 노드가 승인본과 같은지 본다. 전에는 이 한 걸음만 터미널에 남아 있었다.
 *
 * 위는 뼈대(무엇이 생겼나), 가운데는 승인본 그래프(어느 노드가 코드에 있나), 아래는
 * 실행 중 흐름(LangGraph)이다. 셋 다 같은 승인본을 말하므로 한 화면에 둔다.
 */
export function BuildPane({
  project,
  revision = 0,
  onOpenStage,
  onOpenFile,
  onLangGraphStatus,
}: {
  project: string;
  revision?: number;
  /** 잠겼을 때 1 설계로 돌려보내는 길. */
  onOpenStage: (id: "design") => void;
  onOpenFile?: (path: string) => void;
  onLangGraphStatus?: (status: AdapterStatus) => void;
}) {
  const [view, setView] = useState<BuildViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [flowOpen, setFlowOpen] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/build?alias=${encodeURIComponent(project)}`)
      .then(async (res) => {
        const body = (await res.json()) as BuildViewResponse | { error: string };
        if (cancelled) return;
        if (!res.ok || "error" in body) {
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
  }, [project, revision, tick]);

  // 프로젝트를 바꾸면 앞 프로젝트의 생성 결과가 남아 있지 않게.
  useEffect(() => setNote(null), [project]);

  async function generate() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/build/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: project }),
      });
      const body = (await res.json()) as BuildGenerateResponse;
      setNote(generateNote(body));
      setTick((n) => n + 1);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="flow-error">{error}</p>;
  if (!view) return <p>불러오는 중</p>;

  if (view.status === "locked") {
    return (
      <div className="empty">
        <h2>구현</h2>
        <p>{view.reason}</p>
        <p className="path">{view.next}</p>
        <button type="button" className="flow-btn primary" onClick={() => onOpenStage("design")}>
          1 설계 열기
        </button>
      </div>
    );
  }

  return (
    <>
      <h2>구현</h2>
      <Scaffold view={view} busy={busy} note={note} onGenerate={() => void generate()} onOpenFile={onOpenFile} />
      {/* 실행 흐름은 접어 둔다 — 2단계의 일은 위의 뼈대이고, 이 칸은 LangGraph가 돌 때 들여다보는 면이다.
          펼쳤을 때만 그린다: 닫힌 칸 안에서는 XYFlow가 크기를 못 재서 그래프가 비어 보인다. */}
      <details className="bd-flow" open={flowOpen} onToggle={(event) => setFlowOpen(event.currentTarget.open)}>
        <summary>
          <b>실행 흐름 — LangGraph</b>
          <small>돌고 있는 그래프와 지금 노드 · 한 번 실행해 보기</small>
        </summary>
        {flowOpen ? (
          <FlowPane project={project} revision={revision + tick} onLangGraphStatus={onLangGraphStatus} showTest={false} />
        ) : null}
      </details>
    </>
  );
}

function Scaffold({
  view,
  busy,
  note,
  onGenerate,
  onOpenFile,
}: {
  view: BuildViewReady;
  busy: boolean;
  note: string | null;
  onGenerate: () => void;
  onOpenFile?: (path: string) => void;
}) {
  const canvas = useMemo(() => toIrCanvas(view.ir), [view.ir]);
  const inCode = useMemo(() => new Set(view.nodes.graph), [view.nodes.graph]);

  return (
    <section className="card bd-card">
      <header className="bd-head">
        <span className="sec-title">뼈대 — 승인된 설계에서 한 번 생성한다</span>
        <span className="tag is-done">{view.version === null ? "승인본" : `승인본 v${view.version}`}</span>
        <code className="path">{view.outDir}/</code>
      </header>

      <ul className="bd-files">
        {view.files.map((file) => (
          <li key={file.file} className={file.exists ? "is-on" : undefined}>
            <i className={`ws-dot is-${file.exists ? "done" : "now"}`} aria-hidden="true" />
            {file.exists && onOpenFile ? (
              <button type="button" className="bd-file-open" onClick={() => onOpenFile(file.path)}>
                {file.file}
              </button>
            ) : (
              <b>{file.file}</b>
            )}
            <small>{file.role}</small>
            <span className="bd-file-st">{file.exists ? "있음" : "아직 없음"}</span>
          </li>
        ))}
      </ul>

      <div className="bd-act">
        <button type="button" className="flow-btn primary" onClick={onGenerate} disabled={busy}>
          {busy ? "생성하는 중" : view.generated ? "빠진 파일 생성" : "뼈대 생성"}
        </button>
        {/* 덮지 않는다는 것을 눌러 보고 알게 하지 않는다 (원칙 3 — `--force` 가 없다). */}
        <small>
          있는 파일은 건드리지 않고 없는 것만 쓴다. 2.4부터는 사람이 채운다 — 다시 눌러도 덮이지 않는다.
        </small>
      </div>
      {note ? <p className="ir-note">{note}</p> : null}

      <NodeSet view={view} />

      <div className="ir-canvas bd-canvas">
        <ReactFlowProvider>
          <ReactFlow
            nodes={canvas.nodes.map((node) => ({
              id: node.id,
              position: node.position,
              data: { label: irNodeText(node) },
              sourcePosition: Position.Right,
              targetPosition: Position.Left,
              className: [node.className, node.data.terminal || inCode.has(node.id) ? undefined : "bd-node-todo"]
                .filter(Boolean)
                .join(" "),
            }))}
            edges={canvas.edges.map((edge) => ({ ...edge, label: shortEdgeLabel(edge.label) }))}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            nodesDraggable={false}
            nodesConnectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <RefitOnChange signature={`${canvas.nodes.length}:${canvas.edges.length}:${inCode.size}`} />
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
      <small className="bd-legend">
        점선 노드는 <code>graph.ts</code> 에 아직 없는 노드다 — 승인본에는 있다.
      </small>
    </section>
  );
}

/**
 * 2.6 — 승인본의 노드 집합과 `graph.ts` 의 노드 집합. 어긋나면 어느 쪽에만 있는지까지
 * 말한다. 수를 맞추는 것이 아니라 **어느 노드**인지가 다음에 할 일을 정한다.
 */
function NodeSet({ view }: { view: BuildViewReady }) {
  const { ir, graph, missing, extra, match } = view.nodes;
  if (!view.generated && graph.length === 0) {
    return (
      <p className="bd-nodes">
        노드 집합 — 승인본 {ir.length}개. <code>graph.ts</code> 는 아직 없다.
      </p>
    );
  }
  return (
    <p className={`bd-nodes${match ? "" : " is-off"}`}>
      노드 집합 — 승인본 {ir.length}개 {match ? "=" : "≠"} 코드 {graph.length}개
      {missing.length ? <span>승인본에만: {missing.join(", ")}</span> : null}
      {extra.length ? <span>코드에만: {extra.join(", ")}</span> : null}
    </p>
  );
}

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
import { DocumentCallPanel } from "./DocumentCallPanel.js";
import { FilePeek, isOpenableSourceLabel } from "./FilePeek.js";
import { ImpactPanel } from "./ImpactPanel.js";
import { neo4jBoardId } from "./boardContract.js";
import { KNOWLEDGE_LABEL_NAMES, toKnowledgeCanvas } from "./knowledgeCanvas.js";
import { RunEvidencePanel } from "./RunEvidencePanel.js";
import {
  DEFAULT_NEO4J_URI,
  isKnowledgeViewConnected,
  type KnowledgeViewConnected,
  type KnowledgeViewResponse,
} from "./neo4jContract.js";
import { placeOnCanvas } from "./placeOnCanvas.js";
import type { AdapterStatus } from "./shellContract.js";
import { ScanButton } from "./ScanButton.js";
import "@xyflow/react/dist/style.css";

type KgData = { label: string; kind: string; current: boolean };

function KnowledgeNode({ data }: NodeProps<Node<KgData>>) {
  return (
    <div className={data.current ? "lg-node lg-node-current" : "lg-node"}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="kg-kind">{KNOWLEDGE_LABEL_NAMES[data.kind as keyof typeof KNOWLEDGE_LABEL_NAMES] ?? data.kind}</span>
      <span>{data.label}</span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

const NODE_TYPES = { knowledge: KnowledgeNode };

export function KnowledgePane({
  project,
  revision = 0,
  stage = "graph",
  onNeo4jStatus,
}: {
  project: string;
  revision?: number;
  /** 띠의 어느 칸으로 들어왔나. 4 지식 그래프와 5 문서 호출은 같은 화면이고, 들어온 칸이 위에 온다. 맨 위는 늘 실행 근거 경로. */
  stage?: "graph" | "docs";
  onNeo4jStatus?: (status: AdapterStatus) => void;
}) {
  const [view, setView] = useState<KnowledgeViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placeNotice, setPlaceNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [path, setPath] = useState("");
  const [peekPath, setPeekPath] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const statusCb = useRef(onNeo4jStatus);
  statusCb.current = onNeo4jStatus;

  useEffect(() => {
    setPath("");
    setPeekPath(null);
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    params.set("alias", project);
    if (query) params.set("q", query);
    if (path) params.set("path", path);
    fetch(`/api/knowledge?${params.toString()}`)
      .then(async (res) => {
        const body = (await res.json()) as KnowledgeViewResponse | { error: string };
        if (cancelled) return;
        if (!res.ok || ("error" in body && !("status" in body))) {
          setError("error" in body ? body.error : `HTTP ${res.status}`);
          return;
        }
        const next = body as KnowledgeViewResponse;
        setError(null);
        setView(next);
        statusCb.current?.(next.status === "disconnected" ? "disconnected" : "connected");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [project, query, path, revision, tick]);

  const connected = view && isKnowledgeViewConnected(view) ? view : null;
  const canvas = useMemo(
    () => (connected ? toKnowledgeCanvas(connected.selected, connected.neighbors, connected.edges) : { nodes: [], edges: [] }),
    [connected],
  );

  async function placeSelected() {
    if (!connected?.selected) return;
    setPlaceNotice(null);
    const node = connected.selected;
    const result = await placeOnCanvas({
      alias: project,
      id: neo4jBoardId(node.label, node.path),
      kind: "neo4j",
      ref: node.path,
      title: `${node.label} · ${node.name}`,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPlaceNotice(result.already ? "이미 배치도에 있습니다." : "배치도에 올렸습니다.");
  }

  return (
    <div className="flow-pane">
      <h2>{stage === "docs" ? "문서 호출" : "지식 그래프"}</h2>
      {error ? <p className="flow-error">{error}</p> : null}
      {placeNotice ? <p className="board-notice">{placeNotice}</p> : null}
      <RunEvidencePanel project={project} revision={revision + tick} />
      {stage === "docs" ? (
        <>
          <DocumentCallPanel project={project} seed={path} revision={revision} onOpenFile={setPeekPath} />
          <ImpactPanel project={project} seed={path} revision={revision} onOpenFile={setPeekPath} />
          <h3 className="kg-section">지식 그래프</h3>
        </>
      ) : null}
      {!view && !error ? <p>불러오는 중</p> : null}
      {view?.status === "disconnected" ? (
        <Disconnected uri={view.uri} onReconnect={() => setTick((n) => n + 1)} />
      ) : null}
      {view?.status === "unscanned" ? (
        <div className="empty">
          <p>아직 스캔되지 않았습니다. 스캔하면 스캔 결과가 Neo4j로 복제됩니다.</p>
          <p className="path">{view.path}</p>
          <ScanButton project={view.alias} first onScanned={() => setTick((n) => n + 1)} />
        </div>
      ) : null}
      {connected ? (
        <Connected
          view={connected}
          draft={draft}
          canvas={canvas}
          onDraft={setDraft}
          onSearch={() => setQuery(draft)}
          onSelect={setPath}
          onOpen={(next) => setPeekPath(next)}
          onReconnect={() => setTick((n) => n + 1)}
          onPlace={() => void placeSelected()}
        />
      ) : null}
      {stage === "graph" ? (
        <>
          <h3 className="kg-section">문서 호출</h3>
          <DocumentCallPanel project={project} seed={path} revision={revision} onOpenFile={setPeekPath} />
          <ImpactPanel project={project} seed={path} revision={revision} onOpenFile={setPeekPath} />
        </>
      ) : null}
      {peekPath ? <FilePeek alias={project} path={peekPath} onClose={() => setPeekPath(null)} /> : null}
    </div>
  );
}

function Disconnected({ uri, onReconnect }: { uri: string; onReconnect: () => void }) {
  return (
    <div className="empty">
      <h3>Neo4j 연결 안 됨</h3>
      <p>파일 그래프 검색은 로컬 Neo4j가 붙으면 이 면에서 한다. 임베딩은 v1에 없다.</p>
      <p className="path">{uri || DEFAULT_NEO4J_URI}</p>
      <p>
        <code>dev/</code>에서 <code>docker compose up -d</code> 한 뒤 다시 연결하세요. URI는{" "}
        <code>PATCHBAY_NEO4J_URI</code>, 기본 계정은 <code>neo4j</code> / <code>patchbay</code>입니다.
      </p>
      <button type="button" className="flow-btn" data-action="reconnect" onClick={onReconnect}>
        다시 연결
      </button>
    </div>
  );
}

/**
 * 3.1의 두 집안을 나눠 센다 -- 스캔이 찾은 것과 사람이 적은 설계.
 *
 * One stat row of eight would say「노드가 몇 개다」. Two says whether this graph
 * is worth running a database for, which is what 3.5 judges.
 */
function ReplicaSplit({ view }: { view: KnowledgeViewConnected }) {
  const counts = view.counts;
  return (
    <div className="kg-split">
      <div className="kg-half">
        <div className="kg-half-head">
          스캔 복제본 <span className="kg-half-sub">스캔이 찾은 것 · 관계 {view.replica.scanEdges}</span>
        </div>
        <div className="stats">
          <Stat value={counts.files} label="파일" />
          <Stat value={counts.folders} label="폴더" />
          <Stat value={counts.skills} label="스킬" />
          <Stat value={counts.artifacts} label="산출물" />
        </div>
      </div>
      <div className={`kg-half${view.replica.designEdges === 0 ? " is-warn" : ""}`}>
        <div className="kg-half-head">
          설계 행{" "}
          <span className="kg-half-sub">
            승인된 설계가 적은 것 · 관계 {view.replica.designEdges}
            {view.irVersion === null ? " · 아직 채택 없음" : ` · v${view.irVersion}`}
          </span>
        </div>
        <div className="stats">
          <Stat value={counts.requirements} label="요구사항" />
          <Stat value={counts.evals} label="평가" />
          <Stat value={counts.agentNodes} label="노드" />
          <Stat value={counts.documents} label="문서" />
        </div>
      </div>
      {view.replica.warning ? <p className="kg-replica-warn">{view.replica.warning}</p> : null}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function Connected({
  view,
  draft,
  canvas,
  onDraft,
  onSearch,
  onSelect,
  onOpen,
  onReconnect,
  onPlace,
}: {
  view: KnowledgeViewConnected;
  draft: string;
  canvas: ReturnType<typeof toKnowledgeCanvas>;
  onDraft: (value: string) => void;
  onSearch: () => void;
  onSelect: (path: string) => void;
  onOpen: (path: string) => void;
  onReconnect: () => void;
  onPlace: () => void;
}) {
  // 좁혀 둔 이름으로 한 번만 꺼낸다 -- `view.selected` 를 닫힘 안에서 다시 읽으면
  // 타입이 다시 null 가능으로 넓어진다.
  const selected = view.selected;
  return (
    <>
      <div className="flow-toolbar">
        <label>
          경로·이름
          <input
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSearch();
            }}
            placeholder="README, skill, docs/, 갈래가 버그"
          />
        </label>
        <button type="button" className="flow-btn" data-action="search" onClick={onSearch}>
          찾기
        </button>
        <button type="button" className="flow-btn" data-action="reconnect" onClick={onReconnect}>
          다시 연결
        </button>
      </div>
      {view.warning ? <p className="flow-error">{view.warning}</p> : null}
      <ReplicaSplit view={view} />

      {view.hits.length === 0 ? (
        <div className="empty">
          <p>일치하는 노드가 없습니다. 경로나 이름 일부로 다시 찾으세요. 벡터 검색은 없습니다.</p>
        </div>
      ) : (
        <table className="placeholder-table">
          <thead>
            <tr>
              <th>종류</th>
              <th>경로</th>
              <th>그 행의 말</th>
              <th>항목 주소</th>
            </tr>
          </thead>
          <tbody>
            {view.hits.map((hit) => (
              <tr key={hit.path}>
                <td>{KNOWLEDGE_LABEL_NAMES[hit.label as keyof typeof KNOWLEDGE_LABEL_NAMES] ?? hit.label}</td>
                <td>
                  <button
                    type="button"
                    className="kg-link"
                    onClick={() => onSelect(hit.path)}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      if (isOpenableSourceLabel(hit.label)) onOpen(hit.path);
                    }}
                  >
                    {hit.path}
                  </button>
                </td>
                <td>{hit.text ?? "—"}</td>
                <td>{hit.port ? <code>{hit.port}</code> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected ? (
        <>
          <h3>고른 노드</h3>
          <p>
            <code>{selected.label}</code> · <code>{selected.path}</code>
            {selected.port ? (
              <>
                {" "}
                · port <code>{selected.port}</code>
              </>
            ) : null}
          </p>
          {selected.text ? <p className="doc-when">{selected.text}</p> : null}
          <button type="button" className="flow-btn" data-action="place" onClick={onPlace}>
            배치도에 올리기
          </button>
          {isOpenableSourceLabel(selected.label) ? (
            <button type="button" className="flow-btn" data-action="open-source" onClick={() => onOpen(selected.path)}>
              내용 보기
            </button>
          ) : null}
          <div className="flow-canvas" data-canvas="neo4j">
            <ReactFlowProvider>
              <ReactFlow
                nodes={canvas.nodes}
                edges={canvas.edges}
                nodeTypes={NODE_TYPES}
                onNodeClick={(_event, node) => onSelect(node.id)}
                onNodeDoubleClick={(_event, node) => {
                  const kind = (node.data as KgData).kind;
                  if (isOpenableSourceLabel(kind)) onOpen(node.id);
                }}
                fitView
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable
                proOptions={{ hideAttribution: true }}
              >
                <Background />
                <Controls showInteractive={false} />
              </ReactFlow>
            </ReactFlowProvider>
          </div>
          <h3>이웃</h3>
          {view.neighbors.length === 0 ? (
            <p>이웃이 없습니다.</p>
          ) : (
            <ul className="history">
              {view.neighbors.map((node) => (
                <li key={node.path}>
                  <button
                    type="button"
                    className="kg-link"
                    onClick={() => onSelect(node.path)}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      if (isOpenableSourceLabel(node.label)) onOpen(node.path);
                    }}
                  >
                    {node.label} {node.path}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p>한 번 클릭은 이웃, 두 번 클릭은 파일 내용입니다. 폴더는 내용이 없습니다.</p>
      )}
    </>
  );
}

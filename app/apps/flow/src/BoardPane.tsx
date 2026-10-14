import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FilePeek } from "./FilePeek.js";
import { toBoardCanvas } from "./boardCanvas.js";
import {
  architectureNodeId,
  isArchitectureItemId,
  roundBoardCoord,
  type BoardItemView,
  type BoardKind,
  type BoardView,
} from "./boardContract.js";
import { projectRelPathFromPort } from "@patchbay/core";
import { defaultConsoleSkillSlug } from "./skillContract.js";
import "@xyflow/react/dist/style.css";

type BoardData = { label: string; kind: BoardKind; ref: string };

type ArchNode = {
  id: string;
  label: string;
  layer: string;
  detail: Array<[string, string]>;
};

type ArchMap = {
  title: string;
  nodes: ArchNode[];
};

function BoardNode({ id, data }: NodeProps<Node<BoardData>>) {
  const arch = isArchitectureItemId(id);
  return (
    <div className={`lg-node board-card board-card-${data.kind}${arch ? " board-card-arch" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <span className="kg-kind">{arch ? "구조" : data.kind}</span>
      <span>{data.label}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const NODE_TYPES = { board: BoardNode };

export function BoardPane({
  project,
  revision = 0,
}: {
  project: string;
  revision?: number;
}) {
  const [view, setView] = useState<BoardView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [slug, setSlug] = useState(defaultConsoleSkillSlug(project));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<{ from: string; to: string } | null>(null);
  const [peekPath, setPeekPath] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Node<BoardData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [archMap, setArchMap] = useState<ArchMap | null>(null);
  const [placingArch, setPlacingArch] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/board?alias=${encodeURIComponent(project)}`);
    const body = (await res.json()) as BoardView | { error: string };
    if (!res.ok || "error" in body) {
      setError("error" in body ? body.error : `HTTP ${res.status}`);
      return;
    }
    setError(null);
    setView(body);
  }, [project]);

  const loadArch = useCallback(async () => {
    const res = await fetch(`/api/board/architecture?alias=${encodeURIComponent(project)}`);
    if (!res.ok) {
      setArchMap(null);
      return;
    }
    const body = (await res.json()) as { map?: unknown };
    try {
      const map = asArchMap(body.map);
      setArchMap(map);
    } catch {
      setArchMap(null);
    }
  }, [project]);

  useEffect(() => {
    setSelectedId(null);
    setSelectedEdge(null);
    setNotice(null);
    setPeekPath(null);
    setSlug(defaultConsoleSkillSlug(project));
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
    void loadArch();
  }, [load, loadArch, revision, project]);

  const canvas = useMemo(
    () => (view ? toBoardCanvas(view.items, view.links) : { nodes: [], edges: [] }),
    [view],
  );

  useEffect(() => {
    setNodes(
      canvas.nodes.map((node) => ({
        ...node,
        selected: node.id === selectedId,
      })),
    );
    setEdges(
      canvas.edges.map((edge) => ({
        ...edge,
        selected: selectedEdge?.from === edge.source && selectedEdge?.to === edge.target,
      })),
    );
  }, [canvas, selectedId, selectedEdge]);

  const selectedItem = view?.items.find((item) => item.id === selectedId) ?? null;
  const peekablePath = selectedItem ? boardItemSourcePath(selectedItem) : null;
  const selectedArch =
    selectedId && archMap ? archMap.nodes.find((node) => node.id === architectureNodeId(selectedId)) : null;
  const hasArchitecture = Boolean(view?.items.some((item) => isArchitectureItemId(item.id)));

  function openBoardSource(item: BoardItemView) {
    const rel = boardItemSourcePath(item);
    if (rel) setPeekPath(rel);
  }

  async function mutate(path: string, payload: Record<string, unknown>, okMessage: string) {
    setError(null);
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: project, ...payload }),
    });
    const body = (await res.json()) as BoardView & { error?: string };
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`);
      return;
    }
    setView({ alias: body.alias, items: body.items, links: body.links });
    setNotice(okMessage);
  }

  async function placeArchitecture() {
    setPlacingArch(true);
    setError(null);
    try {
      const res = await fetch("/api/board/architecture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: project }),
      });
      const body = (await res.json()) as BoardView & {
        error?: string;
        placed?: number;
        linked?: number;
        title?: string;
      };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setView({ alias: body.alias, items: body.items, links: body.links });
      await loadArch();
      const added = (body.placed ?? 0) + (body.linked ?? 0);
      setNotice(
        added === 0
          ? `${body.title ?? "아키텍처 구조"}는 이미 배치도에 있습니다.`
          : `${body.title ?? "아키텍처 구조"}를 배치도에 올렸습니다.`,
      );
    } finally {
      setPlacingArch(false);
    }
  }

  async function distill() {
    setError(null);
    const res = await fetch("/api/skill/drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: project, slug }),
    });
    const body = (await res.json()) as { slug?: string; path?: string; error?: string };
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`);
      return;
    }
    setNotice(`초안 ${body.slug}. 실행하지 않습니다. 확정은 「초안 확정」.`);
  }

  async function accept() {
    setError(null);
    const res = await fetch("/api/skill/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    const body = (await res.json()) as { slug?: string; path?: string; error?: string };
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`);
      return;
    }
    setNotice(`확정 ${body.slug}. 설치는 「프로젝트에 설치」. 워커를 켜지 않습니다.`);
  }

  async function install() {
    setError(null);
    const res = await fetch("/api/skill/patch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, alias: project }),
    });
    const body = (await res.json()) as { slug?: string; install?: string; error?: string };
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`);
      return;
    }
    const how = body.install === "symlink" ? "링크" : "복사";
    setNotice(`설치 ${body.slug} → 프로젝트 skills/${body.slug}/ (${how}). 실제 연결로 기록했습니다. 워커를 켜지 않습니다.`);
  }

  const onNodesChange = useCallback((changes: NodeChange<Node<BoardData>>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);

  function onConnect(connection: Connection) {
    if (!connection.source || !connection.target) return;
    void mutate("/api/board/link", { from: connection.source, to: connection.target }, "연결을 표시했습니다. 실행이 아닙니다.");
  }

  return (
    <div className="flow-pane board-pane">
      <h2>배치도</h2>
      <p className="board-lead">
        올린 항목을 놓고 연결을 표시하는 자리. 표시만 하고 실행하지 않는다 — 실행은 LangGraph, 검색은 Neo4j.
      </p>
      {error ? <p className="flow-error">{error}</p> : null}
      {notice ? <p className="board-notice">{notice}</p> : null}
      {!view && !error ? <p>불러오는 중</p> : null}
      {view ? (
        <div className="flow-toolbar">
          <button
            type="button"
            className="flow-btn"
            data-action="architecture"
            disabled={placingArch}
            onClick={() => void placeArchitecture()}
          >
            {hasArchitecture ? "아키텍처 구조 채우기" : "아키텍처 구조 올리기"}
          </button>
          {view.items.length > 0 ? (
            <>
              {/* 스킬로 만들기는 순서가 있는 세 걸음이다 — 버튼 넷을 나란히 두면 순서가 안 보였다. */}
              <div className="board-skill" role="group" aria-label="배치도를 스킬로 만들기">
                <span className="board-skill-title">스킬로 만들기</span>
                <input
                  value={slug}
                  aria-label="스킬 이름"
                  placeholder="스킬 이름"
                  onChange={(event) => setSlug(event.target.value)}
                  spellCheck={false}
                />
                <button type="button" className="flow-btn" data-action="distill" onClick={() => void distill()}>
                  <i>1</i>초안 만들기
                </button>
                <button type="button" className="flow-btn" data-action="accept" onClick={() => void accept()}>
                  <i>2</i>초안 확정
                </button>
                <button type="button" className="flow-btn" data-action="patch" onClick={() => void install()}>
                  <i>3</i>프로젝트에 설치
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {view && view.items.length === 0 ? (
        <div className="empty">
          <p>
            지금은 올린 항목이 없다. 「아키텍처 구조 올리기」로 이 프로젝트 맵을 배치하거나, 흐름·지식에서 「배치도에
            올리기」를 누르세요.
          </p>
        </div>
      ) : null}
      {view && view.items.length > 0 ? (
        <>
          <div className="flow-canvas board-canvas" data-canvas="board">
            <ReactFlowProvider>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={(_event, node) => {
                  setSelectedId(node.id);
                  setSelectedEdge(null);
                }}
                onNodeDoubleClick={(_event, node) => {
                  const item = view?.items.find((entry) => entry.id === node.id);
                  if (item) openBoardSource(item);
                }}
                onEdgeClick={(_event, edge) => {
                  setSelectedEdge({ from: edge.source, to: edge.target });
                  setSelectedId(null);
                }}
                onPaneClick={() => {
                  setSelectedId(null);
                  setSelectedEdge(null);
                }}
                onNodeDragStop={(_event, node) => {
                  void mutate(
                    "/api/board/move",
                    { id: node.id, x: roundBoardCoord(node.position.x), y: roundBoardCoord(node.position.y) },
                    "자리를 저장했습니다.",
                  );
                }}
                onNodesDelete={(deleted) => {
                  for (const node of deleted) {
                    void mutate("/api/board/remove", { id: node.id }, "보드에서 제거했습니다.");
                  }
                  setSelectedId(null);
                }}
                onEdgesDelete={(deleted) => {
                  for (const edge of deleted) {
                    void mutate("/api/board/unlink", { from: edge.source, to: edge.target }, "연결을 지웠습니다.");
                  }
                  setSelectedEdge(null);
                }}
                nodesDraggable
                nodesConnectable
                elementsSelectable
                deleteKeyCode={["Backspace", "Delete"]}
                fitView
                fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
                proOptions={{ hideAttribution: true }}
              >
                <Background />
                <Controls />
              </ReactFlow>
            </ReactFlowProvider>
          </div>
          <div className="flow-toolbar">
            {selectedItem ? (
              <>
                <p>
                  고른 항목: <code>{selectedItem.kind}</code> · <code>{selectedItem.ref}</code>
                  {selectedArch ? ` · ${selectedArch.layer}` : ""}
                </p>
                <button
                  type="button"
                  className="flow-btn"
                  data-action="remove"
                  onClick={() => {
                    void mutate("/api/board/remove", { id: selectedItem.id }, "보드에서 제거했습니다.").then(() => {
                      setSelectedId(null);
                    });
                  }}
                >
                  보드에서 제거
                </button>
                {peekablePath ? (
                  <button type="button" className="flow-btn" data-action="open-source" onClick={() => setPeekPath(peekablePath)}>
                    내용 보기
                  </button>
                ) : null}
              </>
            ) : null}
            {selectedEdge ? (
              <>
                <p>
                  고른 연결: <code>{selectedEdge.from}</code> → <code>{selectedEdge.to}</code>
                </p>
                <button
                  type="button"
                  className="flow-btn"
                  data-action="unlink"
                  onClick={() => {
                    void mutate(
                      "/api/board/unlink",
                      { from: selectedEdge.from, to: selectedEdge.to },
                      "연결을 지웠습니다.",
                    ).then(() => setSelectedEdge(null));
                  }}
                >
                  연결 제거
                </button>
              </>
            ) : null}
            {!selectedItem && !selectedEdge ? <p>항목을 끌어 자리를 남기고, 핸들로 이으면 표시만 됩니다.</p> : null}
          </div>
          {selectedArch && selectedArch.detail.length > 0 ? (
            <table className="placeholder-table board-arch-detail">
              <thead>
                <tr>
                  <th colSpan={2}>{selectedArch.label}</th>
                </tr>
              </thead>
              <tbody>
                {selectedArch.detail.map((row) => (
                  <tr key={`${selectedArch.id}-${row[0]}`}>
                    <td>{row[0]}</td>
                    <td>{row[1]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : null}
      {peekPath ? <FilePeek alias={project} path={peekPath} onClose={() => setPeekPath(null)} /> : null}
    </div>
  );
}

function boardItemSourcePath(item: BoardItemView): string | null {
  if (item.kind === "neo4j") return item.ref;
  if (item.kind === "port") return projectRelPathFromPort(item.ref);
  return null;
}

function asArchMap(raw: unknown): ArchMap | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (!Array.isArray(rec.nodes)) return null;
  const nodes: ArchNode[] = [];
  for (const entry of rec.nodes) {
    if (!entry || typeof entry !== "object") continue;
    const node = entry as Record<string, unknown>;
    const id = typeof node.id === "string" ? node.id : "";
    const label = typeof node.label === "string" ? node.label : "";
    const layer = typeof node.layer === "string" ? node.layer : "구조";
    if (!id || !label) continue;
    const detail: Array<[string, string]> = [];
    if (Array.isArray(node.detail)) {
      for (const row of node.detail) {
        if (!Array.isArray(row) || typeof row[0] !== "string" || typeof row[1] !== "string") continue;
        detail.push([row[0], row[1]]);
      }
    }
    nodes.push({ id, label, layer, detail });
  }
  if (nodes.length === 0) return null;
  const title = typeof rec.title === "string" && rec.title.trim() ? rec.title.trim() : "아키텍처 구조";
  return { title, nodes };
}

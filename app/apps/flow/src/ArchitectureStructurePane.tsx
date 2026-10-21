import { Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, type EdgeProps, type NodeProps } from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import type { StructureResponse } from "./structureFile.js";
import { layoutStructure, type StructureLayout } from "./structureLayout.js";
import {
  breadcrumb, elementDetail, renderView, ROLE_LABEL, ROLE_MEANING, STRUCTURE_ROLES, upViewFor, viewTab,
  type RenderedView, type StructureModel, type StructureRole, type StructureView,
} from "./structureModel.js";
import "@xyflow/react/dist/style.css";

/**
 * 아키텍처의 구조 · 흐름 장 (R3.4). 한 번 누르기는 선택(옆 설명 · 맞닿은 선만 밝힘), 「안으로」는 버튼으로 다음 그림.
 * 빵 부스러기는 초점의 부모 사슬, 「뒤로」만 방문 이력이다. 구조 · 흐름 장에는 실행 상태를 겹치지 않는다.
 */
type EdgeData = { points: { x: number; y: number }[]; label: { x: number; y: number; width: number; height: number } | null; text: string; dashed: boolean; dim: boolean; step?: number; effect?: "read" | "write" };
type NodeData = { label: string; role: StructureRole | null; kind: "element" | "boundary" | "gap"; inside: number; incomplete: string[]; evidence: string | null; dim: boolean; selected: boolean };

function ElkEdge({ data, markerEnd }: EdgeProps) {
  const d = data as EdgeData;
  if (d.points.length < 2) return null;
  const path = d.points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  return <>
    <BaseEdge path={path} markerEnd={markerEnd} className={`structure-edge${d.dashed ? " is-dashed" : ""}${d.dim ? " is-dim" : ""}`} />
    {d.label ? <EdgeLabelRenderer><span className={`structure-edge-label${d.dim ? " is-dim" : ""}`} style={{ transform: `translate(${d.label.x}px, ${d.label.y}px)`, width: d.label.width }}>{d.step ? <b>{d.step}</b> : null}{d.text}{d.effect ? <small>{d.effect === "write" ? " · 쓰기" : " · 읽기"}</small> : null}</span></EdgeLabelRenderer> : null}
  </>;
}

function StructureNode({ data }: NodeProps) {
  const d = data as NodeData;
  return <div className={`structure-node is-${d.kind}${d.role ? ` role-${d.role}` : ""}${d.dim ? " is-dim" : ""}${d.selected ? " is-selected" : ""}`}>
    <Handle type="target" position={Position.Top} className="structure-handle" />
    {d.kind === "gap" ? <span>미확인 자리</span> : <>
      <small>{d.role ? ROLE_LABEL[d.role] : ""}{d.kind === "boundary" ? " · 경계" : ""}{d.evidence ? "" : " · 미확인"}</small>
      <b>{d.label}</b>
      {d.incomplete.length ? <small className="structure-incomplete">미완 · {d.incomplete.join(" · ")}</small> : null}
      {d.inside ? <small className="structure-inside" aria-label="안으로 들어갈 그림이 있다">▾ 안쪽 {d.inside}</small> : null}
    </>}
    <Handle type="source" position={Position.Bottom} className="structure-handle" />
  </div>;
}

/** 장이 바뀌면 맞춰 보되 0.8 아래로 줄이지 않는다 — 구조 장 전체를 한 칸에 넣으면 글자를 못 읽는다(2026-10-21 확인). 나머지는 끌어서 본다. */
function StructureRefit({ signature }: { signature: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const timer = window.setTimeout(() => void fitView({ padding: 0.08, minZoom: 0.8, maxZoom: 1 }), 80);
    return () => window.clearTimeout(timer);
  }, [signature, fitView]);
  return null;
}

const NODE_TYPES = { structure: StructureNode };
const EDGE_TYPES = { elk: ElkEdge };
const TAB_LABEL = { run: "실행", structure: "구조", flow: "흐름" } as const;

export function ArchitectureStructurePane({ project, revision = 0, tab, onTab, onOpenRun }: {
  project: string; revision?: number; tab: "structure" | "flow";
  onTab: (tab: "run" | "structure" | "flow") => void;
  onOpenRun: () => void;
}) {
  const [body, setBody] = useState<StructureResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<StructureRole>>(() => new Set());
  const [laid, setLaid] = useState<StructureLayout | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBody(null); setError(null); setViewId(null); setHistory([]); setSelected(null);
    fetch(`/api/structure?alias=${encodeURIComponent(project)}`).then(async res => {
      const next = await res.json() as StructureResponse & { error?: string };
      if (!res.ok) throw new Error(next.error ?? `HTTP ${res.status}`);
      if (!cancelled) setBody(next);
    }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [project, revision]);

  const model: StructureModel | null = body?.status === "ready" ? body.model : null;
  // 칸을 바꾸면 그 칸의 첫 장으로. 지금 장이 이미 그 칸이면 그대로.
  const current: StructureView | null = useMemo(() => {
    if (!model) return null;
    const now = viewId ? model.views.find(view => view.id === viewId) : undefined;
    if (now && viewTab(now) === tab) return now;
    return model.views.find(view => viewTab(view) === tab && (tab === "flow" || view.kind === "structure")) ?? null;
  }, [model, viewId, tab]);
  const rendered: RenderedView | null = useMemo(() => (model && current ? renderView(model, current.id) : null), [model, current]);

  useEffect(() => {
    if (!rendered) { setLaid(null); return; }
    let cancelled = false;
    void layoutStructure(rendered).then(next => { if (!cancelled) setLaid(next); }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [rendered]);

  function go(next: StructureView, select: string | null = null) {
    if (next.kind === "run") { onOpenRun(); return; }
    if (current) setHistory(rows => [...rows, current.id]);
    setViewId(next.id); setSelected(select);
    const nextTab = viewTab(next);
    if (nextTab !== tab) onTab(nextTab);
  }
  function back() {
    const prev = history.at(-1);
    if (!prev || !model) return;
    const view = model.views.find(row => row.id === prev);
    setHistory(rows => rows.slice(0, -1));
    if (!view) return;
    setViewId(view.id); setSelected(null);
    const nextTab = viewTab(view);
    if (nextTab !== "run" && nextTab !== tab) onTab(nextTab);
  }

  const head = <header className="arch-head">
    <div>
      <h2>아키텍처 · {TAB_LABEL[tab]}</h2>
      <p>{tab === "structure" ? "무엇이 있고 어디에 저장되나 — 처리 · 저장 · 바깥과 그 사이를 흐르는 데이터." : "한 일이 어떻게 처리되어 저장되나 — 시나리오 하나를 순서대로."}</p>
    </div>
  </header>;

  if (error) return <section className="arch-page">{head}<p className="flow-error">{error}</p></section>;
  if (!body) return <section className="arch-page">{head}<p>불러오는 중</p></section>;
  if (body.status !== "ready") return <section className="arch-page">{head}<div className="empty arch-empty">
    <h3>{body.status === "missing" ? "구조도가 아직 없습니다" : "구조도를 읽지 못했습니다"}</h3>
    <p>{body.status === "missing" ? <>프로젝트 문서 폴더에 <code>{body.rel}</code>을 두면 여기 그려집니다. 요소(처리 · 저장 · 바깥 · 사람), 그 사이 데이터 연결, 장(구조 · 분해 · 시나리오 · 실행)을 적습니다.</> : <><code>{body.rel}</code> — {body.error}</>}</p>
  </div></section>;
  if (!current || !rendered) return <section className="arch-page">{head}<div className="empty arch-empty"><h3>{tab === "flow" ? "시나리오가 없습니다" : "구조 장이 없습니다"}</h3><p>{tab === "flow" ? "구조 장에서 요소를 고르고 「안으로」 — 시나리오가 있는 요소면 흐름 장으로 들어옵니다." : "구조도에 kind가 structure인 장을 하나 둡니다."}</p></div></section>;

  const visible = (id: string): boolean => {
    const node = rendered.nodes.find(row => row.id === id);
    if (!node) return false;
    if (node.kind === "gap") {
      // 미확인 자리는 필터를 받지 않고, 맞은편 끝이 보일 때만 보인다.
      const edge = rendered.edges.find(row => row.source === id || row.target === id);
      const other = edge ? (edge.source === id ? edge.target : edge.source) : null;
      return !!other && visible(other);
    }
    return !node.role || !hidden.has(node.role);
  };
  const near = new Set<string>();
  if (selected) for (const edge of rendered.edges) if (edge.source === selected || edge.target === selected) { near.add(edge.source); near.add(edge.target); }
  const position = new Map(laid?.nodes.map(node => [node.id, node]) ?? []);
  const nodes = laid ? rendered.nodes.filter(node => visible(node.id)).map(node => ({
    id: node.id, type: "structure", position: { x: position.get(node.id)?.x ?? 0, y: position.get(node.id)?.y ?? 0 },
    style: { width: position.get(node.id)?.width, height: position.get(node.id)?.height },
    data: { label: node.label, role: node.role, kind: node.kind, inside: node.inside, incomplete: node.incomplete, evidence: node.evidence, dim: !!selected && !near.has(node.id), selected: node.id === selected } satisfies NodeData,
  })) : [];
  const routes = new Map(laid?.edges.map(edge => [edge.id, edge]) ?? []);
  const edges = laid ? rendered.edges.filter(edge => visible(edge.source) && visible(edge.target)).map(edge => ({
    id: edge.id, source: edge.source, target: edge.target, type: "elk", markerEnd: "structure-arrow",
    data: { points: routes.get(edge.id)?.points ?? [], label: routes.get(edge.id)?.label ?? null, text: edge.label, dashed: edge.dashed, dim: !!selected && edge.source !== selected && edge.target !== selected, ...(edge.step ? { step: edge.step } : {}), ...(edge.effect ? { effect: edge.effect } : {}) } satisfies EdgeData,
  })) : [];
  const detail = selected ? elementDetail(model!, rendered, selected) : null;
  const crumbs = breadcrumb(model!, current.id);

  return (
    <section className="arch-page">
      {head}
      <nav className="structure-crumbs" aria-label="지금 장의 위치">
        <button type="button" className="flow-btn" disabled={!history.length} onClick={back}>← 뒤로</button>
        {crumbs.map((view, index) => <span key={view.id}>{index ? <i aria-hidden="true">›</i> : null}{view.id === current.id ? <b>{view.title}</b> : <button type="button" className="structure-crumb" onClick={() => go(view)}>{view.title}</button>}</span>)}
      </nav>
      <p className="structure-scope">{rendered.scope}</p>
      {body.issues.length ? <details className="structure-issues"><summary>구조도 검사 {body.issues.length}건 — 그림이 틀렸을 수 있다</summary><ul>{body.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></details> : null}
      <div className="arch-body">
        <div className="arch-main">
          <p className="arch-legend structure-legend">
            {STRUCTURE_ROLES.map(role => <label key={role} title={ROLE_MEANING[role]} className={`role-${role}`}><input type="checkbox" checked={!hidden.has(role)} onChange={() => setHidden(prev => { const next = new Set(prev); if (next.has(role)) next.delete(role); else next.add(role); return next; })} /> {ROLE_LABEL[role]}</label>)}
            <span>점선 = 근거를 확인하지 않은 연결</span>
            {current.kind === "decomposition" ? <span>미확인 자리 = 바깥 연결이 안의 어느 부분에 닿는지 아직 적지 않은 곳</span> : null}
          </p>
          <div className="ir-canvas arch-canvas structure-canvas">
            <svg width="0" height="0" aria-hidden="true"><defs><marker id="structure-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="structure-arrow" /></marker></defs></svg>
            <ReactFlowProvider>
              <ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES}
                onNodeClick={(_event, node) => setSelected(node.id)} onPaneClick={() => setSelected(null)}
                minZoom={0.3} nodesDraggable={false} nodesConnectable={false} proOptions={{ hideAttribution: true }}>
                <StructureRefit signature={`${project}:${current.id}:${nodes.length}:${laid?.width ?? 0}`} />
                <Background />
                <Controls showInteractive={false} />
              </ReactFlow>
            </ReactFlowProvider>
          </div>
        </div>
        <aside className="arch-side" aria-label="고른 요소">
          {!detail ? <p className="arch-hint">요소를 누르면 역할, 읽고 쓰는 저장, 근거, 이 장의 연결이 여기에 나옵니다. 안쪽이 있는 요소는 「안으로」로 다음 그림을 엽니다.</p>
            : detail.node.kind === "gap" ? <><div className="arch-side-head"><small>미확인 자리</small><h3>「{rendered.edges.find(edge => edge.source === selected || edge.target === selected)?.label}」</h3></div><p className="arch-hint">이 바깥 연결이 안의 어느 부분에 닿는지 아직 적지 않았다. 구조도에 via 선을 적으면 부분에 닿는다.</p></>
            : <>
              <div className="arch-side-head"><small>{detail.node.role ? ROLE_LABEL[detail.node.role] : ""}{detail.node.kind === "boundary" ? " · 경계 — 이 장의 바깥" : ""}</small><h3>{detail.node.label}</h3>{detail.note ? <p className="arch-hint">{detail.note}</p> : null}</div>
              <dl className="arch-facts">
                <div><dt>근거</dt><dd>{detail.node.evidence ?? "미확인"}</dd></div>
                {detail.reads.length ? <div><dt>읽는 저장</dt><dd>{detail.reads.join(" · ")}</dd></div> : null}
                {detail.writes.length ? <div><dt>쓰는 저장</dt><dd>{detail.writes.join(" · ")}</dd></div> : null}
                {detail.node.incomplete.length ? <div><dt>미완</dt><dd>{detail.node.incomplete.join(" · ")}</dd></div> : null}
              </dl>
              {detail.edges.length ? <div><small className="structure-side-label">이 장의 연결</small><ul className="structure-edge-list">{detail.edges.map(edge => <li key={edge.id}><span>{edge.direction === "나감" ? "→" : "←"} {edge.other}</span> <b>{edge.label}</b> <small>{edge.evidence ?? "미확인"}</small></li>)}</ul></div> : null}
              {detail.node.kind === "boundary" ? (() => { const up = upViewFor(model!, detail.node.id); return up && up.id !== current.id ? <button type="button" className="flow-btn" onClick={() => go(up, detail.node.id)}>위 장으로 — {up.title}</button> : null; })()
                : detail.destinations.length === 1 ? <button type="button" className="flow-btn primary" onClick={() => go(detail.destinations[0]!)}>안으로 — {detail.destinations[0]!.title} ({TAB_LABEL[viewTab(detail.destinations[0]!)]} 장)</button>
                : detail.destinations.length > 1 ? <div className="structure-dest"><small className="structure-side-label">안으로</small>{detail.destinations.map(view => <button type="button" key={view.id} className="flow-btn" onClick={() => go(view)}>{view.title} <small>{TAB_LABEL[viewTab(view)]} 장</small></button>)}</div>
                : null}
            </>}
        </aside>
      </div>
    </section>
  );
}

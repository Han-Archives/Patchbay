import { Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, type NodeProps } from "@xyflow/react";
import type { ReactNode } from "react";
import "@xyflow/react/dist/style.css";
import { CANVAS_MIN_ZOOM, RefitOnChange } from "./RefitOnChange.js";
import type { StageState } from "./workspaceContract.js";

/**
 * Patchbay의 고리 — 설계 → 구현(LangGraph) → 테스트 → 검토. 검토에서 반려되면 설계로 돌아가고, 승인되면 결과로 간다
 * (사용자 결정 2026-10-15 — 셋째 단계 이름을 테스트로, 승인되면 결과). 승인 · 반려를 기록하는 검토 화면은 아직 없다.
 * 지식 그래프 · 문서 호출은 단계가 아니라 도구라 여기 넣지 않는다 (사용자 정리 2026-10-12).
 * 색은 콘솔 규칙을 따른다: 지난 단계 보라 · 지금 주황 · 남은 단계 점선.
 */
export type CycleStep = "design" | "build" | "test" | "review" | "result";
export type StepState = "done" | "now" | "next";
export interface SubStep { label: string; title?: string; state: StepState }

export const CYCLE_LABEL: Record<CycleStep, string> = { design: "설계", build: "구현", test: "테스트", review: "Review", result: "결과" };

/** 칸마다 들어오는 · 나가는 연결점. 검토는 나가는 길이 둘(승인 → 결과, 반려 → 설계)이라 연결점에 이름을 붙인다. */
const LAYOUT: { id: CycleStep; x: number; y: number; targets: { id: string; pos: Position }[]; sources: { id: string; pos: Position }[] }[] = [
  { id: "design", x: 0, y: 0, targets: [{ id: "in", pos: Position.Bottom }], sources: [{ id: "out", pos: Position.Right }] },
  { id: "build", x: 240, y: 0, targets: [{ id: "in", pos: Position.Left }], sources: [{ id: "out", pos: Position.Right }] },
  { id: "test", x: 480, y: 0, targets: [{ id: "in", pos: Position.Left }], sources: [{ id: "out", pos: Position.Bottom }] },
  { id: "review", x: 240, y: 140, targets: [{ id: "in", pos: Position.Top }], sources: [{ id: "approve", pos: Position.Right }, { id: "reject", pos: Position.Left }] },
  { id: "result", x: 480, y: 140, targets: [{ id: "in", pos: Position.Left }], sources: [] },
];

function CycleNode({ data }: NodeProps) {
  const d = data as { label: ReactNode; targets: { id: string; pos: Position }[]; sources: { id: string; pos: Position }[] };
  return <>
    {d.targets.map((t) => <Handle key={t.id} id={t.id} type="target" position={t.pos} />)}
    {d.label}
    {d.sources.map((s) => <Handle key={s.id} id={s.id} type="source" position={s.pos} />)}
  </>;
}
const NODE_TYPES = { cycle: CycleNode };

/** 세 단계 중 처음으로 끝나지 않은 곳. 모두 지났으면 검토 차례다. 결과는 검토에서 승인된 뒤에만 — 아직 승인 기록이 없다. */
export function cycleCurrent(stages: StageState[]): CycleStep {
  for (const id of ["design", "build", "test"] as const) {
    const stage = stages.find((row) => row.id === id);
    if (!stage || stage.tone !== "done") return id;
  }
  return "review";
}

/** 단계의 색 — 지금 단계 앞은 지남, 뒤는 남음. */
export function cycleState(step: CycleStep, current: CycleStep): StepState {
  const order: CycleStep[] = ["design", "build", "test", "review", "result"];
  const a = order.indexOf(step), b = order.indexOf(current);
  return a < b ? "done" : a === b ? "now" : "next";
}

/** 지난 세부 단계 · 처음 남은 하나는 「지금」(지금 단계일 때만) · 나머지는 남음. */
export function markSteps(items: { label: string; title?: string; done: boolean }[], active: boolean): SubStep[] {
  let marked = false;
  return items.map((item): SubStep => {
    if (item.done) return { label: item.label, title: item.title, state: "done" };
    if (active && !marked) { marked = true; return { label: item.label, title: item.title, state: "now" }; }
    return { label: item.label, title: item.title, state: "next" };
  });
}

export function ProjectCycleFlow({ stages, steps, selected, onSelect }: {
  stages: StageState[];
  steps: Record<CycleStep, SubStep[]>;
  selected: CycleStep;
  onSelect: (step: CycleStep) => void;
}) {
  const current = cycleCurrent(stages);
  const nodes = LAYOUT.map((place) => {
    const state = cycleState(place.id, current);
    const stage = place.id === "review" || place.id === "result" ? undefined : stages.find((row) => row.id === place.id);
    const list = steps[place.id];
    const doneCount = list.filter((s) => s.state === "done").length;
    const status = place.id === "review" ? (state === "now" ? "테스트를 마쳤다 · 승인 또는 반려" : "테스트 뒤에 한다")
      : place.id === "result" ? "Review에서 승인되면 여기로"
      : stage?.status ?? "기록 없음";
    return {
      id: place.id,
      type: "cycle",
      position: { x: place.x, y: place.y },
      data: {
        targets: place.targets,
        sources: place.sources,
        label: (
          <span className="cycle-block">
            <span className="cycle-name"><i className={`cycle-dot is-${state}`} aria-hidden="true" />{CYCLE_LABEL[place.id]}</span>
            <span className="cycle-status">{status}</span>
            <span className="cycle-meter" aria-label={`세부 단계 ${doneCount}/${list.length}`}>
              <span>{list.map((s, i) => <i key={i} className={`is-${s.state}`} />)}</span>
              <b>{doneCount}/{list.length}</b>
            </span>
          </span>
        ),
      },
      className: `cycle-node is-${state}${place.id === selected ? " is-selected" : ""}`,
    };
  });
  const arrow = { type: MarkerType.ArrowClosed, width: 14, height: 14 };
  const edge = (id: string, source: CycleStep, target: CycleStep, label: string, back: boolean, sourceHandle = "out") => ({
    id, source, target, sourceHandle, targetHandle: "in", label, markerEnd: arrow,
    // 지금 단계로 들어가는 길만 흐르게 — 어디로 가는 중인지 눈에 띈다.
    animated: target === current,
    className: `cycle-edge${back ? " is-back" : ""}${target === current ? " is-live" : ""}`,
    ...(back ? { type: "smoothstep" } : {}),
  });
  const edges = [
    edge("e1", "design", "build", "구체화", false),
    edge("e2", "build", "test", "실행", false),
    edge("e3", "test", "review", "결과 확인", false),
    edge("e4", "review", "design", "반려", true, "reject"),
    edge("e5", "review", "result", "승인", false, "approve"),
  ];
  return (
    <div className="cycle-canvas" aria-label="프로젝트 Workflow">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.03, maxZoom: 1.15 }}
          minZoom={CANVAS_MIN_ZOOM}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          panOnDrag={false}
          panOnScroll={false}
          preventScrolling={false}
          onNodeClick={(_, node) => onSelect(node.id as CycleStep)}
          proOptions={{ hideAttribution: true }}
        >
          <RefitOnChange signature={`${current}:${stages.map((s) => s.tone).join(",")}`} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

/** 고른 단계의 세부 단계 — 점과 선으로 이은 진행선. */
export function CycleSteps({ step, steps, action, onAction }: { step: CycleStep; steps: SubStep[]; action: string; onAction: () => void }) {
  const doneCount = steps.filter((s) => s.state === "done").length;
  return (
    <div className="cycle-steps" key={step}>
      <div className="cycle-steps-head">
        <span><b>{CYCLE_LABEL[step]}</b> 세부 단계 {doneCount}/{steps.length}</span>
        <button type="button" className="flow-btn" onClick={onAction}>{action}</button>
      </div>
      {steps.length ? (
        <ol className="cycle-track">
          {steps.map((s, i) => (
            <li key={`${i}:${s.label}`} className={`is-${s.state}`} title={s.title ?? s.label} style={{ animationDelay: `${i * 40}ms` }}>
              <i aria-hidden="true">{s.state === "done" ? "✓" : ""}</i>
              <span>{s.label}</span>
              {s.state === "now" ? <small>지금</small> : null}
            </li>
          ))}
        </ol>
      ) : <p className="main-empty">세부 단계 기록이 없다</p>}
      <p className="cycle-legend"><span className="is-done">지남</span><span className="is-now">지금</span><span className="is-next">남음</span></p>
    </div>
  );
}

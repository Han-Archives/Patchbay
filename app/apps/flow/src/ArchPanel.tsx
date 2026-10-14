import { Background, Controls, MarkerType, Position, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ArchBlock, Architecture } from "@patchbay/core";
import { CANVAS_MIN_ZOOM, RefitOnChange } from "./RefitOnChange.js";

/**
 * PRD 옆의 아키텍처 그림 (사용자 요청 2026-10-07).
 *
 * PRD와 같은 초안에서 Core가 만든 블록(`buildArchitecture`)을 다섯 줄로 놓는다 —
 * 사람 · 화면 → 들어오는 것 → 단계 → 모델 · 도구 → 나가는 것. 블록마다 PRD 절 번호(§n)를 달고,
 * 누르면 그 절로 간다. 그림을 고치는 길은 따로 없다 — PRD 절에서 「고쳐 주세요」로 상담에 보낸다.
 */

/** Core `ARCH_LANES` 와 같은 순서 — 화면 묶음에 Core 런타임을 끌어오지 않으려고 여기 둔다. */
const ARCH_LANES: readonly ArchBlock["lane"][] = ["사람 · 화면", "들어오는 것", "단계", "모델 · 도구", "나가는 것"];

const LANE_X = 205;
const ROW_Y = 78;

const KIND_LABEL: Record<ArchBlock["kind"], string> = {
  person: "사람",
  screen: "화면",
  input: "읽음",
  doc: "문서",
  step: "단계",
  model: "모델",
  tool: "도구",
  output: "내보냄",
  store: "저장소",
  secret: "열쇠",
};

export function ArchPanel({ architecture, onOpenSection }: { architecture: Architecture; onOpenSection: (n: number) => void }) {
  const { blocks, links } = architecture;
  if (blocks.length === 0) {
    return (
      <div className="arch-empty">
        <b>아직 그릴 것이 없다</b>
        <p>상담에서 단계 · 화면 · 읽는 것이 채워지면 여기에 구조가 그려진다.</p>
      </div>
    );
  }
  const rowOf = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const block of blocks) {
    const n = counts.get(block.lane) ?? 0;
    rowOf.set(block.id, n);
    counts.set(block.lane, n + 1);
  }
  const tallest = Math.max(...counts.values());
  const nodes = [
    ...ARCH_LANES.map((lane, i) => ({
      id: `lane:${lane}`,
      position: { x: i * LANE_X, y: -64 },
      data: { label: lane },
      className: "arch-lane",
      selectable: false,
      draggable: false,
    })),
    ...blocks.map((block) => {
      const lane = ARCH_LANES.indexOf(block.lane);
      const rows = counts.get(block.lane) ?? 1;
      // 줄마다 세로 가운데로 — 짧은 줄이 위에 몰리지 않게.
      const offset = ((tallest - rows) * ROW_Y) / 2;
      return {
        id: block.id,
        position: { x: lane * LANE_X, y: offset + (rowOf.get(block.id) ?? 0) * ROW_Y },
        data: {
          label: (
            <span className="arch-block" title={block.detail ?? ""}>
              <span className="arch-tag">
                {KIND_LABEL[block.kind]} <em>§{block.section}</em>
              </span>
              <span className="arch-name">{block.label}</span>
            </span>
          ),
          section: block.section,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        className: `arch-node is-${block.kind}`,
      };
    }),
  ];
  const edges = links.map((link, i) => ({
    id: `l${i}`,
    source: link.from,
    target: link.to,
    ...(link.label ? { label: link.label } : {}),
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    className: link.dashed ? "arch-edge is-dashed" : "arch-edge",
  }));
  return (
    <div className="arch-canvas">
      <div className="arch-stage">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.06, maxZoom: 1.1 }}
          minZoom={CANVAS_MIN_ZOOM}
          nodesDraggable={false}
          nodesConnectable={false}
          onNodeClick={(_, node) => {
            const section = (node.data as { section?: number }).section;
            if (section) onOpenSection(section);
          }}
          proOptions={{ hideAttribution: true }}
        >
          <RefitOnChange signature={`${blocks.length}:${links.length}`} />
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
      </div>
      <p className="arch-legend">
        블록의 <em>§n</em>은 PRD 절 번호 — 누르면 그 절로 간다. 점선은 설계에 짝이 적혀 있지 않아 해석으로 이은 것.
      </p>
    </div>
  );
}

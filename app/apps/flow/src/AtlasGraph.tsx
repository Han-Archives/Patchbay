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
import { useMemo, useState } from "react";
import { CANVAS_MIN_ZOOM, RefitOnChange } from "./RefitOnChange.js";
import {
  bucketKeyFromNodeId,
  buildAtlasLayout,
  defaultCollapsedBuckets,
  shortLabel,
  type AtlasSectionsView,
  type BucketKey,
  type FolderData,
  type JackData,
  type PortInfoMap,
} from "./atlasGraphLayout.js";
import "@xyflow/react/dist/style.css";

/**
 * Atlas as a patch panel, not a table -- see `visual-first` rule. A port is
 * a jack (ring color = its Atlas status); a matched Patch/Wire pair is a
 * cable. A bucket past `DEFAULT_COLLAPSE_THRESHOLD` starts collapsed to one
 * clickable header node instead of dumping every port at once (design doc:
 * "정리 세 갈래", option A). Layout is built in `atlasGraphLayout.ts` --
 * this file only renders it and owns which buckets are open.
 */

function JackNode({ data }: NodeProps<Node<JackData>>) {
  const state = `${data.focused ? " is-focused" : ""}${data.dimmed ? " is-dimmed" : ""}`;
  const title = data.summary ? `${data.full}\n${data.summary}` : data.full;
  return (
    <div className={`jack-node jack-node-${data.status}${state}`} title={title}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="jack-dot" aria-hidden="true" />
      <span className="jack-body">
        <span className="jack-label">{data.label}</span>
        <span className="jack-summary">{data.summary || "설명 줄이 없습니다"}</span>
      </span>
      {data.focused && data.openPath ? <span className="jack-open">열기</span> : null}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

/** The container a folder's jacks sit inside. Its header is the click target. */
function FolderNode({ data }: NodeProps<Node<FolderData>>) {
  return (
    <div
      className={`folder-node${data.collapsed ? " is-collapsed" : ""}${data.dimmed ? " is-dimmed" : ""}`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className={`jack-header${data.collapsible ? " is-collapsible" : ""}`}>
        {data.collapsible ? (
          <span className={`chevron${data.collapsed ? "" : " is-open"}`} aria-hidden="true">
            ▸
          </span>
        ) : null}
        <span className="jack-header-label">{data.label}</span>
        <span className="count-pill">{data.count}</span>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

const NODE_TYPES = { jack: JackNode, folder: FolderNode };

export function AtlasGraph({
  sections,
  info = {},
  onOpenFile,
}: {
  sections: AtlasSectionsView;
  info?: PortInfoMap;
  onOpenFile?: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<BucketKey>>(() => defaultCollapsedBuckets(sections));
  const [focus, setFocus] = useState<string | null>(null);
  const { nodes, edges, portCount } = useMemo(
    () => buildAtlasLayout(sections, collapsed, focus, info),
    [sections, collapsed, focus, info],
  );

  if (portCount === 0) {
    return <p>포트가 없습니다.</p>;
  }

  /**
   * A folder toggles open. A jack becomes the focus; clicking the focused one
   * again opens its file -- the same select-then-open rhythm the 진도 segment
   * uses, so there is no extra button sitting on every node.
   */
  function pick(nodeId: string) {
    const key = bucketKeyFromNodeId(nodeId);
    if (key) {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      return;
    }
    if (focus === nodeId) {
      const openPath = info[nodeId]?.path;
      if (openPath) onOpenFile?.(openPath);
      else setFocus(null);
      return;
    }
    setFocus(nodeId);
  }

  return (
    <div className="atlas-canvas">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          minZoom={CANVAS_MIN_ZOOM}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_event, node) => pick(node.id)}
          onPaneClick={() => setFocus(null)}
          proOptions={{ hideAttribution: true }}
        >
          <RefitOnChange signature={`${nodes.length}:${[...collapsed].sort().join(",")}`} />
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
      <div className="atlas-legend">
        <span className="atlas-legend-item">
          <span className="jack-dot jack-node-patched" /> 분류된 항목 — 무엇인지 뜻이 붙었다
        </span>
        <span className="atlas-legend-item">
          <span className="jack-dot jack-node-unlabeled" /> 분류 안 된 항목 — 스캔은 찾았지만 뜻이 아직 없다
        </span>
        <span className="atlas-legend-item">
          <span className="atlas-cable-sample atlas-edge-wired" /> 연결 — 선언된 연결과 실제 연결이 둘 다 있다
        </span>
        <span className="atlas-legend-item">
          <span className="atlas-cable-sample atlas-edge-patch-only" /> 선언만 — 사람이 선언했지만 실제로는 아직 없다
        </span>
        {focus ? (
          <span className="atlas-legend-item atlas-focus">
            <b>{shortLabel(focus)}</b>에 닿는 연결만 보는 중 · 한 번 더 누르면 파일을 열고, 배경을 클릭하면 전체로
          </span>
        ) : (
          <span className="atlas-legend-item">
            폴더 상자를 클릭하면 접고 펼칩니다. 파일을 클릭하면 그 파일의 연결만 남깁니다.
          </span>
        )}
      </div>
    </div>
  );
}

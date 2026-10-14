import { useReactFlow } from "@xyflow/react";
import { useEffect } from "react";

/** Pass this to every `<ReactFlow minZoom>` that renders a `RefitOnChange`. */
export const CANVAS_MIN_ZOOM = 0.12;

/** Long enough for xyflow to measure freshly added nodes before fitting to them. */
const MEASURE_DELAY_MS = 80;

/**
 * `fitView` on `<ReactFlow>` only runs at mount, so any canvas whose nodes
 * arrive later (an async load) or change (expanding a bucket) keeps the old
 * viewport and leaves the new nodes off-screen. Render this inside the
 * provider and give it a signature that changes whenever the node set does.
 *
 * Fitting in the same frame the nodes appear only frames the ones xyflow has
 * already measured, so this waits a beat first. `useNodesInitialized` looked
 * like the right gate but does not flip for nodes added to a canvas that was
 * already initialized, which is exactly the expand-a-bucket case.
 */
export function RefitOnChange({ signature }: { signature: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    // `minZoom` must match the canvas's own, or a wide graph (the plan lane is
    // one long row) stops at xyflow's default 0.5 floor and clips its ends.
    // `maxZoom: 1` — 노드 세 개짜리 그래프가 두 배로 부풀어 글자가 화면을 덮었다 (디자인 개편 걷기 06).
    const timer = window.setTimeout(
      () => void fitView({ padding: 0.12, minZoom: CANVAS_MIN_ZOOM, maxZoom: 1 }),
      MEASURE_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [signature, fitView]);
  return null;
}

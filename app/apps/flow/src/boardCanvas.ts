import { isArchitectureItemId, type BoardItemView, type BoardKind, type BoardLinkView } from "./boardContract.js";

export interface BoardCanvasNode {
  id: string;
  type: "board";
  position: { x: number; y: number };
  data: { label: string; kind: BoardKind; ref: string };
  className?: string;
}

export interface BoardCanvasEdge {
  id: string;
  source: string;
  target: string;
}

/**
 * Positions come from board.yaml, not layout(). Links are placement-only.
 */
export function toBoardCanvas(
  items: readonly BoardItemView[],
  links: readonly BoardLinkView[],
): { nodes: BoardCanvasNode[]; edges: BoardCanvasEdge[] } {
  const ids = new Set(items.map((item) => item.id));
  const nodes: BoardCanvasNode[] = items.map((item) => ({
    id: item.id,
    type: "board",
    position: { x: item.x, y: item.y },
    data: { label: item.title, kind: item.kind, ref: item.ref },
    className: isArchitectureItemId(item.id)
      ? `board-node-${item.kind} board-node-arch`
      : `board-node-${item.kind}`,
  }));
  const edges: BoardCanvasEdge[] = links
    .filter((link) => ids.has(link.from) && ids.has(link.to))
    .map((link) => ({
      id: `${link.from}->${link.to}`,
      source: link.from,
      target: link.to,
    }));
  return { nodes, edges };
}

/** Client-safe board types and freeze values (spec 2.1 / 3.1d / P7). */

export const BOARD_KINDS = ["langgraph", "neo4j", "port"] as const;
export type BoardKind = (typeof BOARD_KINDS)[number];

/** Architecture map placed on the board. kind stays `port`; id is prefixed. */
export const ARCH_PREFIX = "arch:";
/** 프로젝트 문서 폴더(등록부 `docs`, 기본 `docs`) 안의 아키텍처 맵. 화면은 경로를 조립하지 않고 GET /api/board/architecture 로 받는다. */
export function architectureRel(docs = "docs"): string {
  return `${docs}/기획/아키텍처.json`;
}

export function isArchitectureItemId(id: string): boolean {
  return id.startsWith(ARCH_PREFIX) && id.length > ARCH_PREFIX.length;
}

export function architectureItemId(nodeId: string): string {
  return `${ARCH_PREFIX}${nodeId}`;
}

export function architectureNodeId(itemId: string): string | null {
  if (!isArchitectureItemId(itemId)) return null;
  return itemId.slice(ARCH_PREFIX.length);
}

export const BOARD_SLOT_X = 220;
export const BOARD_SLOT_Y = 100;
export const BOARD_SLOT_COLS = 4;

export interface BoardItemView {
  id: string;
  kind: BoardKind;
  ref: string;
  title: string;
  x: number;
  y: number;
}

export interface BoardLinkView {
  from: string;
  to: string;
}

export interface BoardView {
  alias: string;
  items: BoardItemView[];
  links: BoardLinkView[];
}

export function isBoardKind(value: unknown): value is BoardKind {
  return value === "langgraph" || value === "neo4j" || value === "port";
}

/** Console POST without x/y uses this lattice. Core/MCP omitted coords stay 0. */
export function nextBoardSlot(count: number): { x: number; y: number } {
  const n = Math.max(0, count);
  return {
    x: (n % BOARD_SLOT_COLS) * BOARD_SLOT_X,
    y: Math.floor(n / BOARD_SLOT_COLS) * BOARD_SLOT_Y,
  };
}

export function langgraphBoardRef(assistantId: string, nodeId: string): string {
  return `${assistantId}:${nodeId}`;
}

export function langgraphBoardId(assistantId: string, nodeId: string): string {
  return `langgraph:${langgraphBoardRef(assistantId, nodeId)}`;
}

export function neo4jBoardId(label: string, path: string): string {
  return `neo4j:${label.toLowerCase()}:${path}`;
}

export function portBoardId(portId: string): string {
  return `port:${portId}`;
}

export function roundBoardCoord(value: number): number {
  return Math.round(value);
}

import fs from "node:fs/promises";
import path from "node:path";
import { linkOnBoard, placeOnBoard, projectDocs, readStudio } from "@patchbay/core";
import {
  architectureRel,
  architectureItemId,
} from "./boardContract.js";
import { loadBoardView, type BoardMutationResult } from "./boardView.js";

export { architectureRel, ARCH_PREFIX, architectureItemId, architectureNodeId, isArchitectureItemId } from "./boardContract.js";

export const ARCH_COL_W = 260;
export const ARCH_ROW_H = 92;
export const ARCH_ORIGIN_X = 24;
export const ARCH_ORIGIN_Y = 24;

export interface ArchitectureNode {
  id: string;
  label: string;
  layer: string;
  ref: string;
  detail: Array<[string, string]>;
}

export interface ArchitectureEdge {
  from: string;
  to: string;
}

export interface ArchitectureMap {
  title: string;
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
}

function isInsideRoot(root: string, candidate: string): boolean {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  return target === base || target.startsWith(base + path.sep);
}

export function parseArchitectureMap(raw: unknown): ArchitectureMap | { error: string } {
  if (!raw || typeof raw !== "object") {
    return { error: "architecture: JSON object required." };
  }
  const rec = raw as Record<string, unknown>;
  const title = typeof rec.title === "string" && rec.title.trim() ? rec.title.trim() : "아키텍처 구조";
  if (!Array.isArray(rec.nodes) || rec.nodes.length === 0) {
    return { error: "architecture: nodes[] is required." };
  }
  const nodes: ArchitectureNode[] = [];
  const seen = new Set<string>();
  for (const entry of rec.nodes) {
    if (!entry || typeof entry !== "object") {
      return { error: "architecture: each node must be an object." };
    }
    const node = entry as Record<string, unknown>;
    const id = typeof node.id === "string" ? node.id.trim() : "";
    const label = typeof node.label === "string" ? node.label.trim() : "";
    const layer = typeof node.layer === "string" ? node.layer.trim() : "구조";
    const ref = typeof node.ref === "string" ? node.ref.trim().replace(/\\/g, "/") : "";
    if (!id || !label || !ref) {
      return { error: "architecture: node id, label, and ref are required." };
    }
    if (id.includes(":") || id.includes("/") || seen.has(id)) {
      return { error: `architecture: node id "${id}" is not unique or not a simple slug.` };
    }
    if (ref.startsWith("/") || ref.includes("..")) {
      return { error: `architecture: ref must be a relative project path (${id}).` };
    }
    seen.add(id);
    const detail: Array<[string, string]> = [];
    if (Array.isArray(node.detail)) {
      for (const row of node.detail) {
        if (!Array.isArray(row) || row.length < 2) continue;
        const key = typeof row[0] === "string" ? row[0] : "";
        const value = typeof row[1] === "string" ? row[1] : "";
        if (key && value) detail.push([key, value]);
      }
    }
    nodes.push({ id, label, layer, ref, detail });
  }

  const ids = new Set(nodes.map((node) => node.id));
  const edges: ArchitectureEdge[] = [];
  const edgeKeys = new Set<string>();
  if (rec.edges !== undefined && !Array.isArray(rec.edges)) {
    return { error: "architecture: edges must be an array." };
  }
  for (const entry of Array.isArray(rec.edges) ? rec.edges : []) {
    if (!entry || typeof entry !== "object") continue;
    const edge = entry as Record<string, unknown>;
    const from = typeof edge.from === "string" ? edge.from.trim() : "";
    const to = typeof edge.to === "string" ? edge.to.trim() : "";
    if (!ids.has(from) || !ids.has(to) || from === to) continue;
    const key = `${from}->${to}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({ from, to });
  }

  return { title, nodes, edges };
}

export function layoutArchitecture(
  nodes: readonly ArchitectureNode[],
  edges: readonly ArchitectureEdge[],
): Map<string, { x: number; y: number }> {
  const ids = new Set(nodes.map((node) => node.id));
  const incoming = new Map<string, string[]>();
  for (const node of nodes) incoming.set(node.id, []);
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    incoming.get(edge.to)!.push(edge.from);
  }

  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  function rec(id: string): number {
    const cached = rank.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const preds = incoming.get(id) ?? [];
    const value = preds.length === 0 ? 0 : Math.max(...preds.map(rec)) + 1;
    visiting.delete(id);
    rank.set(id, value);
    return value;
  }
  for (const node of nodes) rec(node.id);

  const byRank = new Map<number, string[]>();
  for (const node of nodes) {
    const layer = rank.get(node.id) ?? 0;
    const list = byRank.get(layer) ?? [];
    list.push(node.id);
    byRank.set(layer, list);
  }

  const pos = new Map<string, { x: number; y: number }>();
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  for (const layer of ranks) {
    const list = byRank.get(layer) ?? [];
    list.forEach((id, index) => {
      pos.set(id, {
        x: ARCH_ORIGIN_X + layer * ARCH_COL_W,
        y: ARCH_ORIGIN_Y + index * ARCH_ROW_H,
      });
    });
  }
  return pos;
}

export async function loadArchitectureMap(
  studioHome: string,
  alias: string | undefined,
): Promise<{ ok: true; alias: string; map: ArchitectureMap; raw: unknown } | { ok: false; status: 400 | 404; error: string }> {
  if (!alias?.trim()) {
    return { ok: false, status: 400, error: "architecture: alias is required." };
  }
  const loaded = await loadBoardView(studioHome, alias.trim());
  if (!loaded.ok) return loaded;

  const studio = await readStudio(studioHome);
  const registered = studio.projects.find((project) => project.alias === loaded.body.alias);
  if (!registered) {
    return { ok: false, status: 404, error: `No project registered with alias "${alias.trim()}".` };
  }

  const root = path.resolve(registered.path);
  const rel = architectureRel(projectDocs(registered));
  const abs = path.resolve(root, rel);
  if (!isInsideRoot(root, abs)) {
    return { ok: false, status: 400, error: "architecture: path is outside the project." };
  }

  let raw: string;
  try {
    raw = await fs.readFile(abs, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ok: false,
        status: 404,
        error: `architecture: ${rel} 이 없습니다. 이 파일을 두면 배치도에 「아키텍처 구조」를 올릴 수 있습니다.`,
      };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, status: 400, error: "architecture: file is not valid JSON." };
  }
  const map = parseArchitectureMap(parsed);
  if ("error" in map) return { ok: false, status: 400, error: map.error };
  return { ok: true, alias: loaded.body.alias, map, raw: parsed };
}

export async function placeArchitectureMap(
  studioHome: string,
  input: { alias?: unknown },
): Promise<BoardMutationResult> {
  const alias = typeof input.alias === "string" ? input.alias : undefined;
  const loaded = await loadArchitectureMap(studioHome, alias);
  if (!loaded.ok) return loaded;

  const layout = layoutArchitecture(loaded.map.nodes, loaded.map.edges);
  let placed = 0;
  let linked = 0;

  for (const node of loaded.map.nodes) {
    const slot = layout.get(node.id) ?? { x: ARCH_ORIGIN_X, y: ARCH_ORIGIN_Y };
    const result = await placeOnBoard(studioHome, loaded.alias, {
      id: architectureItemId(node.id),
      kind: "port",
      ref: `source:${node.ref}`,
      title: node.label,
      x: slot.x,
      y: slot.y,
    });
    if (result.placed) placed += 1;
  }

  for (const edge of loaded.map.edges) {
    const result = await linkOnBoard(
      studioHome,
      loaded.alias,
      architectureItemId(edge.from),
      architectureItemId(edge.to),
    );
    if (result.linked) linked += 1;
  }

  const board = await loadBoardView(studioHome, loaded.alias);
  if (!board.ok) return board;
  return {
    ok: true,
    status: 200,
    body: {
      ...board.body,
      title: loaded.map.title,
      placed,
      linked,
      nodes: loaded.map.nodes.length,
      edges: loaded.map.edges.length,
    },
  };
}

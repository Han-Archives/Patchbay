import type { Inferred } from "../types/inferred.js";
import type { Overlay } from "../types/overlay.js";
import type { PortId } from "../types/portId.js";
import type { Patch, Wire } from "../types/project.js";

/**
 * Impact radius and port debt over the declared/discovered port graph.
 *
 * Lives in Core, not in the flow app's Neo4j adapter, because CLI, MCP and
 * React must see the same aggregation (기획 원칙 5) -- `@patchbay/mcp`
 * depends on Core only and can never reach `apps/flow`. That also means the
 * answer is the same whether or not the Neo4j sidecar is running: Neo4j is a
 * replica the rescan can rebuild (기획 원칙 4), not the source of this.
 *
 * Edges are overlay patches + wires, walked UNDIRECTED: "what does changing
 * this shake" runs both ways -- a prompt file's dependents are upstream of
 * it, its own reads are downstream, and both break.
 */

export interface ImpactHit {
  port: PortId;
  /** 1-based edge distance from the origin. */
  hop: number;
  /** Neighbour this port was first reached from. */
  via: PortId;
  /** Relation kind on the edge that reached it (`uses`, `reads`, `produces`, ...). */
  kind: string;
}

export interface ImpactRadius {
  origin: PortId;
  maxHops: number;
  /** `hops[0]` is distance 1. Always `maxHops` long; a ring with nothing in it is empty. */
  hops: ImpactHit[][];
  total: number;
}

export interface PortDebt {
  /** Discovered ports with no patch and no wire touching them. */
  orphans: PortId[];
  /** Ports at or above `hubThreshold` edges, busiest first. */
  hubs: Array<{ port: PortId; degree: number }>;
}

export const IMPACT_MAX_HOPS = 3;
export const HUB_DEGREE_THRESHOLD = 4;

interface Edge {
  to: PortId;
  kind: string;
}

function adjacency(overlay: Overlay): Map<PortId, Edge[]> {
  const graph = new Map<PortId, Edge[]>();
  const link = (from: PortId, to: PortId, kind: string) => {
    const list = graph.get(from);
    if (list) list.push({ to, kind });
    else graph.set(from, [{ to, kind }]);
  };
  const entries: Array<Patch | Wire> = [...overlay.patches, ...overlay.wires];
  for (const entry of entries) {
    if (entry.from === entry.to) continue;
    link(entry.from, entry.to, entry.kind);
    link(entry.to, entry.from, entry.kind);
  }
  return graph;
}

/**
 * Breadth-first ring walk from `origin`. A port is reported at the shortest
 * distance that reaches it and never again, so the rings partition the
 * neighbourhood instead of repeating it.
 */
export function computeImpactRadius(
  overlay: Overlay,
  origin: string,
  maxHops: number = IMPACT_MAX_HOPS,
): ImpactRadius {
  const rings = Math.max(1, Math.trunc(maxHops));
  const start = origin as PortId;
  const empty: ImpactRadius = {
    origin: start,
    maxHops: rings,
    hops: Array.from({ length: rings }, () => []),
    total: 0,
  };
  if (!origin) return empty;

  const graph = adjacency(overlay);
  if (!graph.has(start)) return empty;

  const hops: ImpactHit[][] = Array.from({ length: rings }, () => []);
  const seen = new Set<PortId>([start]);
  let frontier: PortId[] = [start];
  let total = 0;

  for (let hop = 1; hop <= rings; hop += 1) {
    const next: PortId[] = [];
    const ring: ImpactHit[] = [];
    for (const port of frontier) {
      for (const edge of graph.get(port) ?? []) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        ring.push({ port: edge.to, hop, via: port, kind: edge.kind });
        next.push(edge.to);
      }
    }
    ring.sort((a, b) => a.port.localeCompare(b.port));
    hops[hop - 1] = ring;
    total += ring.length;
    if (next.length === 0) break;
    frontier = next;
  }

  return { origin: start, maxHops: rings, hops, total };
}

/**
 * Orphans and hubs over the same graph. An orphan is a discovered port no
 * patch or wire mentions -- `architecture-map`'s "이름 없는 잭은 부채다",
 * found by query instead of by eye.
 */
export function computePortDebt(
  inferred: Inferred,
  overlay: Overlay,
  hubThreshold: number = HUB_DEGREE_THRESHOLD,
): PortDebt {
  const graph = adjacency(overlay);

  const orphans = inferred.discoveredPorts.filter((port) => (graph.get(port)?.length ?? 0) === 0).slice().sort();

  const hubs = [...graph.entries()]
    .map(([port, edges]) => ({ port, degree: new Set(edges.map((edge) => edge.to)).size }))
    .filter((entry) => entry.degree >= hubThreshold)
    .sort((a, b) => b.degree - a.degree || a.port.localeCompare(b.port));

  return { orphans, hubs };
}

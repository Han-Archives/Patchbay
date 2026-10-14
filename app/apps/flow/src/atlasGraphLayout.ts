import type { Edge, Node } from "@xyflow/react";
import type { GapView } from "./projectContract.js";

/**
 * Pure layout for `AtlasGraph.tsx` -- Atlas sections in, XYFlow nodes/edges
 * out. Kept separate from the component (same split as `flowCanvas.ts`/
 * `compareFlow.ts` for `FlowPane.tsx`) so the grouping and cable logic is
 * testable without rendering React.
 *
 * Ports are grouped by their **top-level folder**, not by Atlas status. The
 * status axis (patched / unlabeled / source / other) put every wire endpoint
 * the scanner had not also discovered into one "기타" bucket, which on a real
 * project swallowed docs·prompts·drills·lectures whole -- the structure the
 * picture exists to show. Status is still on every jack as its ring color;
 * it is a property of a port, not the way a person reads a repo.
 *
 * Each folder is a container (an XYFlow parent node) with its files inside,
 * so the default view is a map of the repo rather than a node cloud. Past
 * `DEFAULT_COLLAPSE_THRESHOLD` a container starts collapsed to its header --
 * still informative now, because the header names a real folder and a count.
 *
 * Containers are ordered by net degree: the ones that mostly emit cables sit
 * left, the ones that mostly receive sit right. On a project whose skills all
 * read from resource folders that falls out as a clean left-to-right read.
 */

export type JackStatus = "patched" | "unlabeled" | "source" | "other";

/** Top-level folder of a port's path. Not an enum -- it comes from the repo. */
export type BucketKey = string;

export interface JackData extends Record<string, unknown> {
  label: string;
  full: string;
  status: JackStatus;
  /** One line saying what this port is. Empty when the file says nothing. */
  summary: string;
  /** Project-relative path to open, or null when the port is not a file here. */
  openPath: string | null;
  /** The focused port itself. */
  focused: boolean;
  /** Outside the focus neighbourhood -- rendered faint, still clickable. */
  dimmed: boolean;
}

/** `port -> { path, summary }`, from `GET /api/project/ports`. */
export type PortInfoMap = Record<string, { path: string | null; summary: string }>;

export interface FolderData extends Record<string, unknown> {
  label: string;
  count: number;
  collapsed: boolean;
  collapsible: boolean;
  dimmed: boolean;
}

export interface AtlasSectionsView {
  skills: string[];
  rules: string[];
  unlabeledPorts: string[];
  matched: GapView[];
  patchesWithoutWire: GapView[];
  wiresWithoutPatch: GapView[];
}

// Wide enough for a name plus its one-line description underneath.
const CONTAINER_WIDTH = 320;
const CONTAINER_PAD_X = 12;
const CONTAINER_HEADER_H = 34;
const CONTAINER_PAD_BOTTOM = 12;
const ROW_HEIGHT = 52;
const JACK_WIDTH = CONTAINER_WIDTH - CONTAINER_PAD_X * 2;
const COLUMN_GAP = 96;
const ROW_GAP = 22;
/** Start a new column once stacking another container would pass this. */
const MAX_COLUMN_HEIGHT = 560;

/**
 * Folders start collapsed, so the first frame is a map of the repo: one box
 * per folder with its file count, and folder-to-folder cables merged into one
 * labelled line each. Mixing open and collapsed containers is what looks
 * careless -- every cable out of a closed box leaves the same point and fans
 * across the canvas. Opening one folder is the drill-down.
 */
export const DEFAULT_COLLAPSE_THRESHOLD = 0;

const ROOT_BUCKET = "(루트)";
const BAY_BUCKET = "스킬 베이";

// Most skill ports end in a literal "SKILL.md" filename -- the useful part
// of the label is the skill's own directory name just before that, not the
// filename every one of them shares.
export function shortLabel(port: string): string {
  const withoutKind = port.slice(port.indexOf(":") + 1);
  const segments = withoutKind.split("/").filter(Boolean);
  const last = segments.at(-1) ?? withoutKind;
  if (last === "SKILL.md" && segments.length >= 2) return segments.at(-2)!;
  return last;
}

/**
 * Which container a port belongs in. A `skill:` ref with no slash is a studio
 * Bay slug (PortId grammar, spec 7.1), not a path in this repo, so it gets its
 * own container instead of landing in the root one.
 */
export function bucketOf(port: string): BucketKey {
  const sep = port.indexOf(":");
  const kind = sep > 0 ? port.slice(0, sep) : "";
  const ref = port.slice(sep + 1);
  if (!ref) return ROOT_BUCKET;
  if (!ref.includes("/")) return kind === "skill" ? BAY_BUCKET : ROOT_BUCKET;
  return ref.slice(0, ref.indexOf("/"));
}

function statusOf(port: string, sections: AtlasSectionsView): JackStatus {
  if (sections.skills.includes(port)) return "patched";
  if (sections.unlabeledPorts.includes(port)) return "unlabeled";
  if (sections.rules.includes(port)) return "source";
  return "other";
}

interface Bucket {
  key: BucketKey;
  ports: string[];
  /** Cables out minus cables in. Positive = a producer, so it belongs on the left. */
  net: number;
}

function allPairs(sections: AtlasSectionsView): GapView[] {
  return [...sections.matched, ...sections.patchesWithoutWire, ...sections.wiresWithoutPatch];
}

function allPorts(sections: AtlasSectionsView): string[] {
  const seen = new Set<string>([...sections.skills, ...sections.rules, ...sections.unlabeledPorts]);
  for (const pair of allPairs(sections)) {
    seen.add(pair.from);
    seen.add(pair.to);
  }
  return [...seen];
}

/** Producers first: a folder that mostly emits cables reads better on the left. */
function buildBuckets(sections: AtlasSectionsView): Bucket[] {
  const byKey = new Map<BucketKey, string[]>();
  for (const port of allPorts(sections)) {
    const key = bucketOf(port);
    const list = byKey.get(key);
    if (list) list.push(port);
    else byKey.set(key, [port]);
  }

  const net = new Map<BucketKey, number>();
  for (const pair of allPairs(sections)) {
    const from = bucketOf(pair.from);
    const to = bucketOf(pair.to);
    if (from === to) continue;
    net.set(from, (net.get(from) ?? 0) + 1);
    net.set(to, (net.get(to) ?? 0) - 1);
  }

  return [...byKey.entries()]
    .map(([key, ports]) => ({ key, ports: ports.slice().sort(), net: net.get(key) ?? 0 }))
    .sort((a, b) => {
      if (b.net !== a.net) return b.net - a.net;
      if (b.ports.length !== a.ports.length) return b.ports.length - a.ports.length;
      return a.key.localeCompare(b.key);
    });
}

/** Folders past the threshold start collapsed; small ones start open. */
export function defaultCollapsedBuckets(
  sections: AtlasSectionsView,
  threshold = DEFAULT_COLLAPSE_THRESHOLD,
): Set<BucketKey> {
  const collapsed = new Set<BucketKey>();
  for (const bucket of buildBuckets(sections)) {
    if (bucket.ports.length > threshold) collapsed.add(bucket.key);
  }
  return collapsed;
}

const FOLDER_PREFIX = "folder:";

export function folderNodeId(key: BucketKey): string {
  return `${FOLDER_PREFIX}${key}`;
}

/** The folder a container click toggles, or null for a plain jack node. */
export function bucketKeyFromNodeId(nodeId: string): BucketKey | null {
  return nodeId.startsWith(FOLDER_PREFIX) ? nodeId.slice(FOLDER_PREFIX.length) : null;
}

function containerHeight(portCount: number, collapsed: boolean): number {
  if (collapsed) return CONTAINER_HEADER_H + CONTAINER_PAD_BOTTOM;
  return CONTAINER_HEADER_H + portCount * ROW_HEIGHT + CONTAINER_PAD_BOTTOM;
}

/**
 * Ports one cable away from `focus`, plus `focus` itself.
 *
 * Drawing every cable at once is the hairball every graph view eventually
 * grows; picking one node and showing only its own neighbourhood is what
 * makes a local graph readable. The authoritative multi-hop radius lives in
 * Core (`computeImpactRadius`, reached from the 지식 tab and MCP) -- this is
 * the one-hop projection over the pairs the canvas already holds, so a click
 * repaints without a round trip.
 */
export function focusNeighbourhood(sections: AtlasSectionsView, focus: string): Set<string> {
  const lit = new Set<string>([focus]);
  for (const pair of allPairs(sections)) {
    if (pair.from === focus) lit.add(pair.to);
    else if (pair.to === focus) lit.add(pair.from);
  }
  return lit;
}

/** `reads` · `reads ×14` · `×26` when a pair carries more than one kind. */
export function cableLabel(kinds: ReadonlyMap<string, number>): string {
  let total = 0;
  for (const count of kinds.values()) total += count;
  if (kinds.size === 1) {
    const [kind] = [...kinds.keys()];
    return total > 1 ? `${kind} ×${total}` : kind!;
  }
  return `×${total}`;
}

interface PlacedBucket {
  bucket: Bucket;
  x: number;
  y: number;
}

/**
 * Two lanes -- producers then consumers -- each packed top to bottom and
 * spilling into an extra column when a lane grows past `MAX_COLUMN_HEIGHT`.
 */
function placeBuckets(buckets: Bucket[], collapsed: ReadonlySet<BucketKey>): PlacedBucket[] {
  const lanes = [buckets.filter((bucket) => bucket.net > 0), buckets.filter((bucket) => bucket.net <= 0)];
  const placed: PlacedBucket[] = [];
  let column = 0;

  for (const lane of lanes) {
    if (lane.length === 0) continue;
    let y = 0;
    let laneColumns = 0;
    for (const bucket of lane) {
      const height = containerHeight(bucket.ports.length, collapsed.has(bucket.key));
      if (y > 0 && y + height > MAX_COLUMN_HEIGHT) {
        laneColumns += 1;
        y = 0;
      }
      placed.push({ bucket, x: (column + laneColumns) * (CONTAINER_WIDTH + COLUMN_GAP), y });
      y += height + ROW_GAP;
    }
    column += laneColumns + 1;
  }

  return placed;
}

export interface AtlasLayout {
  nodes: Node[];
  edges: Edge[];
  portCount: number;
  bucketCount: number;
}

export function buildAtlasLayout(
  sections: AtlasSectionsView,
  collapsed: ReadonlySet<BucketKey>,
  focus: string | null = null,
  info: PortInfoMap = {},
): AtlasLayout {
  const buckets = buildBuckets(sections);
  const portCount = buckets.reduce((sum, bucket) => sum + bucket.ports.length, 0);
  const lit = focus ? focusNeighbourhood(sections, focus) : null;
  const litBuckets = lit ? new Set([...lit].map(bucketOf)) : null;

  const nodes: Node[] = [];
  // Where an edge endpoint should actually land: itself if its folder is
  // expanded, its folder container if collapsed.
  const displayId = new Map<string, string>();

  // Producers form the left lane and consumers the right one, so the cables
  // read in one direction. Packing purely by height instead would stack every
  // collapsed folder into a single column and lose that.
  const placed = placeBuckets(buckets, collapsed);

  for (const { bucket, x, y } of placed) {
    const isCollapsed = collapsed.has(bucket.key);
    const height = containerHeight(bucket.ports.length, isCollapsed);
    const columnX = x;
    const columnY = y;

    // A parent must precede its children in the node array (XYFlow contract).
    nodes.push({
      id: folderNodeId(bucket.key),
      type: "folder",
      position: { x: columnX, y: columnY },
      data: {
        label: bucket.key,
        count: bucket.ports.length,
        collapsed: isCollapsed,
        collapsible: bucket.ports.length > 0,
        dimmed: litBuckets !== null && !litBuckets.has(bucket.key),
      } satisfies FolderData,
      draggable: false,
      selectable: false,
      style: { width: CONTAINER_WIDTH, height },
      width: CONTAINER_WIDTH,
      height,
    });

    if (isCollapsed) {
      for (const port of bucket.ports) displayId.set(port, folderNodeId(bucket.key));
    } else {
      bucket.ports.forEach((port, rowIndex) => {
        displayId.set(port, port);
        nodes.push({
          id: port,
          type: "jack",
          parentId: folderNodeId(bucket.key),
          extent: "parent",
          position: { x: CONTAINER_PAD_X, y: CONTAINER_HEADER_H + rowIndex * ROW_HEIGHT },
          data: {
            label: shortLabel(port),
            full: port,
            status: statusOf(port, sections),
            summary: info[port]?.summary ?? "",
            openPath: info[port]?.path ?? null,
            focused: port === focus,
            dimmed: lit !== null && !lit.has(port),
          } satisfies JackData,
          draggable: false,
          width: JACK_WIDTH,
        });
      });
    }
  }

  function toEdges(pairs: GapView[], status: "wired" | "patch-only" | "wire-only"): Edge[] {
    // One line per endpoint pair, kinds folded into its label. Keying on kind
    // as well drew `reads`, `produces` and `uses` on top of each other between
    // the same two collapsed folders, which is what made the labels unreadable.
    const merged = new Map<string, { source: string; target: string; kinds: Map<string, number> }>();
    for (const pair of pairs) {
      // With a focus set, only its own cables are drawn -- everything else is
      // the noise this mode exists to remove.
      if (focus && pair.from !== focus && pair.to !== focus) continue;
      const source = displayId.get(pair.from);
      const target = displayId.get(pair.to);
      if (!source || !target || source === target) continue;
      const key = `${source}->${target}`;
      const existing = merged.get(key);
      if (existing) existing.kinds.set(pair.kind, (existing.kinds.get(pair.kind) ?? 0) + 1);
      else merged.set(key, { source, target, kinds: new Map([[pair.kind, 1]]) });
    }
    return [...merged.entries()].map(([key, edge]) => ({
      id: `${status}:${key}`,
      source: edge.source,
      target: edge.target,
      label: cableLabel(edge.kinds),
      className: `atlas-edge atlas-edge-${status}`,
    }));
  }

  const edges = [
    ...toEdges(sections.matched, "wired"),
    ...toEdges(sections.patchesWithoutWire, "patch-only"),
    ...toEdges(sections.wiresWithoutPatch, "wire-only"),
  ];

  return { nodes, edges, portCount, bucketCount: buckets.length };
}

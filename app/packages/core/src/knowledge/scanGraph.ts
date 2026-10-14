import type { Inferred } from "../types/inferred.js";
import type { Overlay } from "../types/overlay.js";
import { classifyPath, PUBLIC_LEVEL, WORKING_LEVEL, type SensitivityLevel } from "../sensitivity/sensitivity.js";
import { portFileRef } from "../types/portId.js";
import {
  countsFromNodes,
  type KnowledgeEdgeView,
  type KnowledgeLabel,
  type KnowledgeNodeView,
  type KnowledgeRelation,
  type KnowledgeSnapshot,
  SCAN_LABELS,
} from "./contract.js";

/**
 * Which label wins when one path arrives twice. Only the four a scan can
 * produce are listed: a design row (`Requirement`, `Document`, ...) has a
 * synthetic path of its own and never collides with a file's.
 */
const LABEL_RANK: Record<(typeof SCAN_LABELS)[number], number> = {
  Folder: 0,
  File: 1,
  Artifact: 2,
  Skill: 3,
};

function labelRank(label: KnowledgeLabel): number {
  return LABEL_RANK[label as (typeof SCAN_LABELS)[number]] ?? 0;
}

/**
 * 3.3의 스캔 쪽 -- inferred + overlay → Neo4j replica. Folders are parent prefixes of file
 * paths. Overlay patches/wires become REFERENCES. No embeddings.
 */
export function graphFromInferred(inferred: Inferred, overlay: Overlay): KnowledgeSnapshot {
  const nodes = new Map<string, KnowledgeNodeView>();

  // A path can arrive twice (a discovered port and an overlay wire endpoint).
  // The label with the higher rank wins, but the *level* never relaxes: the
  // more secret grade is kept whichever row it came in on.
  const upsert = (node: KnowledgeNodeView) => {
    const existing = nodes.get(node.path);
    if (!existing) {
      nodes.set(node.path, node);
      return;
    }
    const level = Math.max(existing.level, node.level) as SensitivityLevel;
    if (labelRank(node.label) > labelRank(existing.label)) {
      nodes.set(node.path, { ...node, level });
    } else {
      nodes.set(node.path, { ...existing, port: existing.port ?? node.port, level });
    }
  };

  const ports = [
    ...inferred.discoveredPorts,
    ...overlay.patches.flatMap((entry) => [entry.from, entry.to]),
    ...overlay.wires.flatMap((entry) => [entry.from, entry.to]),
  ];

  for (const port of ports) {
    const mapped = nodeFromPort(port);
    if (!mapped) continue;
    // The scan already graded its own ports -- use that stored verdict rather
    // than re-deriving it here. Overlay endpoints are human-authored and never
    // pass through a scan, so those fall back to nodeFromPort's live grade.
    const stored = inferred.portLevels[port];
    const node = stored ? { ...mapped, level: stored.level } : mapped;
    upsert(node);
    // A folder is only as public as its most secret child.
    for (const folder of parentFolders(node.path)) {
      upsert({ ...folder, level: node.level });
    }
  }

  const edges: KnowledgeEdgeView[] = [];
  const seen = new Set<string>();
  const addEdge = (from: string, to: string, kind: KnowledgeRelation) => {
    if (!nodes.has(from) || !nodes.has(to) || from === to) return;
    const key = `${kind}:${from}->${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, kind });
  };

  for (const node of nodes.values()) {
    if (node.label === "Folder") continue;
    const parent = parentPath(node.path);
    if (parent) addEdge(parent, node.path, "CONTAINS");
  }
  for (const node of nodes.values()) {
    if (node.label !== "Folder") continue;
    const parent = parentPath(node.path);
    if (parent) addEdge(parent, node.path, "CONTAINS");
  }

  for (const entry of [...overlay.patches, ...overlay.wires]) {
    const from = nodeFromPort(entry.from);
    const to = nodeFromPort(entry.to);
    if (!from || !to) continue;
    addEdge(from.path, to.path, "REFERENCES");
  }

  const sortedNodes = [...nodes.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { nodes: sortedNodes, edges };
}

export function snapshotCounts(snapshot: KnowledgeSnapshot) {
  return countsFromNodes(snapshot.nodes);
}

export function nodeFromPort(portId: string): KnowledgeNodeView | null {
  const sep = portId.indexOf(":");
  if (sep <= 0) return null;
  const kind = portId.slice(0, sep);
  const ref = portId.slice(sep + 1);
  if (!ref || kind === "agent") return null;

  let label: KnowledgeLabel = "File";
  if (kind === "skill") label = "Skill";
  else if (kind === "artifact") label = "Artifact";
  else if (kind === "source" || kind === "signal") label = "File";
  else return null;

  const path = looksLikeFileRef(ref) ? ref : `.${kind}/${ref}`;
  // A Bay slug has no project path to grade (portFileRef returns null), so it
  // gets the same default the scanner gives one -- L2, not a guess at L0.
  const fileRef = portFileRef(portId);
  const level: SensitivityLevel = fileRef ? classifyPath(fileRef).level : WORKING_LEVEL;
  // `text` is a design row's own sentence (contract.ts). A scanned file has
  // none -- only a name -- and writing the name in twice would make 4.3 rank
  // the same string under two fields.
  return { path, name: basename(path), label, port: portId, level, text: null };
}

/** File path inside the project repo, or null for agents/unknown kinds. */
export function projectRelPathFromPort(portId: string): string | null {
  const node = nodeFromPort(portId);
  if (!node || node.label === "Folder") return null;
  return node.path;
}

function looksLikeFileRef(ref: string): boolean {
  return ref.includes("/") || ref.includes(".");
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function parentPath(path: string): string | null {
  const slash = path.lastIndexOf("/");
  if (slash === -1) return null;
  return path.slice(0, slash);
}

function parentFolders(path: string): KnowledgeNodeView[] {
  const folders: KnowledgeNodeView[] = [];
  let current = parentPath(path);
  while (current) {
    folders.push({
      path: current,
      name: basename(current),
      label: "Folder",
      port: null,
      level: PUBLIC_LEVEL,
      text: null,
    });
    current = parentPath(current);
  }
  return folders;
}

import type { TestRunEntry } from "../runs/testRuns.js";
import { RESERVED_NODE_IDS, type Ir } from "../types/ir.js";
import type { SensitivityLevel } from "../sensitivity/sensitivity.js";
import {
  isDesignRelation,
  isRunRelation,
  type KnowledgeEdgeView,
  type KnowledgeNodeView,
  type KnowledgeSnapshot,
} from "./contract.js";

/**
 * 3.3 -- turns `overlay.ir` into the graph rows a scan cannot produce, and
 * 3.5 -- says so when the replica holds nothing but the scan's own copy.
 *
 * Pure: it takes an IR and returns rows. Reading files and writing Neo4j are
 * the console's and the CLI's jobs, which is what lets the whole of 3 and 4 be
 * tested against the fixed test material with no database running.
 */

/** A design row's grade: structure, not content (기획서 민감도 표의 L1). */
const DESIGN_ROW_LEVEL = 1 satisfies SensitivityLevel;

const DESIGN_PATH_PREFIX = {
  AgentNode: "ir:node/",
  Requirement: "ir:requirement/",
  Eval: "ir:eval/",
  Document: "ir:document/",
} as const;

export function agentNodePath(id: string): string {
  return `${DESIGN_PATH_PREFIX.AgentNode}${id}`;
}
export function requirementPath(id: string): string {
  return `${DESIGN_PATH_PREFIX.Requirement}${id}`;
}
export function evalPath(id: string): string {
  return `${DESIGN_PATH_PREFIX.Eval}${id}`;
}
export function documentPath(id: string): string {
  return `${DESIGN_PATH_PREFIX.Document}${id}`;
}

/** The PortId a design row uses to point at a file in the scan replica. */
export function documentPortId(filePath: string): string {
  return `source:${filePath}`;
}

const RESERVED = new Set<string>(RESERVED_NODE_IDS);

/**
 * The design rows of one IR.
 *
 * `__start__`/`__end__` produce no rows: they are LangGraph's own terminals,
 * carry no sentence to rank on, and the graph *picture* is the design tab's
 * job (M3). Retrieval walks from a node to its documents, and a terminal is
 * never on that path.
 */
export function knowledgeFromIr(ir: Ir): KnowledgeSnapshot {
  const nodes: KnowledgeNodeView[] = [];
  const edges: KnowledgeEdgeView[] = [];
  const has = new Set<string>();

  const add = (node: KnowledgeNodeView) => {
    if (has.has(node.path)) return;
    has.add(node.path);
    nodes.push(node);
  };

  for (const node of ir.nodes) {
    add({
      path: agentNodePath(node.id),
      name: node.id,
      label: "AgentNode",
      port: null,
      level: DESIGN_ROW_LEVEL,
      text: node.label || null,
    });
  }
  for (const requirement of ir.requirements) {
    add({
      path: requirementPath(requirement.id),
      name: requirement.id,
      label: "Requirement",
      port: null,
      level: DESIGN_ROW_LEVEL,
      text: requirement.text || null,
    });
  }
  for (const item of ir.evals) {
    add({
      path: evalPath(item.id),
      name: item.id,
      label: "Eval",
      port: null,
      level: DESIGN_ROW_LEVEL,
      text: item.expect || null,
    });
  }
  for (const doc of ir.documents) {
    add({
      path: documentPath(doc.id),
      name: doc.id,
      label: "Document",
      // The file address, not a second copy of the path -- `AT` and the
      // retrieval result both read it from here.
      port: documentPortId(doc.path),
      // The IR declares the grade of what it reads (명세 §3.6). Never re-derived
      // here: 등급은 쓸 때 분류해 저장한다.
      level: doc.level,
      text: doc.when || null,
    });
  }

  const seen = new Set<string>();
  const link = (from: string, to: string, kind: KnowledgeEdgeView["kind"]) => {
    if (!has.has(from) || !has.has(to) || from === to) return;
    const key = `${kind}:${from}->${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, kind });
  };

  for (const edge of ir.edges) {
    if (RESERVED.has(edge.from) || RESERVED.has(edge.to)) continue;
    link(agentNodePath(edge.from), agentNodePath(edge.to), "FLOWS_TO");
  }
  for (const doc of ir.documents) {
    link(agentNodePath(doc.node), documentPath(doc.id), "CONSULTS");
  }
  for (const item of ir.evals) {
    link(evalPath(item.id), agentNodePath(item.node), "CHECKS");
  }
  for (const row of ir.requirementLinks) {
    link(agentNodePath(row.node), requirementPath(row.requirement), "IMPLEMENTS");
    link(evalPath(row.eval), requirementPath(row.requirement), "VERIFIES");
  }

  nodes.sort((a, b) => a.path.localeCompare(b.path));
  return { nodes, edges };
}

/**
 * Joins the design rows onto the scan replica.
 *
 * The only edge across the two families is `AT`, added when the file a
 * `Document` names is actually in the replica. A `Document` left without one
 * is the same fact `1.6/doc-exists` reports, standing where a person can see
 * it instead of only in a check result.
 */
export function mergeSnapshots(scan: KnowledgeSnapshot, design: KnowledgeSnapshot): KnowledgeSnapshot {
  const byPath = new Map<string, KnowledgeNodeView>();
  for (const node of [...scan.nodes, ...design.nodes]) {
    if (!byPath.has(node.path)) byPath.set(node.path, node);
  }

  const edges = [...scan.edges, ...design.edges];
  const seen = new Set(edges.map((edge) => `${edge.kind}:${edge.from}->${edge.to}`));
  for (const node of design.nodes) {
    if (node.label !== "Document" || !node.port) continue;
    const filePath = filePathFromPort(node.port);
    if (!filePath || !byPath.has(filePath)) continue;
    const key = `AT:${node.path}->${filePath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from: node.path, to: filePath, kind: "AT" });
  }

  const nodes = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { nodes, edges };
}

/** `source:guides/bug.md` → `guides/bug.md`. */
export function filePathFromPort(portId: string): string | null {
  const sep = portId.indexOf(":");
  if (sep <= 0) return null;
  const ref = portId.slice(sep + 1);
  return ref || null;
}

export interface ReplicaAudit {
  /** Rows and edges the scan could have produced on its own. */
  scanEdges: number;
  /** Edges that only `overlay.ir` can produce. 0 is the warned state. */
  designEdges: number;
  /** Edges that only 3 테스트's runs can produce (`RAN`). */
  runEdges: number;
  /** 3.5 -- null when the replica carries something the scan does not. */
  warning: string | null;
}

/**
 * 3.5 -- 「스캔 복제본뿐인가」.
 *
 * A pass is not the same as a graph worth having: if every relation in the
 * replica is one `scan` already wrote into `inferred.json`, then Neo4j is a
 * second copy of a JSON file and a query against it can only answer what the
 * file answers. That is a **warning**, not a failure -- a project whose design
 * has not been adopted yet is in a legitimate state, it just has no reason to
 * run a database.
 */
export function auditReplica(snapshot: KnowledgeSnapshot): ReplicaAudit {
  let scanEdges = 0;
  let designEdges = 0;
  let runEdges = 0;
  for (const edge of snapshot.edges) {
    if (isDesignRelation(edge.kind)) designEdges += 1;
    else if (isRunRelation(edge.kind)) runEdges += 1;
    else scanEdges += 1;
  }
  return {
    scanEdges,
    designEdges,
    runEdges,
    warning:
      designEdges === 0
        ? "스캔 복제본뿐이다 — 스캔에 없던 관계가 0개다. " +
          "설계를 채택하면(patchbay ir adopt) 요구사항·평가·문서 관계가 생긴다. " +
          "그때까지 이 그래프는 inferred.json이 답할 수 있는 것만 답한다."
        : null,
  };
}

/** A run row's path. Synthetic like the design rows — a run is not a file. */
export function runPath(runId: string): string {
  return `run:${runId}`;
}

/**
 * 실행 행 (기획 20261008a 4.1 — 실행↔요구사항↔eval↔문서). 3 테스트가 남긴 `test/activity.json` 에서:
 * 실행마다 `Run` 한 줄, 그 실행에서 실제로 일한 설계 노드마다 `RAN`. 설계에 없는 노드는 잇지 않는다.
 * 일한 노드가 없는 실행(답만 들어오고 할 일이 없던 것)은 관계가 없으니 행도 두지 않는다.
 */
export function knowledgeFromRuns(runs: readonly TestRunEntry[], ir: Ir): KnowledgeSnapshot {
  const designed = new Set(ir.nodes.map((n) => n.id));
  const nodes: KnowledgeNodeView[] = [];
  const edges: KnowledgeEdgeView[] = [];
  for (const run of runs) {
    const worked = run.worked.filter((n) => designed.has(n));
    if (!worked.length) continue;
    nodes.push({
      path: runPath(run.runId),
      // 이름은 ISO 시각 그대로 — 정렬이 된다. 화면이 그 기기의 시각으로 바꿔 보인다.
      name: `${run.startedAt ?? ""} · ${run.status}`,
      label: "Run",
      port: null,
      level: DESIGN_ROW_LEVEL,
      text: `${run.input.length ? `들어옴 ${run.input.join(", ")} · ` : ""}일함 ${worked.join(", ")}`,
    });
    for (const node of worked) edges.push({ from: runPath(run.runId), to: agentNodePath(node), kind: "RAN" });
  }
  return { nodes, edges };
}

export interface RunEvidenceStep {
  node: string;
  requirements: { id: string; text: string | null }[];
  evals: string[];
  documents: { id: string; port: string | null }[];
}

export interface RunEvidence {
  run: { path: string; name: string; text: string | null };
  steps: RunEvidenceStep[];
}

/**
 * 근거 경로 — 실행 → 일한 노드 → 그 노드가 맡은 요구사항 → 그 요구사항 · 노드를 보는 평가 → 그 노드가 찾는 문서.
 * 지식 그래프에서 「이 실행은 무엇을 근거로 했나」를 한 줄씩 읽게 한다. 스냅숏만 본다 — Neo4j가 꺼져도 답한다.
 */
export function runEvidence(snapshot: KnowledgeSnapshot, limit = 20): RunEvidence[] {
  const byPath = new Map(snapshot.nodes.map((n) => [n.path, n]));
  const out = (from: string, kind: string) => snapshot.edges.filter((e) => e.from === from && e.kind === kind).map((e) => e.to);
  const into = (to: string, kind: string) => snapshot.edges.filter((e) => e.to === to && e.kind === kind).map((e) => e.from);
  const runs = snapshot.nodes.filter((n) => n.label === "Run").sort((a, b) => b.name.localeCompare(a.name)).slice(0, limit);
  return runs.map((run) => ({
    run: { path: run.path, name: run.name, text: run.text },
    steps: out(run.path, "RAN").map((nodePath) => {
      const requirements = out(nodePath, "IMPLEMENTS");
      const evals = new Set([...into(nodePath, "CHECKS"), ...requirements.flatMap((r) => into(r, "VERIFIES"))]);
      return {
        node: byPath.get(nodePath)?.name ?? nodePath,
        requirements: requirements.map((r) => ({ id: byPath.get(r)?.name ?? r, text: byPath.get(r)?.text ?? null })),
        evals: [...evals].map((e) => byPath.get(e)?.name ?? e).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        documents: out(nodePath, "CONSULTS").map((d) => ({ id: byPath.get(d)?.name ?? d, port: byPath.get(d)?.port ?? null })),
      };
    }),
  }));
}

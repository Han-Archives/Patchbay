import { SECRET_LEVEL, WORKING_LEVEL, type SensitivityLevel } from "../sensitivity/sensitivity.js";

/**
 * The knowledge replica's shape -- what a node is, what a relation is, and
 * which file each relation is regenerated from (기획서 3.1 · 3.2).
 *
 * Lives in Core rather than in the console because 기획서 3.3~3.5 and 4.1~4.5
 * are the kernel's work: the CLI, MCP and the console must all read the same
 * graph through the same code (원칙 8). The console's `neo4jContract.ts` keeps
 * only what a browser needs and re-exports these as types.
 */

/**
 * Two families under one label set.
 *
 * `File`·`Folder`·`Skill`·`Artifact` are the **scan replica** -- a copy of
 * what `scan` already found. `Requirement`·`Eval`·`AgentNode`·`Document` are
 * the **design rows** the scan cannot know, because a person and a host model
 * wrote them into `overlay.ir`. 3.5 exists because a replica holding only the
 * first family is a copy of a JSON file, and no reason to run a database.
 */
export const KNOWLEDGE_LABELS = [
  "File",
  "Folder",
  "Skill",
  "Artifact",
  "Requirement",
  "Eval",
  "AgentNode",
  "Document",
  "Run",
] as const;
export type KnowledgeLabel = (typeof KNOWLEDGE_LABELS)[number];

/** The labels a scan can produce on its own. */
export const SCAN_LABELS = ["File", "Folder", "Skill", "Artifact"] as const satisfies readonly KnowledgeLabel[];

/** The labels that only `overlay.ir` can produce. */
export const DESIGN_LABELS = [
  "Requirement",
  "Eval",
  "AgentNode",
  "Document",
] as const satisfies readonly KnowledgeLabel[];

/**
 * The third family (기획 20261008a — 지식 그래프는 운영 뒤): a `Run` is one run read from the project's graph
 * server in 3 운영, and only `ops/activity.json` can produce it.
 */
export const RUN_LABELS = ["Run"] as const satisfies readonly KnowledgeLabel[];

export const KNOWLEDGE_RELATIONS = [
  "CONTAINS",
  "REFERENCES",
  "IMPLEMENTS",
  "VERIFIES",
  "CHECKS",
  "CONSULTS",
  "AT",
  "FLOWS_TO",
  "RAN",
] as const;
export type KnowledgeRelation = (typeof KNOWLEDGE_RELATIONS)[number];

export const SCAN_RELATIONS = ["CONTAINS", "REFERENCES"] as const satisfies readonly KnowledgeRelation[];

export const RUN_RELATIONS = ["RAN"] as const satisfies readonly KnowledgeRelation[];

export const DESIGN_RELATIONS = [
  "IMPLEMENTS",
  "VERIFIES",
  "CHECKS",
  "CONSULTS",
  "AT",
  "FLOWS_TO",
] as const satisfies readonly KnowledgeRelation[];

/**
 * 3.2 -- every relation names the file it came from and the command that
 * rebuilds it. 원칙 7: a relation with no regeneration path does not go into
 * the graph, because then the database becomes the original and nothing can
 * check it.
 */
export interface RelationOrigin {
  /** Which end points at which. */
  from: readonly KnowledgeLabel[];
  to: readonly KnowledgeLabel[];
  /** The file that owns this fact, and the field inside it. */
  source: string;
  /** What rebuilds the relation from that file. */
  rebuild: string;
  /** One line, shown next to the relation name on the user's screen. */
  means: string;
}

export const RELATION_ORIGINS: Record<KnowledgeRelation, RelationOrigin> = {
  CONTAINS: {
    from: ["Folder"],
    to: ["Folder", "File", "Skill", "Artifact"],
    source: "inferred.json · discoveredPorts[]",
    rebuild: "patchbay scan --project <alias>",
    means: "폴더가 그 안의 항목을 담는다",
  },
  REFERENCES: {
    from: ["File", "Skill", "Artifact"],
    to: ["File", "Skill", "Artifact"],
    source: "overlay.yaml · patches[] · wires[]",
    rebuild: "patchbay scan --project <alias> (연결은 사람이 적는다)",
    means: "한 항목이 다른 항목을 가리킨다",
  },
  IMPLEMENTS: {
    from: ["AgentNode"],
    to: ["Requirement"],
    source: "overlay.yaml · ir.requirementLinks[].{node,requirement}",
    rebuild: "patchbay ir adopt --project <alias>",
    means: "이 노드가 그 요구사항을 맡는다",
  },
  VERIFIES: {
    from: ["Eval"],
    to: ["Requirement"],
    source: "overlay.yaml · ir.requirementLinks[].{eval,requirement}",
    rebuild: "patchbay ir adopt --project <alias>",
    means: "이 평가가 그 요구사항을 확인한다",
  },
  CHECKS: {
    from: ["Eval"],
    to: ["AgentNode"],
    source: "overlay.yaml · ir.evals[].node",
    rebuild: "patchbay ir adopt --project <alias>",
    means: "이 평가가 그 노드를 본다",
  },
  CONSULTS: {
    from: ["AgentNode"],
    to: ["Document"],
    source: "overlay.yaml · ir.documents[].node",
    rebuild: "patchbay ir adopt --project <alias>",
    means: "이 노드가 그 문서를 찾아본다",
  },
  AT: {
    from: ["Document"],
    to: ["File"],
    source: "overlay.yaml · ir.documents[].path ↔ inferred.json의 파일",
    rebuild: "patchbay ir adopt + patchbay scan (둘 다 필요하다)",
    means: "문서 의존이 실제 파일에 닿는다",
  },
  FLOWS_TO: {
    from: ["AgentNode"],
    to: ["AgentNode"],
    source: "overlay.yaml · ir.edges[]",
    rebuild: "patchbay ir adopt --project <alias>",
    means: "실행이 이 노드에서 저 노드로 간다",
  },
  RAN: {
    from: ["Run"],
    to: ["AgentNode"],
    source: "ops/activity.json · runs[].worked",
    rebuild: "3 운영에서 실행 기록을 읽으면 다시 쓴다 (그래프 서버의 체크포인트에서)",
    means: "이 실행에서 그 노드가 실제로 일했다",
  },
};

/** What a label means, in the words the user's screen uses (terms.mdc). */
export const LABEL_MEANS: Record<KnowledgeLabel, string> = {
  File: "파일",
  Folder: "폴더",
  Skill: "스킬",
  Artifact: "산출물",
  Requirement: "요구사항 — EARS 문장 한 줄",
  Eval: "평가 — 무엇을 넣고 무엇을 기대하나",
  AgentNode: "에이전트 노드 — 그래프의 한 칸",
  Document: "문서 의존 — 어떤 입력일 때 이 문서인가",
  Run: "실행 — 운영에서 그래프가 한 번 돈 것",
};

/**
 * A row in the replica.
 *
 * `path` is the identity, unique per alias. A scan row's path is the file's
 * project-relative path; a design row's is synthetic (`ir:document/D1`) so the
 * design row and the file it points at stay **two** nodes -- a `Document` with
 * no `AT` edge is a path that does not exist, and that is worth seeing.
 */
export interface KnowledgeNodeView {
  path: string;
  name: string;
  label: KnowledgeLabel;
  /**
   * 항목 주소. For a design row that points at a file, the file's PortId --
   * so `AT` and the retrieval result's file path come from one field rather
   * than from a second copy of the path.
   */
  port: string | null;
  /**
   * Content sensitivity, carried from `inferred.json`'s `portLevels` through
   * ingest so the replica is graded rather than each reader re-deriving it.
   * A Folder takes the most secret grade found under it -- `classifyPath`
   * only looks at a path's *parent* segments, so the directory named
   * `secrets` would otherwise grade itself L2.
   */
  level: SensitivityLevel;
  /**
   * The row's own sentence: a Document's `when`, a Requirement's `text`, an
   * Eval's `expect`, an AgentNode's Korean label. Null for scan rows, which
   * have no sentence -- only a name. 4.3 ranks on this.
   */
  text: string | null;
}

export interface KnowledgeEdgeView {
  from: string;
  to: string;
  kind: KnowledgeRelation;
}

export interface KnowledgeSnapshot {
  nodes: KnowledgeNodeView[];
  edges: KnowledgeEdgeView[];
}

/** Never leaves the replica: the grade at or above which content is withheld. */
export const KNOWLEDGE_SECRET_LEVEL = SECRET_LEVEL;

/** A replica row written before levels existed. Re-ingest replaces it. */
export const KNOWLEDGE_ASSUMED_LEVEL = WORKING_LEVEL;

export interface KnowledgeCounts {
  files: number;
  folders: number;
  skills: number;
  artifacts: number;
  requirements: number;
  evals: number;
  agentNodes: number;
  documents: number;
  runs: number;
}

export function emptyCounts(): KnowledgeCounts {
  return {
    files: 0,
    folders: 0,
    skills: 0,
    artifacts: 0,
    requirements: 0,
    evals: 0,
    agentNodes: 0,
    documents: 0,
    runs: 0,
  };
}

const COUNT_FIELD: Record<KnowledgeLabel, keyof KnowledgeCounts> = {
  File: "files",
  Folder: "folders",
  Skill: "skills",
  Artifact: "artifacts",
  Requirement: "requirements",
  Eval: "evals",
  AgentNode: "agentNodes",
  Document: "documents",
  Run: "runs",
};

export function countsFromNodes(nodes: readonly KnowledgeNodeView[]): KnowledgeCounts {
  const counts = emptyCounts();
  for (const node of nodes) counts[COUNT_FIELD[node.label]] += 1;
  return counts;
}

/**
 * Reads a stored node's labels back. A Neo4j node carries `:Knowledge` plus
 * one of ours; an unknown set reads as `File` rather than throwing, so one
 * stale row cannot empty a whole result page.
 */
export function labelFromNeo4jLabels(labels: unknown): KnowledgeLabel {
  if (!Array.isArray(labels)) return "File";
  for (const item of KNOWLEDGE_LABELS) {
    if (labels.includes(item)) return item;
  }
  return "File";
}

export function isDesignLabel(label: KnowledgeLabel): boolean {
  return (DESIGN_LABELS as readonly KnowledgeLabel[]).includes(label);
}

export function isRunRelation(kind: KnowledgeRelation): boolean {
  return (RUN_RELATIONS as readonly KnowledgeRelation[]).includes(kind);
}

export function isDesignRelation(kind: KnowledgeRelation): boolean {
  return (DESIGN_RELATIONS as readonly KnowledgeRelation[]).includes(kind);
}

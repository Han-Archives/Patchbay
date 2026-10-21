/** Selected documents → evidence review → semantic relationships. Separate from the scan replica. */
export const SEMANTIC_PREDICATES = { USES: "사용한다", DEPENDS_ON: "의존한다", PART_OF: "일부다" } as const;
export type SemanticPredicate = keyof typeof SEMANTIC_PREDICATES;
export type EvidenceDecision = "pending" | "approved" | "rejected" | "withdrawn";
export interface SemanticChunk { id: string; heading: string; text: string; line: number }
export interface SemanticUsage { retrieval: boolean; graph: boolean }
export interface SemanticSource { id: string; path: string; usage?: SemanticUsage; remoteTransfer?: boolean }
export interface SemanticVersion { id: string; sourceId: string; hash: string; content: string; seq: number; chunks: SemanticChunk[] }
export interface SemanticEntity { id: string; name: string; sourceId: string; seq: number }
export interface SemanticClaim { id: string; from: string; to: string; predicate: SemanticPredicate; seq: number }
export interface SemanticEvidence { id: string; claimId: string; versionId: string; chunkId: string; quote: string; seq: number; model: string }
export interface SemanticEvent { seq: number; id: string; at: string; kind: "import" | "review" | "source"; evidenceId?: string; decision?: EvidenceDecision; note: string; sourceId?: string; usage?: SemanticUsage; remoteTransfer?: boolean }
export interface SemanticState {
  format: 1; seq: number; sources: SemanticSource[]; versions: SemanticVersion[];
  entities: SemanticEntity[]; claims: SemanticClaim[]; evidence: SemanticEvidence[]; events: SemanticEvent[];
}
export interface SemanticCandidate { chunkId: string; subject: string; predicate: SemanticPredicate; object: string; quote: string }
export interface SemanticEvidenceRow {
  id: string; claimId: string; from: string; to: string; subject: string; predicate: SemanticPredicate; object: string;
  sourceId: string; path: string; versionId: string; versionHash: string; chunkId: string;
  quote: string; context: string; line: number; originalLine: number; decision: EvidenceDecision;
  current: boolean; unavailable: boolean; model: string; history: SemanticEvent[];
}
export interface SemanticSourceView extends SemanticSource {
  versionId: string; hash: string; status: "current" | "changed" | "unavailable";
  versions: number; chunks: SemanticChunk[];
}
export interface SemanticWorkspace {
  revision: number; sources: SemanticSourceView[]; rows: SemanticEvidenceRow[];
  counts: { pending: number; approved: number; rejected: number; withdrawn: number; stale: number };
}
export interface SemanticProjection {
  seq: number; sources: SemanticSource[]; versions: SemanticVersion[];
  entities: SemanticEntity[]; claims: SemanticClaim[]; evidence: SemanticEvidenceRow[];
}
export interface SemanticGraph {
  entities: { id: string; name: string; sourceId: string }[];
  claims: { id: string; from: string; to: string; predicate: SemanticPredicate; evidenceIds: string[] }[];
  selected: string | null; truncated: boolean;
}
export interface SemanticView extends SemanticWorkspace {
  projection: { status: "ready" | "pending" | "disconnected" | "failed"; appliedSeq: number | null; error: string | null };
  graph: SemanticGraph;
}

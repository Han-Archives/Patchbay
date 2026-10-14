import { readOpsRuns } from "../runs/opsRuns.js";
import { readInferred, readOverlay } from "../studio/projectFiles.js";
import type { KnowledgeSnapshot } from "./contract.js";
import { auditReplica, knowledgeFromIr, knowledgeFromRuns, mergeSnapshots, type ReplicaAudit } from "./ingest.js";
import { graphFromInferred } from "./scanGraph.js";

/**
 * The whole replica of one project, built from the files that own it.
 *
 * 원칙 7 -- `inferred.json` and `overlay.yaml` are the originals and this is an
 * index, so the retrieval in `retrieve.ts` runs against *this* and answers with
 * the sidecar down. Neo4j gets the same snapshot written into it so the graph
 * can be browsed and queried, but nothing depends on it being up.
 */
export interface KnowledgeReplica {
  snapshot: KnowledgeSnapshot;
  audit: ReplicaAudit;
  /** The design iteration these rows came from. Null when 1단계 hasn't started. */
  irVersion: number | null;
}

export async function readKnowledgeReplica(studioHome: string, alias: string): Promise<KnowledgeReplica> {
  const inferred = await readInferred(studioHome, alias);
  const overlay = await readOverlay(studioHome, alias);
  const scan = graphFromInferred(inferred, overlay);
  let snapshot = overlay.ir ? mergeSnapshots(scan, knowledgeFromIr(overlay.ir)) : scan;
  // 셋째 줄기 — 3 운영의 실행 (기획 20261008a). 원본은 ops/activity.json.
  if (overlay.ir) {
    const runs = knowledgeFromRuns(await readOpsRuns(studioHome, alias), overlay.ir);
    snapshot = { nodes: [...snapshot.nodes, ...runs.nodes], edges: [...snapshot.edges, ...runs.edges] };
  }
  return { snapshot, audit: auditReplica(snapshot), irVersion: overlay.ir?.version ?? null };
}

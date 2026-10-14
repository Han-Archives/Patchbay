import {
  KNOWLEDGE_RELATIONS,
  RELATION_ORIGINS,
  countsFromNodes,
  readKnowledgeReplica,
  resolveProjectAlias,
  resolveStudioHome,
  readStudio,
  type KnowledgeCounts,
  type ReplicaAudit,
} from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface KnowledgeAuditCommandOptions {
  project?: string;
  origins?: boolean;
  json?: boolean;
}

function renderHuman(
  alias: string,
  counts: KnowledgeCounts,
  audit: ReplicaAudit,
  irVersion: number | null,
  byKind: Record<string, number>,
  origins: boolean,
): string[] {
  const lines = [`지식 그래프 — ${alias}`, ""];
  lines.push("  [스캔 복제본] scan이 찾은 것");
  lines.push(`   File ${counts.files} · Folder ${counts.folders} · Skill ${counts.skills} · Artifact ${counts.artifacts}`);
  lines.push(`   관계 ${audit.scanEdges}`);
  lines.push("");
  lines.push(`  [설계 행] overlay.ir이 적은 것${irVersion === null ? " — 아직 채택 없음" : ` — v${irVersion}`}`);
  lines.push(
    `   Requirement ${counts.requirements} · Eval ${counts.evals} · AgentNode ${counts.agentNodes} · Document ${counts.documents}`,
  );
  lines.push(`   관계 ${audit.designEdges}`);
  lines.push("");
  for (const kind of KNOWLEDGE_RELATIONS) {
    const n = byKind[kind] ?? 0;
    if (n === 0 && !origins) continue;
    lines.push(`   ${kind.padEnd(11)} ${String(n).padStart(4)}   ${RELATION_ORIGINS[kind].means}`);
    // 3.2 — 재생성 경로 없는 관계는 그래프에 넣지 않는다 (원칙 7).
    if (origins) {
      lines.push(`   ${" ".repeat(11)}      원본: ${RELATION_ORIGINS[kind].source}`);
      lines.push(`   ${" ".repeat(11)}      재생성: ${RELATION_ORIGINS[kind].rebuild}`);
    }
  }
  lines.push("");
  lines.push(audit.warning ? `  ⚠ ${audit.warning}` : "  설계 관계가 있다 — 이 그래프는 스캔이 못 답하는 것을 답한다.");
  return lines;
}

/**
 * `patchbay knowledge audit --project <alias> [--origins]`
 *
 * 3.5 -- 「스캔 복제본뿐인가」. A warning, never a failure: a project that has
 * not adopted a design yet is in a legitimate state, it just has no reason to
 * run a database. Exit stays 0 so this cannot be mistaken for a gate.
 */
export async function runKnowledgeAudit(
  options: KnowledgeAuditCommandOptions,
  studioHome: string = resolveStudioHome(),
): Promise<number> {
  const json = Boolean(options.json);
  const studio = await readStudio(studioHome);
  const resolution = resolveProjectAlias(studio, options.project);
  if (!resolution.ok) {
    printError(json, resolution.message);
    return 1;
  }
  const alias = resolution.alias;

  let replica;
  try {
    replica = await readKnowledgeReplica(studioHome, alias);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      printError(json, `knowledge audit: "${alias}" 는 아직 스캔되지 않았다 — patchbay scan --project ${alias}`);
      return 1;
    }
    throw error;
  }

  const counts = countsFromNodes(replica.snapshot.nodes);
  const byKind: Record<string, number> = {};
  for (const edge of replica.snapshot.edges) byKind[edge.kind] = (byKind[edge.kind] ?? 0) + 1;

  printResult(
    json,
    {
      ok: true,
      project: alias,
      irVersion: replica.irVersion,
      counts,
      edges: byKind,
      scanEdges: replica.audit.scanEdges,
      designEdges: replica.audit.designEdges,
      warning: replica.audit.warning,
      origins: Object.fromEntries(KNOWLEDGE_RELATIONS.map((kind) => [kind, RELATION_ORIGINS[kind]])),
    },
    renderHuman(alias, counts, replica.audit, replica.irVersion, byKind, Boolean(options.origins)),
  );
  return 0;
}

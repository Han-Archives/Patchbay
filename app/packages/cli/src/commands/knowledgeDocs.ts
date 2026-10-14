import {
  readKnowledgeReplica,
  resolveProjectAlias,
  resolveStudioHome,
  retrieveDocuments,
  readStudio,
  type DocumentHit,
  type RetrieveResult,
} from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface KnowledgeDocsCommandOptions {
  project?: string;
  anchor?: string;
  input?: string;
  hops?: string;
  json?: boolean;
}

function renderHuman(alias: string, result: RetrieveResult, designEdges: number): string[] {
  const lines = [`문서 호출 — ${alias} · 앵커 ${result.anchor?.name ?? "?"} · ${result.maxHops}홉`, ""];
  if (designEdges === 0) {
    lines.push("  ⚠ 설계 관계가 0개다 — 스캔 복제본뿐이다. patchbay ir adopt 뒤에 다시 부른다.", "");
  }
  if (result.hits.length === 0) {
    lines.push("  이 홉 안에는 문서가 없다.");
    return lines;
  }
  lines.push(`  후보 ${result.hits.length}개 · 말 맞은 것 ${result.matchedCount}개` +
    (result.withheld > 0 ? ` · 민감도로 가린 것 ${result.withheld}개` : ""));
  lines.push("");
  result.hits.forEach((hit: DocumentHit, index) => {
    const mark = hit.matched > 0 ? "✅" : "· ";
    lines.push(`  ${mark} ${index + 1}. ${hit.documentId}  ${hit.path}  L${hit.level}  ${hit.hops}홉  맞은 말 ${hit.matched}`);
    if (hit.when) lines.push(`        조건: ${hit.when}`);
    // 4.5 -- 이 줄이 없으면 위 순위는 블랙박스다.
    lines.push(`        근거: ${hit.via}`);
  });
  if (result.matchedCount === 0) {
    lines.push("");
    lines.push("  입력의 말이 어느 조건에도 맞지 않았다 — 어느 문서를 쓸지는 노드가 정한다.");
  }
  return lines;
}

/**
 * `patchbay knowledge docs --project <alias> --anchor <x> [--input "<문장>"] [--hops 1|2]`
 *
 * 4단계 문서 호출 그대로 (기획서 4.1~4.5). Reads the project's own files, so it
 * answers with Neo4j down -- the replica is an index, not the original (원칙 7).
 */
export async function runKnowledgeDocs(
  options: KnowledgeDocsCommandOptions,
  studioHome: string = resolveStudioHome(),
): Promise<number> {
  const json = Boolean(options.json);
  const anchor = (options.anchor ?? "").trim();
  if (!anchor) {
    printError(json, "knowledge docs: --anchor <경로·이름·항목 주소> 가 필요하다.");
    return 1;
  }
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
      printError(json, `knowledge docs: "${alias}" 는 아직 스캔되지 않았다 — patchbay scan --project ${alias}`);
      return 1;
    }
    throw error;
  }

  const hops = Number.parseInt(options.hops ?? "", 10);
  const result = retrieveDocuments(replica.snapshot, {
    anchor,
    query: options.input ?? "",
    maxHops: Number.isInteger(hops) ? hops : undefined,
  });

  if (result.error) {
    printError(json, `knowledge docs: ${result.error}`, {
      ok: false,
      project: alias,
      anchor,
      error: result.error,
      candidates: result.candidates,
    });
    return 1;
  }

  printResult(
    json,
    {
      ok: true,
      project: alias,
      anchor,
      anchorPath: result.anchor?.path ?? null,
      irVersion: replica.irVersion,
      maxHops: result.maxHops,
      terms: result.terms,
      matchedCount: result.matchedCount,
      withheld: result.withheld,
      designEdges: replica.audit.designEdges,
      hits: result.hits,
    },
    renderHuman(alias, result, replica.audit.designEdges),
  );
  return 0;
}

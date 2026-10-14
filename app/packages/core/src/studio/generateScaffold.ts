import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_SCAFFOLD_DIR,
  SCAFFOLD_FILES,
  compareNodeSets,
  generateScaffoldSources,
  type NodeSetComparison,
  type ScaffoldSources,
} from "../ir/generate.js";
import { runIrChecks, summarizeIrChecks, type IrCheckSummary } from "../ir/checks.js";
import type { Ir } from "../types/ir.js";

/**
 * Writes the 2.1–2.3 scaffold. The rule is the point: **never overwrite an
 * existing implementation file.** A second run that clobbered a person's
 * 2.4 edits would be the bidirectional sync 원칙 3 forbids, just arriving
 * as a generator instead of a watcher.
 *
 * Missing files are still written on a later run — generating `evals.test.ts`
 * after someone already filled `graph.ts` is the same one-way write, not a
 * rewrite.
 */

export { DEFAULT_SCAFFOLD_DIR, SCAFFOLD_FILES };

export type WriteScaffoldResult =
  | {
      ok: true;
      outDir: string;
      written: string[];
      skipped: Array<{ file: string; reason: "exists" }>;
      nodes: NodeSetComparison;
    }
  | {
      ok: false;
      error: string;
      checks?: IrCheckSummary;
      nodes?: NodeSetComparison;
      written?: string[];
      skipped?: Array<{ file: string; reason: "exists" }>;
    };

async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function writeScaffold(
  ir: Ir,
  outDir: string,
  options: { docRoot?: string } = {},
): Promise<WriteScaffoldResult> {
  const checks = summarizeIrChecks(runIrChecks(ir, { docRoot: options.docRoot }));
  if (!checks.passed) {
    return {
      ok: false,
      error:
        `설계 규칙 검사를 통과하지 못했다 — 돌아갈 칸: ${checks.failedGates.join(" · ")}` +
        (checks.invalidated.length ? ` (같이 무효: ${checks.invalidated.join(" · ")})` : "") +
        ". 2단계는 1단계의 산출물만 먹는다.",
      checks,
    };
  }

  const sources: ScaffoldSources = generateScaffoldSources(ir);
  const absOut = path.resolve(outDir);
  await fs.mkdir(absOut, { recursive: true });

  const written: string[] = [];
  const skipped: Array<{ file: string; reason: "exists" }> = [];

  for (const file of Object.values(SCAFFOLD_FILES)) {
    const dest = path.join(absOut, file);
    if (await pathExists(dest)) {
      skipped.push({ file, reason: "exists" });
      continue;
    }
    await fs.writeFile(dest, sources[file], "utf8");
    written.push(file);
  }

  const graphPath = path.join(absOut, SCAFFOLD_FILES.graph);
  const graphSource = (await pathExists(graphPath))
    ? await fs.readFile(graphPath, "utf8")
    : sources[SCAFFOLD_FILES.graph];
  const nodes = compareNodeSets(ir, graphSource);
  if (!nodes.match) {
    const missing = nodes.missing.length ? `IR에만 있음: ${nodes.missing.join(", ")}` : "";
    const extra = nodes.extra.length ? `코드에만 있음: ${nodes.extra.join(", ")}` : "";
    return {
      ok: false,
      error: `그래프의 노드 집합이 IR과 다르다. ${[missing, extra].filter(Boolean).join(" · ")}`,
      nodes,
      written,
      skipped,
    };
  }

  return { ok: true, outDir: absOut, written, skipped, nodes };
}

import {
  checkBudget,
  compareRunsToDesign,
  readOverlay,
  readRunRecords,
  resolveProjectAlias,
  resolveStudioHome,
  readStudio,
  type RunCompareResult,
  type BudgetReport,
} from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface RunsCompareCommandOptions {
  project?: string;
  json?: boolean;
}

function renderHuman(alias: string, result: RunCompareResult, budget: BudgetReport): string[] {
  const lines = [`설계와 실물 대조 — ${alias} · 설계 v${result.irVersion}`, ""];
  lines.push(
    `  수집 ${result.compared}건 — ` +
      Object.entries(result.byStatus)
        .map(([status, count]) => `${status} ${count}`)
        .join(" · "),
  );
  if (result.skipped.length > 0) {
    lines.push(
      `  다른 설계의 기록 ${result.skipped.length}건은 대조하지 않았다: ` +
        result.skipped.map((row) => `${row.runId}(v${row.irVersion})`).join(" · "),
    );
  }
  lines.push("");

  const lanes = { plan: [] as string[], actual: [] as string[], both: [] as string[] };
  for (const node of result.nodes) lanes[node.lane].push(`${node.id}${node.runs ? `(${node.runs})` : ""}`);
  lines.push(`  [설계에만]  ${lanes.plan.join(" · ") || "없음"}`);
  lines.push(`  [둘 다]     ${lanes.both.join(" · ") || "없음"}`);
  lines.push(`  [실행에만]  ${lanes.actual.join(" · ") || "없음"}`);
  lines.push("");

  if (result.findings.length === 0) {
    lines.push("  어긋난 것 없음.");
  } else {
    lines.push(`  어긋난 것 ${result.findings.length}건`);
    for (const finding of result.findings) {
      lines.push(`   ❌ [${finding.kind}] ${finding.detail}${finding.runId ? `  (${finding.runId})` : ""}`);
    }
  }
  lines.push("");

  const cost = result.usage.costUsd === null ? "보고 없음" : `$${result.usage.costUsd}`;
  lines.push(
    `  대조한 ${result.compared}건의 토큰 in ${result.usage.inputTokens} · out ${result.usage.outputTokens} · 비용 ${cost}` +
      (result.usage.costMissing ? ` (비용 미보고 ${result.usage.costMissing}건)` : ""),
  );
  /**
   * 한도는 **보관된 기록 전체**를 본다. 비용은 설계 버전으로 나뉘지 않는다 — 지난
   * 버전에서 넘긴 실행도 실제로 넘었고 실제로 돈이 나갔다. 위 줄과 세는 대상이
   * 다르므로 어느 묶음인지 줄에 적는다.
   */
  lines.push(`  비용 한도 — 보관된 ${budget.checked}건 전체`);
  if (!budget.budget) {
    lines.push("      걸지 않았다 (overlay.budget 없음).");
  } else if (budget.breaches.length === 0) {
    lines.push("      넘긴 실행 없음.");
  } else {
    lines.push(`      넘긴 실행 ${budget.breaches.length}건 — 막지 않고 말한다 (원칙 9)`);
    for (const breach of budget.breaches) {
      lines.push(`   ⚠  ${breach.runId} ${breach.kind} ${breach.actual} > ${breach.limit} (+${breach.over})`);
    }
  }
  if (budget.costUnknown.length > 0) {
    lines.push(`      비용을 보고하지 않아 판정 못 한 실행 ${budget.costUnknown.length}건`);
  }
  return lines;
}

/**
 * `patchbay runs compare --project <alias>`
 *
 * 5.3 + 5.6 in one read: which nodes ran, what the runs did that the design
 * never declared, and which runs went over the ceiling. Read-only — turning a
 * failure into an eval is `runs draft-evals`, and that writes only the draft.
 *
 * Exits 1 when something is off the design, so CI can use it as a gate.
 */
export async function runRunsCompare(
  options: RunsCompareCommandOptions,
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

  const overlay = await readOverlay(studioHome, alias);
  if (!overlay.ir) {
    printError(json, `runs compare: "${alias}" 에 승인된 설계가 없다 — 대조할 기준이 없다.`);
    return 1;
  }
  const { records, rejected } = await readRunRecords(studioHome, alias);
  if (records.length === 0 && rejected.length === 0) {
    printError(
      json,
      `runs compare: "${alias}" 에 실행 기록이 없다 — patchbay runs collect --project ${alias} --file <기록>`,
    );
    return 1;
  }

  const result = compareRunsToDesign(overlay.ir, records);
  const budget = checkBudget(overlay.budget, records);
  const lines = renderHuman(alias, result, budget);
  if (rejected.length > 0) {
    lines.push("", `  읽지 못한 파일 ${rejected.length}개:`, ...rejected.map((row) => `    ${row.error}`));
  }

  printResult(json, { ok: true, project: alias, compare: result, budget, rejected }, lines);
  // 안 돈 노드는 아직 안 돈 것일 수 있다 — 게이트로 세지 않는다.
  const hard = result.findings.filter((finding) => finding.kind !== "node-never-ran");
  return hard.length > 0 || rejected.length > 0 ? 1 : 0;
}

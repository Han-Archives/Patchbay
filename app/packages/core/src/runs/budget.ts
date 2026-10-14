import type { Budget } from "../types/overlay.js";
import type { RunRecord } from "./types.js";

/**
 * 5.6 -- 비용 한도.
 *
 * Reports, never blocks (원칙 9). Patchbay does not sit in the call path, so a
 * "limit" here can only mean「넘긴 실행을 찾아 말한다」-- and saying that plainly
 * is better than a switch that looks like enforcement and isn't.
 */

export interface BudgetBreach {
  runId: string;
  /** Which ceiling, and by how much. */
  kind: "tokens" | "cost";
  limit: number;
  actual: number;
  over: number;
}

export interface BudgetReport {
  /** Null when `overlay.budget` is absent -- 한도를 걸지 않은 것과 0은 다르다. */
  budget: Budget | null;
  checked: number;
  /** Records the cost ceiling could not judge because the provider sent no cost. */
  costUnknown: string[];
  breaches: BudgetBreach[];
  totals: { tokens: number; costUsd: number | null };
}

export function checkBudget(budget: Budget | undefined, records: readonly RunRecord[]): BudgetReport {
  const breaches: BudgetBreach[] = [];
  const costUnknown: string[] = [];
  let tokens = 0;
  let costUsd = 0;
  let costSeen = 0;

  for (const record of records) {
    const runTokens = record.usage.inputTokens + record.usage.outputTokens;
    tokens += runTokens;
    if (record.usage.costUsd === undefined) costUnknown.push(record.runId);
    else {
      costUsd += record.usage.costUsd;
      costSeen += 1;
    }
    if (!budget) continue;

    if (budget.tokensPerRun !== undefined && runTokens > budget.tokensPerRun) {
      breaches.push({
        runId: record.runId,
        kind: "tokens",
        limit: budget.tokensPerRun,
        actual: runTokens,
        over: runTokens - budget.tokensPerRun,
      });
    }
    if (
      budget.costUsdPerRun !== undefined &&
      record.usage.costUsd !== undefined &&
      record.usage.costUsd > budget.costUsdPerRun
    ) {
      breaches.push({
        runId: record.runId,
        kind: "cost",
        limit: budget.costUsdPerRun,
        actual: record.usage.costUsd,
        over: Number((record.usage.costUsd - budget.costUsdPerRun).toFixed(6)),
      });
    }
  }

  return {
    budget: budget ?? null,
    checked: records.length,
    costUnknown,
    breaches,
    totals: { tokens, costUsd: costSeen > 0 ? Number(costUsd.toFixed(6)) : null },
  };
}

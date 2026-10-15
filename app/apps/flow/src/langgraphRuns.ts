import {
  normalizeLangGraphRun,
  readOverlay,
  writeRunRecord,
  type RunGap,
  type RunRecord,
} from "@patchbay/core";
import type { LangGraphPort } from "./langgraphAdapter.js";

/**
 * 첫 실행 기록 공급자 — 로컬 LangGraph HTTP (명세 §5.5의 채택값).
 *
 * Sits beside the LangGraph adapter, as the spec says, and does no shaping of
 * its own: `normalizeLangGraphRun` (Core) decides what a §5.2 record is, so the
 * CLI, MCP and this console cannot disagree about it (원칙 8).
 *
 * LangSmith stays on hold: it needs a cloud upload, and sending runs outward
 * right after P0 closed a local exposure is the wrong order.
 */

export interface CollectedRun {
  record: RunRecord;
  file: string;
}

export interface RunCollectReport {
  threadId: string;
  /** Records written to `test-runs/<runId>.json`. */
  collected: CollectedRun[];
  /**
   * Runs LangGraph reported but that could not be completed, with the fields it
   * does not report. Never written as a record with empty arrays -- 「안 불렀다」와
   * 「기록이 없다」는 다른 사실이다 (§5.2).
   */
  incomplete: Array<{ runId: string | null; gaps: RunGap[]; reason: string }>;
  warnings: string[];
}

export type CollectRunsResult =
  | { ok: true; body: RunCollectReport }
  | { ok: false; status: 400 | 404 | 503; error: string };

export async function collectLangGraphRuns(
  studioHome: string,
  alias: string | undefined,
  threadId: string | undefined,
  port: LangGraphPort | undefined,
): Promise<CollectRunsResult> {
  if (!alias) return { ok: false, status: 400, error: "runs collect: alias 가 필요하다." };
  if (!threadId) return { ok: false, status: 400, error: "runs collect: thread 가 필요하다." };
  if (!port || !(await safeProbe(port))) {
    return { ok: false, status: 503, error: "runs collect: LangGraph에 붙지 못했다." };
  }

  const overlay = await readOverlay(studioHome, alias);
  if (!overlay.ir) {
    return {
      ok: false,
      status: 404,
      error: `runs collect: "${alias}" 에 승인된 설계가 없다 — 어느 설계의 실행인지 적을 수 없다 (irVersion).`,
    };
  }
  const irVersion = overlay.ir.version;
  const graphId = overlay.ir.graph || undefined;

  const warnings: string[] = [];
  const listed = await port.listRuns(threadId);
  if (listed === null) {
    return { ok: false, status: 503, error: "runs collect: 실행 목록을 읽지 못했다." };
  }
  /**
   * The graph's own call log lives in thread state, and one thread carries one
   * state -- the tip. So the newest run is the one whose calls that state
   * describes; older runs in the same thread would be given the wrong log.
   */
  const state = await port.getState(threadId);
  if (state === null) warnings.push("스레드 상태를 읽지 못했다 — 그래프가 남긴 호출 기록 없이는 기록을 완성할 수 없다.");

  const collected: CollectedRun[] = [];
  const incomplete: RunCollectReport["incomplete"] = [];
  for (const [index, raw] of listed.entries()) {
    const result = normalizeLangGraphRun({
      run: raw,
      state: index === 0 ? state : undefined,
      irVersion,
      graphId,
    });
    if (!result.ok) {
      incomplete.push({ runId: runIdOf(raw), gaps: result.gaps, reason: result.reason });
      continue;
    }
    const file = await writeRunRecord(studioHome, alias, result.record);
    collected.push({ record: result.record, file });
  }

  return { ok: true, body: { threadId, collected, incomplete, warnings } };
}

function runIdOf(raw: unknown): string | null {
  if (raw === null || typeof raw !== "object") return null;
  const value = (raw as Record<string, unknown>).run_id ?? (raw as Record<string, unknown>).runId;
  return typeof value === "string" ? value : null;
}

async function safeProbe(port: LangGraphPort): Promise<boolean> {
  try {
    return await port.probe();
  } catch {
    return false;
  }
}

import {
  appendProposedEvals,
  draftEvalsFromRuns,
  draftsAsIrEvals,
  readOverlay,
  readProposedIrIfValid,
  readRunRecords,
  resolveProjectAlias,
  resolveStudioHome,
  readStudio,
} from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface RunsDraftEvalsCommandOptions {
  project?: string;
  write?: boolean;
  json?: boolean;
}

/**
 * `patchbay runs draft-evals --project <alias> [--write]`
 *
 * 5.4 — 실패 기록을 평가 사례 초안으로. **This is what closes the loop**: without
 * it 5단계 is observation and not a cycle (기획서 §2).
 *
 * Prints by default and writes only with `--write`, and even then only to
 * `ir.proposed.yaml`. The approved design keeps its single write path
 * (`ir adopt`), so a failing run can propose an evaluation but never adopt one.
 */
export async function runRunsDraftEvals(
  options: RunsDraftEvalsCommandOptions,
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
    printError(json, `runs draft-evals: "${alias}" 에 승인된 설계가 없다.`);
    return 1;
  }
  const { records } = await readRunRecords(studioHome, alias);
  const result = draftEvalsFromRuns(overlay.ir, records, { draft: await readProposedIrIfValid(studioHome, alias) });
  const fresh = draftsAsIrEvals(result);

  const lines = [`실패 → 평가 초안 — ${alias} · 설계 v${result.irVersion}`, ""];
  if (result.draftEvals.length === 0) {
    lines.push("  초안으로 만들 실패 기록이 없다.");
  } else {
    lines.push(`  기록 ${result.from.length}건 → 초안 ${result.draftEvals.length}개`);
    lines.push("");
    for (const draft of result.draftEvals) {
      lines.push(`  ${draft.id}  node=${draft.node}  kind=${draft.kind}${draft.inDraft ? "  (이미 초안에 있다)" : ""}`);
      lines.push(`      입력: ${draft.input}`);
      lines.push(`      기대: ${draft.expect || "(비었다 — 사람이 채운다)"}`);
      lines.push(`      근거: ${draft.basis}`);
    }
    // 이미 초안에 있는 평가의 행은 그 초안 파일 끝 주석에 이미 있다.
    const waiting = new Set(fresh.map((entry) => entry.id));
    const toFill = result.requirementLinksToFill.filter((link) => waiting.has(link.eval));
    if (toFill.length > 0) {
      lines.push("");
      lines.push("  추적 표는 요구사항 칸을 비워 둔다 — 런타임은 요구사항을 모른다:");
      for (const row of toFill) lines.push(`      { requirement: ?, node: ${row.node}, eval: ${row.eval} }`);
    }
  }
  if (result.skipped.length > 0) {
    lines.push("", `  넘긴 기록 ${result.skipped.length}건:`);
    for (const row of result.skipped) lines.push(`    ${row.runId} — ${row.why}`);
  }

  let wrote: string | null = null;
  if (options.write && result.draftEvals.length > 0 && fresh.length === 0) {
    lines.push("", "  같은 실패의 평가가 이미 초안에 있다 — 새로 넣을 것이 없다.");
  } else if (options.write && fresh.length > 0) {
    const appended = await appendProposedEvals(
      studioHome,
      alias,
      fresh,
      result.requirementLinksToFill.map((row) => ({ node: row.node, eval: row.eval })),
    );
    if (!appended.ok) {
      printError(json, `runs draft-evals: ${appended.error}`);
      return 1;
    }
    wrote = appended.file;
    lines.push(
      "",
      `  초안에 ${appended.added.join(" · ")} 를 넣었다 — ${appended.file}`,
      `  (${appended.startedFrom === "approved" ? "승인된 설계에서 시작했다" : "있던 초안에 덧붙였다"})`,
      `  승인된 설계는 그대로다. 다음: patchbay ir diff --project ${alias}`,
    );
  } else if (result.draftEvals.length > 0) {
    lines.push("", `  --write 를 주면 ir.proposed.yaml 에 넣는다. 승인된 설계는 건드리지 않는다.`);
  }

  printResult(json, { ok: true, project: alias, wrote, ...result }, lines);
  return 0;
}

import path from "node:path";
import {
  PROPOSED_IR_FILE_NAME,
  parseIr,
  readIrFile,
  readOverlay,
  readProposedIr,
  readStudio,
  resolveProjectAlias,
  resolveStudioHome,
  runIrChecks,
  summarizeIrChecks,
  type Ir,
  type IrCheckResult,
} from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface IrCheckCommandOptions {
  project?: string;
  file?: string;
  docs?: string;
  proposed?: boolean;
  json?: boolean;
}

/** The one-line verdict, in the order a person reads it: what failed, where to go back, what went stale. */
function verdictLines(summary: ReturnType<typeof summarizeIrChecks>): string[] {
  if (summary.passed) return ["게이트 통과 — 2단계로."];
  return [
    `돌아갈 칸: ${summary.failedGates.join(" · ")}`,
    ...(summary.invalidated.length ? [`같이 무효가 된 칸: ${summary.invalidated.join(" · ")}`] : []),
  ];
}

function renderHuman(source: string, results: IrCheckResult[], summary: ReturnType<typeof summarizeIrChecks>): string[] {
  const lines = [`설계 규칙 검사 — ${source}`, ""];
  let gate = "";
  for (const result of results) {
    if (result.gate !== gate) {
      gate = result.gate;
      lines.push(`  [${gate}]`);
    }
    const mark = result.ok === null ? "⏭ " : result.ok ? "✅" : "❌";
    lines.push(`   ${mark} ${result.id}${result.note ? `  — ${result.note}` : ""}`);
  }
  const judged = results.filter((result) => result.ok !== null);
  const passed = judged.filter((result) => result.ok).length;
  lines.push("");
  lines.push(
    `  ${passed} / ${judged.length} 통과` + (summary.skipped.length ? ` · ${summary.skipped.length}개 건너뜀` : ""),
  );
  for (const line of verdictLines(summary)) lines.push(`  ${line}`);
  return lines;
}

/**
 * `patchbay ir check [--project <alias>] [--proposed | --file <path>] [--json]`
 *
 * Runs 명세 20260929a §7.1's design rules over a project's IR and reports the
 * cell to go back to. Read-only: it never writes `overlay.ir` -- that has
 * exactly one write path (`ir adopt`), and a checker that could also adopt
 * would make the gate optional.
 *
 * Document paths are resolved against the project's repo root, so 1.6's two
 * filesystem checks judge the real files rather than being skipped.
 */
export async function runIrCheck(
  options: IrCheckCommandOptions,
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
  const project = studio.projects.find((entry) => entry.alias === alias);
  if (!project) {
    printError(json, `ir check: "${alias}" 는 등록된 프로젝트가 아니다.`);
    return 1;
  }

  let raw: unknown;
  let source: string;
  /**
   * What 1.6's document paths are relative to. A project's own IR is relative
   * to its repo; a standalone `--file` is relative to wherever that file sits
   * (a fixture keeps its documents beside it), which `--docs` overrides.
   */
  let docRoot = project.path;
  if (options.file) {
    const read = await readIrFile(options.file);
    if (!read.ok) {
      printError(json, `ir check: ${read.error}`);
      return 1;
    }
    raw = read.raw;
    source = options.file;
    docRoot = path.dirname(path.resolve(options.file));
  } else if (options.proposed) {
    const read = await readProposedIr(studioHome, alias);
    if (!read.ok) {
      printError(json, `ir check: ${read.error}`);
      return 1;
    }
    raw = read.raw;
    source = `${alias} · ${PROPOSED_IR_FILE_NAME}`;
  } else {
    const overlay = await readOverlay(studioHome, alias);
    if (!overlay.ir) {
      // 없음과 빈 것은 다르다 — 없으면 아직 1단계를 시작하지 않은 것이다.
      printError(
        json,
        `ir check: "${alias}" 의 overlay.yaml 에 ir 절이 없다 — 1단계를 아직 시작하지 않았다.\n` +
          `  초안을 보려면: patchbay ir check --project ${alias} --proposed`,
      );
      return 1;
    }
    raw = overlay.ir;
    source = `${alias} · overlay.ir`;
  }

  const parsed = parseIr(raw);
  if (!parsed.ok) {
    printError(json, parsed.error, { ok: false, source, error: parsed.error });
    return 1;
  }

  const ir: Ir = parsed.ir;
  if (options.docs) docRoot = path.resolve(options.docs);
  const results = runIrChecks(ir, { docRoot });
  const summary = summarizeIrChecks(results);

  printResult(
    json,
    {
      source,
      project: alias,
      docRoot,
      irVersion: ir.version,
      passed: summary.passed,
      checks: summary.checks,
      failed: summary.failed,
      failedGates: summary.failedGates,
      invalidated: summary.invalidated,
      skipped: summary.skipped,
    },
    renderHuman(source, results, summary),
  );
  // 회귀 기준은 통과 개수가 아니라 실패한 검사 id와 돌아갈 칸이다 (명세 채택값 18).
  return summary.passed ? 0 : 1;
}

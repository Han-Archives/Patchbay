import fs from "node:fs/promises";
import {
  fitEvalRun,
  parseEvalRun,
  readOverlay,
  resolveProjectAlias,
  resolveStudioHome,
  readStudio,
  scoreEvalRun,
  writeEvalRun,
} from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface EvalsRecordCommandOptions {
  project?: string;
  file?: string;
  json?: boolean;
}

/**
 * `patchbay evals record --project <alias> --file <results.json>`
 *
 * Files the results of running a version's `evals[]`. Patchbay does not run
 * them — the generated `evals.test.ts` does, inside the project, and a
 * model-scored eval is scored by a person (명세 §3.7). This keeps the numbers
 * beside the design they belong to so `version compare` can put two versions
 * next to each other, and `ir adopt` archives them with the version they judged.
 *
 * Refuses results whose `irVersion` is not the design in force: results filed
 * against the wrong version would make a later comparison compare nothing.
 */
export async function runEvalsRecord(
  options: EvalsRecordCommandOptions,
  studioHome: string = resolveStudioHome(),
): Promise<number> {
  const json = Boolean(options.json);
  if (!options.file) {
    printError(json, "evals record: --file <평가 결과 JSON> 이 필요하다.");
    return 1;
  }
  const studio = await readStudio(studioHome);
  const resolution = resolveProjectAlias(studio, options.project);
  if (!resolution.ok) {
    printError(json, resolution.message);
    return 1;
  }
  const alias = resolution.alias;

  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(options.file, "utf8"));
  } catch (error) {
    printError(json, `evals record: ${options.file} 를 읽지 못했다 — ${(error as Error).message}`);
    return 1;
  }
  const parsed = parseEvalRun(raw);
  if (!parsed.ok) {
    printError(json, `evals record: ${parsed.error}`);
    return 1;
  }

  const overlay = await readOverlay(studioHome, alias);
  const fit = fitEvalRun(overlay.ir, parsed.run);
  if (!fit.ok) {
    printError(json, `evals record: "${alias}" — ${fit.error}`);
    return 1;
  }
  const { unknown, missing } = fit;

  const file = await writeEvalRun(studioHome, alias, parsed.run);
  const score = scoreEvalRun(parsed.run);

  printResult(
    json,
    { ok: true, project: alias, file, irVersion: parsed.run.irVersion, score, unknown, missing },
    [
      `평가 결과 — ${alias} · v${parsed.run.irVersion}`,
      "",
      `  결정적: 통과 ${score.passed} · 실패 ${score.failed} · 건너뜀 ${score.skipped} / ${score.total}`,
      `  모델 채점: ${score.meanScore === null ? "없음" : `평균 ${score.meanScore} (${score.scored}건)`}`,
      ...(unknown.length ? [`  ⚠ 설계에 없는 평가 ${unknown.length}개: ${unknown.join(" · ")}`] : []),
      ...(missing.length ? [`  ⚠ 결과가 없는 평가 ${missing.length}개: ${missing.join(" · ")}`] : []),
      "",
      `  ${file}`,
    ],
  );
  return 0;
}

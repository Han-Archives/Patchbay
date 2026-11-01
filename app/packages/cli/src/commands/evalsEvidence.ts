import { readOverlay, readStudio, resolveProjectAlias, resolveStudioHome, writeEvalEvidence } from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface EvalsEvidenceCommandOptions {
  project?: string;
  eval?: string;
  how?: string;
  observed?: string;
  file?: string[];
  screen?: string;
  json?: boolean;
}

/**
 * `patchbay evals evidence --project <alias> --eval <id> --how … --observed … --file a.png --file b.txt [--screen test]`
 *
 * Files what was done and seen when an eval ran, with screenshots or output, so
 * the person scoring it in the Review screen looks at the evaluated thing itself
 * (사용자 결정 2026-10-31). Filed against the approved design; an eval id the
 * design lacks is refused -- evidence nobody can find is no evidence.
 */
export async function runEvalsEvidence(
  options: EvalsEvidenceCommandOptions,
  studioHome: string = resolveStudioHome(),
): Promise<number> {
  const json = Boolean(options.json);
  if (!options.eval) {
    printError(json, "evals evidence: --eval <평가 id> 가 필요하다.");
    return 1;
  }
  const resolution = resolveProjectAlias(await readStudio(studioHome), options.project);
  if (!resolution.ok) {
    printError(json, resolution.message);
    return 1;
  }
  const alias = resolution.alias;
  const overlay = await readOverlay(studioHome, alias);
  if (!overlay.ir) {
    printError(json, `evals evidence: "${alias}" 에 승인된 설계가 없다.`);
    return 1;
  }
  if (!overlay.ir.evals.some((entry) => entry.id === options.eval)) {
    printError(json, `evals evidence: 승인된 설계 v${overlay.ir.version} 에 평가 ${options.eval} 가 없다.`);
    return 1;
  }
  const written = await writeEvalEvidence(studioHome, alias, {
    evalId: options.eval,
    irVersion: overlay.ir.version,
    ...(options.how !== undefined ? { how: options.how } : {}),
    ...(options.observed !== undefined ? { observed: options.observed } : {}),
    files: options.file ?? [],
    ...(options.screen ? { screen: options.screen } : {}),
  });
  if (!written.ok) {
    printError(json, `evals evidence: ${written.error}`);
    return 1;
  }
  printResult(json, { ok: true, project: alias, evidence: written.evidence, dir: written.dir }, [
    `평가 근거 — ${alias} · v${overlay.ir.version} · ${options.eval}`,
    `  첨부 ${written.evidence.files.length}개${written.evidence.screen ? ` · 화면 ${written.evidence.screen}` : ""}`,
    `  ${written.dir}`,
  ]);
  return 0;
}

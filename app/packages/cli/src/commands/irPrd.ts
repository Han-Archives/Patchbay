import { loadPrd, prdToText, readStudio, resolveProjectAlias, resolveStudioHome } from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface IrPrdCommandOptions {
  project?: string;
  json?: boolean;
}

/**
 * `patchbay ir prd [--project <alias>] [--json]`
 *
 * 초안(`ir.proposed.yaml`)을 PRD 11절로 그린다 (명세 20261006a §14). 모델 없이, 같은 초안이면 같은 글이다.
 * 줄마다 출처(말함 · 해석 · 기본값 · 직접)가 붙는다. 읽기만 한다.
 */
export async function runIrPrd(options: IrPrdCommandOptions, studioHome: string = resolveStudioHome()): Promise<number> {
  const json = Boolean(options.json);
  const resolution = resolveProjectAlias(await readStudio(studioHome), options.project);
  if (!resolution.ok) {
    printError(json, resolution.message);
    return 1;
  }
  const result = await loadPrd(studioHome, resolution.alias);
  if (!result.ok) {
    printError(json, `ir prd: ${result.error}\n  초안이 아직 없다 — 콘솔 1 설계에서 상담을 시작하거나 설문을 쓴다.`);
    return 1;
  }
  const { sections, review, progress } = result;
  const ok = review.sections.filter((s) => s.state === "ok").length;
  printResult(json, { project: resolution.alias, sections, review, progress }, [
    `PRD — ${resolution.alias} · 초안`,
    `확인 ${ok} / ${sections.length}절 · 다음 상담 주제: ${progress.next ?? "없음 — PRD 검토로"}`,
    "",
    ...prdToText(sections, review),
  ]);
  return 0;
}

import {
  compareVersions,
  readCurrentEvalRun,
  readOverlay,
  readRunRecords,
  readVersionHistory,
  resolveProjectAlias,
  resolveStudioHome,
  readStudio,
  scoreEvalRun,
  type VersionRecord,
  type VersionSide,
} from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface VersionCompareCommandOptions {
  project?: string;
  before?: string;
  after?: string;
  json?: boolean;
}

function sideLines(label: string, side: VersionSide): string[] {
  const score = side.score;
  const cost = side.usage.costUsd === null ? "보고 없음" : `$${side.usage.costUsd}`;
  return [
    `  ${label} v${side.version}`,
    `      모델: ${side.models.join(" · ") || "없음"}`,
    score
      ? `      평가: 통과 ${score.passed}/${score.total}` +
        (score.meanScore === null ? "" : ` · 모델 채점 평균 ${score.meanScore}`)
      : "      평가: 결과 없음",
    `      실행: ${side.usage.runs}건 · 토큰 ${side.usage.tokens} · 비용 ${cost}`,
  ];
}

/**
 * `patchbay version compare --project <alias> [--before <n> --after <n>]`
 *
 * V.3 · V.4 — v(n)과 v(n+1)을 나란히. Defaults to the newest archived version
 * against the design in force, which is the comparison a person actually wants
 * after an adopt.
 *
 * Refuses when the eval set moved (명세 §6.2). Score and cost travel together
 * because swapping a model is only judgeable as a pair — a version that scores
 * better on triple the spend is not obviously better.
 */
export async function runVersionCompare(
  options: VersionCompareCommandOptions,
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
  const currentRead = await readCurrentEvalRun(studioHome, alias);
  const history = await readVersionHistory(
    studioHome,
    alias,
    overlay.ir ?? null,
    currentRead.ok ? scoreEvalRun(currentRead.run) : null,
  );
  const all: VersionRecord[] = [...history.archived, ...(history.current ? [history.current] : [])];
  if (all.length < 2) {
    printError(
      json,
      `version compare: "${alias}" 에 비교할 버전이 ${all.length}개뿐이다 — ` +
        `설계를 한 번 더 채택하면(patchbay ir adopt) v(n)이 versions/ 로 보관된다.`,
    );
    return 1;
  }

  const pick = (want: string | undefined, fallback: VersionRecord): VersionRecord | null => {
    if (want === undefined) return fallback;
    const found = all.find((record) => record.version === Number(want));
    return found ?? null;
  };
  const before = pick(options.before, all[all.length - 2]!);
  const after = pick(options.after, all[all.length - 1]!);
  if (!before || !after) {
    printError(
      json,
      `version compare: 그런 버전이 없다 — 있는 것: ${all.map((record) => `v${record.version}`).join(" · ")}`,
    );
    return 1;
  }

  const { records } = await readRunRecords(studioHome, alias);
  const result = compareVersions(before, after, records);
  const lines = [`버전 비교 — ${alias}`, ""];
  lines.push(...sideLines("전", result.before), "", ...sideLines("후", result.after), "");
  if (result.ok) {
    if (result.modelChanged) {
      lines.push("  모델이 바뀌었다 — 위의 점수와 비용을 함께 본다 (V.4).");
    }
    const delta = (result.after.score?.passed ?? 0) - (result.before.score?.passed ?? 0);
    lines.push(`  같은 평가 묶음이다. 통과 개수 ${delta >= 0 ? `+${delta}` : delta}.`);
  } else {
    lines.push(`  ⚠ 나란히 놓지 않는다 — ${result.reason}`);
  }
  for (const note of [...before.notes, ...after.notes]) lines.push(`  · ${note}`);

  printResult(json, { ok: true, project: alias, comparable: result.ok, result }, lines);
  return result.ok ? 0 : 1;
}

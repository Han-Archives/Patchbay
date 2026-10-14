import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { parseIr, type Ir } from "../types/ir.js";
import { projectStudioDir } from "../studio/studioStore.js";
import { VERSIONS_DIR_NAME } from "../studio/irStore.js";
import { EVALS_FILE_NAME, readEvalRunFile, scoreEvalRun, type EvalScore } from "./evals.js";
import type { RunRecord } from "./types.js";

/**
 * V.1~V.4 -- 보관된 버전을 읽고, v(n)과 v(n+1)을 나란히 놓는다.
 *
 * `versions/<n>/` is written by `ir adopt` right before it replaces the design,
 * and never touched again (원칙 16 — 삭제 대신 보관). This module only reads it.
 */

export interface VersionRecord {
  version: number;
  dir: string;
  /** The archived design. Null when the folder holds no readable `ir.yaml`. */
  ir: Ir | null;
  /** That version's eval results, if they were recorded before it was replaced. */
  score: EvalScore | null;
  /** Model ids the design declared -- V.4 needs「모델을 바꾸면」to be visible. */
  models: string[];
  /** Why a field above is null. Never left to the reader to guess. */
  notes: string[];
}

/** Every archived version, oldest first, plus the design in force now. */
export interface VersionHistory {
  archived: VersionRecord[];
  current: VersionRecord | null;
}

export async function readVersionHistory(
  studioHome: string,
  alias: string,
  currentIr: Ir | null,
  currentScore: EvalScore | null,
): Promise<VersionHistory> {
  const root = path.join(projectStudioDir(studioHome, alias), VERSIONS_DIR_NAME);
  let names: string[] = [];
  try {
    names = await fs.readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const archived: VersionRecord[] = [];
  for (const name of names) {
    const version = Number(name);
    if (!Number.isInteger(version) || version <= 0) continue;
    const dir = path.join(root, name);
    const notes: string[] = [];

    let ir: Ir | null = null;
    try {
      const parsed = parseIr(YAML.parse(await fs.readFile(path.join(dir, "ir.yaml"), "utf8")));
      if (parsed.ok) ir = parsed.ir;
      else notes.push(`ir.yaml 을 읽지 못했다 — ${parsed.error.split("\n")[0]}`);
    } catch {
      notes.push("ir.yaml 이 없다");
    }

    let score: EvalScore | null = null;
    const read = await readEvalRunFile(path.join(dir, EVALS_FILE_NAME));
    if (read.ok) score = scoreEvalRun(read.run);
    else notes.push(read.missing ? "평가 결과가 보관되지 않았다" : read.error.split("\n")[0]!);

    archived.push({ version, dir, ir, score, models: ir ? ir.models.map((model) => model.id) : [], notes });
  }
  archived.sort((a, b) => a.version - b.version);

  const current: VersionRecord | null = currentIr
    ? {
        version: currentIr.version,
        dir: projectStudioDir(studioHome, alias),
        ir: currentIr,
        score: currentScore,
        models: currentIr.models.map((model) => model.id),
        notes: currentScore ? [] : ["평가 결과가 아직 없다"],
      }
    : null;

  return { archived, current };
}

export interface VersionSide {
  version: number;
  score: EvalScore | null;
  models: string[];
  /** Cost and tokens of the run records that carry this `irVersion`. */
  usage: { runs: number; tokens: number; costUsd: number | null };
}

export type CompareVersionsResult =
  | { ok: true; before: VersionSide; after: VersionSide; modelChanged: boolean; sameEvalSet: true }
  | { ok: false; reason: string; before: VersionSide; after: VersionSide };

/**
 * Puts two versions side by side.
 *
 * **Refuses when the eval set differs** (명세 §6.2): 「v(n)과 v(n+1)은 같은 평가
 * 묶음으로만 비교한다. 평가가 바뀌었으면 점수를 나란히 놓지 않는다.」 A score that
 * moved because the questions changed is not an improvement, and printing the two
 * numbers together is the exact way that mistake gets made.
 *
 * Cost travels with the score because V.4 asks for both: swapping a model is only
 * judgeable as a pair.
 */
export function compareVersions(
  before: VersionRecord,
  after: VersionRecord,
  records: readonly RunRecord[],
): CompareVersionsResult {
  const sideOf = (record: VersionRecord): VersionSide => ({
    version: record.version,
    score: record.score,
    models: record.models,
    usage: usageFor(record.version, records),
  });
  const a = sideOf(before);
  const b = sideOf(after);

  if (!before.score || !after.score) {
    const which = !before.score ? `v${before.version}` : `v${after.version}`;
    return { ok: false, reason: `${which} 의 평가 결과가 없다 — 점수를 나란히 놓을 수 없다.`, before: a, after: b };
  }
  const left = before.score.ids.join("|");
  const right = after.score.ids.join("|");
  if (left !== right) {
    const added = after.score.ids.filter((id) => !before.score!.ids.includes(id));
    const removed = before.score.ids.filter((id) => !after.score!.ids.includes(id));
    const parts = [
      added.length ? `늘어난 평가: ${added.join(" · ")}` : "",
      removed.length ? `빠진 평가: ${removed.join(" · ")}` : "",
    ].filter(Boolean);
    return {
      ok: false,
      reason: `평가 묶음이 다르다 — 같은 묶음이 아니면 점수를 나란히 놓지 않는다. ${parts.join(" / ")}`,
      before: a,
      after: b,
    };
  }

  return {
    ok: true,
    before: a,
    after: b,
    modelChanged: before.models.join("|") !== after.models.join("|"),
    sameEvalSet: true,
  };
}

function usageFor(version: number, records: readonly RunRecord[]): VersionSide["usage"] {
  let runs = 0;
  let tokens = 0;
  let costUsd = 0;
  let costSeen = 0;
  for (const record of records) {
    if (record.irVersion !== version) continue;
    runs += 1;
    tokens += record.usage.inputTokens + record.usage.outputTokens;
    if (record.usage.costUsd !== undefined) {
      costUsd += record.usage.costUsd;
      costSeen += 1;
    }
  }
  return { runs, tokens, costUsd: costSeen > 0 ? Number(costUsd.toFixed(6)) : null };
}

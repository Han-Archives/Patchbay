import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { parseIr, type Ir, type IrEval } from "../types/ir.js";
import { runIrChecks, summarizeIrChecks, type IrCheckSummary } from "../ir/checks.js";
import { readOverlay, setOverlayIr } from "./projectFiles.js";
import { projectStudioDir } from "./studioStore.js";
import { EVALS_FILE_NAME, currentEvalsPath } from "../runs/evals.js";
import { renderIrSkeleton } from "../ir/draft.js";
import { APPROVED_PROVENANCE_FILE_NAME, readProvenance } from "../ir/consult/provenance.js";

/**
 * Reading the IR files. Lives in Core, not in the CLI, so the CLI, MCP and the
 * console all see the same bytes through the same parser (기획서 원칙 8) --
 * and so only one module knows where these files sit.
 *
 * Nothing here writes. `overlay.ir` has exactly one write path (`ir adopt`,
 * 명세 §2.3); a reader that could also write would make the gate optional.
 */

/** The host model's draft. Freely regenerated; never the approved design. */
export const PROPOSED_IR_FILE_NAME = "ir.proposed.yaml";

export type ReadIrResult = { ok: true; raw: unknown; file: string } | { ok: false; error: string; file: string };

async function readYamlFile(file: string): Promise<ReadIrResult> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      ok: false,
      file,
      error: code === "ENOENT" ? `${file} 가 없다.` : `${file} 를 읽지 못했다 — ${(error as Error).message}`,
    };
  }
  try {
    return { ok: true, raw: YAML.parse(text), file };
  } catch (error) {
    // YAML 오류는 그대로 넘긴다. 줄·열이 붙어 있어 사람이 고칠 수 있다.
    return { ok: false, file, error: `${file} 의 YAML이 깨졌다 — ${(error as Error).message}` };
  }
}

/** Reads `ir.proposed.yaml` for `alias`. */
export function readProposedIr(studioHome: string, alias: string): Promise<ReadIrResult> {
  return readYamlFile(path.join(projectStudioDir(studioHome, alias), PROPOSED_IR_FILE_NAME));
}

/**
 * The draft as an `Ir`, or `undefined` when there is none or it does not parse.
 * For readers that only need to *avoid* what the draft already holds (eval ids,
 * failure cases) -- a broken draft is reported by the 설계 screen, not here.
 */
export async function readProposedIrIfValid(studioHome: string, alias: string): Promise<Ir | undefined> {
  const read = await readProposedIr(studioHome, alias);
  if (!read.ok) return undefined;
  const parsed = parseIr(read.raw);
  return parsed.ok ? parsed.ir : undefined;
}

/** Reads an IR from any path -- for checking a file before it is anywhere near the studio. */
export function readIrFile(file: string): Promise<ReadIrResult> {
  return readYamlFile(path.resolve(file));
}

/** Where v(n)'s design and its evaluation results are kept. Never deleted (기획서 원칙 16). */
export const VERSIONS_DIR_NAME = "versions";

export type StartIrDraftResult =
  | { ok: true; file: string; project: string }
  | { ok: false; error: string; file: string };

/**
 * 1단계를 시작한다 — 빈 골격 `ir.proposed.yaml` 을 만든다.
 *
 * **있는 초안을 덮지 않는다.** 초안은 사람과 호스트 모델이 쓴 저작물이고, 「시작」
 * 버튼이 그것을 지울 수 있으면 한 번의 오조작으로 1단계가 통째로 날아간다.
 * 이미 있으면 거절하고, 다시 시작하려면 사람이 그 파일을 치운 뒤에 부른다.
 *
 * 골격은 값을 지어내지 않는다 (`renderIrSkeleton`) — 그래서 `parseIr` 를 통과하지
 * 않는다. 통과해야 하는 것은 다 채운 뒤다.
 */
export async function startIrDraft(
  studioHome: string,
  alias: string,
  options: { project?: string; graph?: string } = {},
): Promise<StartIrDraftResult> {
  const file = path.join(projectStudioDir(studioHome, alias), PROPOSED_IR_FILE_NAME);
  try {
    await fs.access(file);
    return {
      ok: false,
      file,
      error: `이미 초안이 있다 — 덮지 않는다. 다시 시작하려면 ${PROPOSED_IR_FILE_NAME} 를 먼저 치운다.`,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const project = options.project ?? alias;
  await fs.mkdir(path.dirname(file), { recursive: true });
  // `wx` — 위 검사와 쓰기 사이에 누가 만들었으면 여기서 막힌다.
  await fs.writeFile(file, renderIrSkeleton(project, options.graph ?? ""), { encoding: "utf8", flag: "wx" });
  return { ok: true, file, project };
}

export type AppendProposedEvalsResult =
  | { ok: true; file: string; added: string[]; startedFrom: "draft" | "approved"; unlinked: string[] }
  | { ok: false; error: string };

/**
 * 5.4 -- adds drafted evaluation cases to **`ir.proposed.yaml` only**.
 *
 * This is the one write a failing run may cause, and it lands on the draft, not
 * the design: `overlay.ir` has exactly one write path (`ir adopt`, 명세 §2.3), so
 * a run cannot change what was approved. `ir diff` then shows a person exactly
 * which evals appeared before they decide.
 *
 * With no draft on disk it starts from the approved IR -- a draft that began
 * empty would read as「설계를 다 지우고 평가 둘만 남긴다」in the diff.
 *
 * The blank traceability rows are **not** written into `requirementLinks[]`:
 * that array's `requirement` is a required string (§3.7), and a row with a null
 * requirement is not a valid IR. They come back in `unlinked` and go into the
 * file as a comment, for the person to fill.
 */
export async function appendProposedEvals(
  studioHome: string,
  alias: string,
  evals: readonly IrEval[],
  unlinked: readonly { node: string; eval: string }[] = [],
): Promise<AppendProposedEvalsResult> {
  if (evals.length === 0) return { ok: false, error: "추가할 평가 초안이 없다." };

  const file = path.join(projectStudioDir(studioHome, alias), PROPOSED_IR_FILE_NAME);
  const draft = await readProposedIr(studioHome, alias);
  let base: Ir;
  let startedFrom: "draft" | "approved";
  if (draft.ok) {
    const parsed = parseIr(draft.raw);
    if (!parsed.ok) return { ok: false, error: `초안을 읽지 못했다 — ${parsed.error}` };
    base = parsed.ir;
    startedFrom = "draft";
  } else {
    const overlay = await readOverlay(studioHome, alias);
    if (!overlay.ir) {
      return { ok: false, error: `"${alias}" 에 초안도 승인된 설계도 없다 — 1단계를 먼저 통과한다.` };
    }
    base = overlay.ir;
    startedFrom = "approved";
  }

  const taken = new Set(base.evals.map((entry) => entry.id));
  const fresh = evals.filter((entry) => !taken.has(entry.id));
  if (fresh.length === 0) {
    return { ok: false, error: `초안에 이미 ${evals.map((entry) => entry.id).join(" · ")} 가 있다.` };
  }

  const next: Ir = { ...base, evals: [...base.evals, ...fresh] };
  const rows = unlinked.filter((row) => fresh.some((entry) => entry.id === row.eval));
  const comment = rows.length
    ? `\n# 채울 추적 표 행 — 요구사항은 사람이 정한다 (런타임은 요구사항을 모른다):\n` +
      rows.map((row) => `#   - { requirement: ?, node: ${row.node}, eval: ${row.eval} }`).join("\n") +
      "\n"
    : "";
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, YAML.stringify(next) + comment, "utf8");
  return { ok: true, file, added: fresh.map((entry) => entry.id), startedFrom, unlinked: rows.map((row) => row.eval) };
}

export type AdoptIrResult =
  | { ok: true; version: number; previousVersion: number | null; archived: string | null }
  | { ok: false; error: string; checks?: IrCheckSummary };

/**
 * Adopts `ir.proposed.yaml` as the project's approved IR (명세 §2.3).
 *
 * The order is the point: **check, archive, then replace.** A failing design
 * is refused outright -- there is no `--force`, because a gate that can be
 * stepped around is the same as no gate -- and if archiving the outgoing
 * version fails, nothing is replaced, so v(n) is never lost to make room for
 * v(n+1).
 *
 * The draft is left exactly as it was: it is a proposal (원칙 6), and a tool
 * that consumed its own input would leave nothing to compare against.
 */
export async function adoptIr(
  studioHome: string,
  alias: string,
  options: { docRoot?: string } = {},
): Promise<AdoptIrResult> {
  const read = await readProposedIr(studioHome, alias);
  if (!read.ok) return { ok: false, error: read.error };

  const parsed = parseIr(read.raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const checks = summarizeIrChecks(runIrChecks(parsed.ir, { docRoot: options.docRoot }));
  if (!checks.passed) {
    return {
      ok: false,
      error:
        `설계 규칙 검사를 통과하지 못했다 — 돌아갈 칸: ${checks.failedGates.join(" · ")}` +
        (checks.invalidated.length ? ` (같이 무효: ${checks.invalidated.join(" · ")})` : ""),
      checks,
    };
  }

  const overlay = await readOverlay(studioHome, alias);
  const current = overlay.ir ?? null;

  /**
   * The kernel owns the iteration counter, not the draft. A draft is a
   * proposal and two of them can each claim to be "v2"; what actually became
   * v2 is a fact recorded at adoption.
   */
  const nextVersion = (current?.version ?? 0) + 1;

  let archived: string | null = null;
  if (current) {
    const dir = path.join(projectStudioDir(studioHome, alias), VERSIONS_DIR_NAME, String(current.version));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "ir.yaml"), YAML.stringify(current), "utf8");
    /**
     * V.1 -- the outgoing version's eval results go with it (명세 §6.2). Copied,
     * not moved: the file is the project's current results until the next run
     * replaces it, and a move would leave the live path empty on the way out.
     * Missing results are recorded as missing, never as zero -- a version whose
     * evals were never run must not read as a version that scored nothing.
     */
    let evals: string | null = null;
    try {
      await fs.copyFile(currentEvalsPath(studioHome, alias), path.join(dir, EVALS_FILE_NAME));
      evals = EVALS_FILE_NAME;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await fs.writeFile(
      path.join(dir, "adopted.json"),
      JSON.stringify(
        {
          archivedAt: new Date().toISOString(),
          version: current.version,
          replacedBy: nextVersion,
          drcPassed: true,
          evals,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    archived = dir;
    try { await fs.copyFile(path.join(projectStudioDir(studioHome, alias), APPROVED_PROVENANCE_FILE_NAME), path.join(dir, APPROVED_PROVENANCE_FILE_NAME)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }

  const adopted: Ir = { ...parsed.ir, version: nextVersion };
  await fs.writeFile(path.join(projectStudioDir(studioHome, alias), APPROVED_PROVENANCE_FILE_NAME), JSON.stringify({ version: nextVersion, provenance: await readProvenance(studioHome, alias) }, null, 2) + "\n", "utf8");
  await setOverlayIr(studioHome, alias, adopted);
  return { ok: true, version: nextVersion, previousVersion: current?.version ?? null, archived };
}

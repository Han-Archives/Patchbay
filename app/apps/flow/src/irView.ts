import fs from "node:fs/promises";
import path from "node:path";
import {
  adoptIr,
  diffIr,
  draftProgress,
  IR_CELL_FIELDS,
  IR_CELL_GUIDES,
  patchDraftCell,
  gateCells,
  parseIr,
  readOverlay,
  PROPOSED_IR_FILE_NAME,
  projectStudioDir,
  readProposedIr,
  readStudio,
  startIrDraft,
  runIrChecks,
  summarizeIrChecks,
  type Ir,
  loadPrd,
  loadRequirementWorkspace,
} from "@patchbay/core";
import type {
  IrAdoptResponse,
  IrSaveCellResponse,
  IrSource,
  IrStartDraftResponse,
  IrViewResponse,
} from "./irContract.js";

export type LoadIrResult = { ok: true; body: IrViewResponse } | { ok: false; status: 400 | 404; error: string };

/**
 * The 설계 segment's data (명세 20260929a · 기획서 §2의 10칸).
 *
 * Reads both files and never merges them: `overlay.ir` is what was approved
 * and `ir.proposed.yaml` is what is being proposed, and the whole point of the
 * screen is to see one against the other before a person adopts.
 *
 * Document paths are resolved against the project's repo, so 1.6's two
 * filesystem checks judge real files instead of being skipped.
 */
export async function loadIrView(
  studioHome: string,
  alias: string | undefined,
  wanted?: string,
): Promise<LoadIrResult> {
  if (!alias?.trim()) return { ok: false, status: 400, error: "ir: alias is required." };

  const studio = await readStudio(studioHome);
  const project = studio.projects.find((entry) => entry.alias === alias);
  if (!project) return { ok: false, status: 404, error: `ir: "${alias}" is not a registered project.` };

  const overlay = await readOverlay(studioHome, alias);
  const proposedRead = await readProposedIr(studioHome, alias);
  const hasCurrent = Boolean(overlay.ir);
  const hasProposed = proposedRead.ok;

  if (!hasCurrent && !hasProposed) {
    return { ok: true, body: { status: "missing", alias, hasCurrent: false, hasProposed: false, canStart: true } };
  }

  // 초안이 있으면 초안을 먼저 보여 준다 — 사람이 이 화면에 오는 이유가 그것이다.
  const source: IrSource = wanted === "current" || !hasProposed ? "current" : "proposed";
  const raw = source === "proposed" ? (proposedRead.ok ? proposedRead.raw : null) : overlay.ir;

  const parsed = parseIr(raw);
  if (!parsed.ok) {
    /**
     * 초안이 아직 IR로 안 읽히는 것은 **1단계 중의 정상 상태**다 — 열 칸을 채우는
     * 동안 계속 그렇다. 그때 오류 한 덩어리만 돌려주면 화면이 「다음에 뭘 하라」를
     * 말하지 못한다. 그래서 칸별 진행을 함께 준다.
     *
     * 승인된 `overlay.ir` 이 안 읽히는 것은 다른 일이다 — 그건 통과했던 것이
     * 깨진 것이므로 `broken` 으로 남긴다.
     */
    if (source === "proposed") {
      return {
        ok: true,
        body: {
          status: "drafting",
          alias,
          source,
          hasCurrent,
          hasProposed,
          error: parsed.error,
          progress: draftProgress(raw),
          // 칸의 모양은 커널이 기술한다 — 화면은 그리기만 한다 (원칙 8).
          fields: IR_CELL_FIELDS,
          guides: IR_CELL_GUIDES,
          doc: raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {},
          file: path.join(projectStudioDir(studioHome, alias), PROPOSED_IR_FILE_NAME),
        },
      };
    }
    return { ok: true, body: { status: "broken", alias, source, error: parsed.error, hasCurrent, hasProposed } };
  }

  const ir: Ir = parsed.ir;
  const summary = summarizeIrChecks(runIrChecks(ir, { docRoot: project.path }));
  const gates = gateCells(summary);

  let diff = null;
  const currentParsed = overlay.ir ? parseIr(overlay.ir) : null;
  if (source === "proposed" && currentParsed?.ok) diff = diffIr(currentParsed.ir, ir);

  const canAdopt = source === "proposed" && hasProposed && summary.passed;
  const adoptBlockedBy = canAdopt
    ? null
    : source !== "proposed"
      ? "승인된 IR을 보고 있다. 채택은 초안에서 한다."
      : !summary.passed
        ? `검사가 막는다 — 돌아갈 칸: ${summary.failedGates.join(" · ")}`
        : "초안이 없다.";

  return {
    ok: true,
    body: {
      status: "ready",
      alias,
      source,
      hasCurrent,
      hasProposed,
      currentVersion: currentParsed?.ok ? currentParsed.ir.version : null,
      ir,
      checks: summary.checks,
      gates,
      passed: summary.passed,
      failedGates: summary.failedGates,
      invalidated: summary.invalidated,
      diff,
      canAdopt,
      adoptBlockedBy,
      fields: IR_CELL_FIELDS,
      guides: IR_CELL_GUIDES,
    },
  };
}

export type AdoptResult = { ok: true; body: IrAdoptResponse } | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * The 채택 button. Delegates to Core's `adoptIr` -- the console does not get
 * its own write path (기획서 원칙 8), so the gate, the archive and the ordering
 * are the same whether a person clicks here or types `patchbay ir adopt`.
 */
export async function adoptIrView(studioHome: string, input: { alias?: unknown }): Promise<AdoptResult> {
  const alias = typeof input.alias === "string" ? input.alias.trim() : "";
  if (!alias) return { ok: false, status: 400, error: "ir adopt: alias is required." };

  const studio = await readStudio(studioHome);
  const project = studio.projects.find((entry) => entry.alias === alias);
  if (!project) return { ok: false, status: 404, error: `ir adopt: "${alias}" is not a registered project.` };

  // 화면의 채택은 PRD 11절이 모두 「맞아요」일 때만 (명세 20261006a §14.2). CLI `ir adopt` 는 경고만 한다 —
  // CLI를 쓰는 사람은 이미 사람이다. 검토한 글과 채택되는 설계가 같다는 것이 이 문의 뜻이다.
  const requirements = await loadRequirementWorkspace(studioHome, alias);
  if (requirements.rows.some(r => r.events.length)) {
    const pending = requirements.rows.filter(r => r.change !== "same" && r.decision !== "approved");
    if (pending.length) return { ok: false, status: 409, error: "요구사항 검토가 남아 있습니다: " + pending.map(r => r.id).join(" · ") };
  }
  const prd = await loadPrd(studioHome, alias);
  if (prd.ok && !prd.review.allOk) {
    const waiting = prd.review.sections.filter((s) => s.state !== "ok").map((s) => s.n);
    return {
      ok: false,
      status: 409,
      error: `PRD 검토가 덜 됐다 — ${waiting.join(" · ")}절이 아직 「맞아요」가 아니다. PRD 검토 탭에서 확인한다.`,
    };
  }
  const result = await adoptIr(studioHome, alias, { docRoot: project.path });
  if (!result.ok) return { ok: false, status: 409, error: result.error };
  return {
    ok: true,
    body: { ok: true, version: result.version, previousVersion: result.previousVersion, archived: result.archived },
  };
}

export type StartDraftResult =
  | { ok: true; body: IrStartDraftResponse }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * 1단계 시작 — 빈 골격 초안을 만든다.
 *
 * 콘솔이 자기 쓰기 경로를 갖지 않는다 (원칙 8): Core의 `startIrDraft` 를 그대로
 * 부르므로 CLI로 하든 여기서 하든 같은 바이트가 나온다. 있는 초안은 덮지 않는다 —
 * 그 판단도 Core에 있다.
 */
export async function startDraftView(
  studioHome: string,
  payload: Record<string, unknown>,
): Promise<StartDraftResult> {
  const alias = typeof payload.alias === "string" ? payload.alias.trim() : "";
  if (!alias) return { ok: false, status: 400, error: "ir draft: alias 가 필요하다." };

  const studio = await readStudio(studioHome);
  const project = studio.projects.find((entry) => entry.alias === alias);
  if (!project) return { ok: false, status: 404, error: `ir draft: "${alias}" 는 등록된 프로젝트가 아니다.` };

  const graph = typeof payload.graph === "string" ? payload.graph.trim() : "";
  const result = await startIrDraft(studioHome, alias, { project: alias, graph });
  if (!result.ok) return { ok: false, status: 409, error: result.error };
  return { ok: true, body: { ok: true, file: result.file } };
}

export type SaveCellResult =
  | { ok: true; body: IrSaveCellResponse }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * 칸 하나를 초안에 쓴다.
 *
 * **판정하지 않는다** — 1단계 중에는 불완전한 것이 정상이라, 여기서 DRC를 돌려
 * 막으면 사람이 초안을 쓰다 말고 거절당한다. 모양만 맞추고 판정은 1.9가 한다.
 * 쓴 뒤의 칸별 진행을 함께 돌려주므로 화면이 한 번 더 읽지 않아도 된다.
 */
export async function saveCellView(
  studioHome: string,
  payload: Record<string, unknown>,
): Promise<SaveCellResult> {
  const alias = typeof payload.alias === "string" ? payload.alias.trim() : "";
  const cell = typeof payload.cell === "string" ? payload.cell.trim() : "";
  const values = payload.values;
  if (!alias) return { ok: false, status: 400, error: "ir cell: alias 가 필요하다." };
  if (!cell) return { ok: false, status: 400, error: "ir cell: cell 이 필요하다." };
  if (values === null || typeof values !== "object" || Array.isArray(values)) {
    return { ok: false, status: 400, error: "ir cell: values 가 객체여야 한다." };
  }

  const studio = await readStudio(studioHome);
  if (!studio.projects.some((entry) => entry.alias === alias)) {
    return { ok: false, status: 404, error: `ir cell: "${alias}" 는 등록된 프로젝트가 아니다.` };
  }

  const file = path.join(projectStudioDir(studioHome, alias), PROPOSED_IR_FILE_NAME);
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, status: 404, error: "ir cell: 초안이 없다 — 1단계를 먼저 시작한다." };
    }
    throw error;
  }

  const patched = patchDraftCell(text, cell, values as Record<string, unknown>);
  if (!patched.ok) return { ok: false, status: 409, error: patched.error };

  await fs.writeFile(file, patched.text, "utf8");
  return { ok: true, body: { ok: true, progress: patched.progress } };
}

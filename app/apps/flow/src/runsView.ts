import {
  appendProposedEvals,
  checkBudget,
  compareRunsToDesign,
  draftEvalsFromRuns,
  draftsAsIrEvals,
  readCurrentEvalRun,
  readProposedIrIfValid,
  readOverlay,
  readRunRecords,
  readStudio,
  readVersionHistory,
  compareVersions,
  scoreEvalRun,
} from "@patchbay/core";
import type { RunsViewResponse } from "./runsContract.js";

export type LoadRunsResult =
  | { ok: true; body: RunsViewResponse }
  | { ok: false; status: 400 | 404; error: string };

/**
 * 5단계 운영 — 한 번 읽어 네 가지를 답한다: 무엇이 수집됐나(상태별), 설계와
 * 어긋난 것(5.3), 한도를 넘긴 실행(5.6), 그리고 버전이 둘 이상이면 v(n)↔v(n+1).
 *
 * Computed by Core from the project's own files, like the impact radius and the
 * document call: LangGraph is where runs *come from*, not where they are kept
 * (원칙 7 — 파일이 원본).
 */
export async function loadRunsView(studioHome: string, alias: string | undefined): Promise<LoadRunsResult> {
  if (!alias) return { ok: false, status: 400, error: "runs: alias query parameter is required." };

  const studio = await readStudio(studioHome);
  const registered = studio.projects.find((project) => project.alias === alias);
  if (!registered) {
    const known = studio.projects.map((project) => project.alias);
    return {
      ok: false,
      status: 404,
      error:
        `No project registered with alias "${alias}". ` +
        (known.length > 0
          ? `Registered aliases: ${known.join(", ")}.`
          : `No projects are registered yet -- run "patchbay project add --path <path>" first.`),
    };
  }

  const overlay = await readOverlay(studioHome, alias);
  const { records, rejected } = await readRunRecords(studioHome, alias);
  if (!overlay.ir) {
    // 설계가 없으면 대조할 기준이 없다. 기록 개수는 그래도 말해 준다.
    return {
      ok: true,
      body: { status: "no-design", alias, collected: records.length, rejected: rejected.length },
    };
  }

  const compare = compareRunsToDesign(overlay.ir, records);
  const budget = checkBudget(overlay.budget, records);
  const drafts = draftEvalsFromRuns(overlay.ir, records, { draft: await readProposedIrIfValid(studioHome, alias) });

  const currentRead = await readCurrentEvalRun(studioHome, alias);
  const currentScore = currentRead.ok ? scoreEvalRun(currentRead.run) : null;
  const history = await readVersionHistory(studioHome, alias, overlay.ir, currentScore);
  const all = [...history.archived, ...(history.current ? [history.current] : [])];
  const versions = all.map((record) => ({
    version: record.version,
    models: record.models,
    score: record.score,
    notes: record.notes,
  }));
  const pair =
    all.length >= 2 ? compareVersions(all[all.length - 2]!, all[all.length - 1]!, records) : null;

  return {
    ok: true,
    body: {
      status: "ok",
      alias,
      irVersion: overlay.ir.version,
      compare,
      budget,
      drafts: {
        count: drafts.draftEvals.length,
        ids: drafts.draftEvals.map((draft) => draft.id),
        unfilled: drafts.unfilled,
        skipped: drafts.skipped.length,
        inDraft: drafts.draftEvals.filter((draft) => draft.inDraft).map((draft) => draft.id),
      },
      versions,
      pair,
      rejected,
    },
  };
}

export type WriteDraftEvalsResult =
  | {
      ok: true;
      body: { added: string[]; startedFrom: "draft" | "approved"; unlinked: string[] };
    }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * 5.4 — `patchbay runs draft-evals --write` 와 같은 일. 운영 화면의 「평가 초안 넣기」가 부른다.
 *
 * 쓰기는 Core `appendProposedEvals` 하나이고 `ir.proposed.yaml` 에만 쓴다. 승인본(`overlay.ir`)의
 * 쓰기 길은 여전히 `ir adopt` 하나 — 실패 기록은 평가를 **제안**할 뿐 채택하지 못한다. 검토와 채택은
 * 1 설계 화면 한 곳에서 한다.
 */
export async function writeDraftEvalsView(studioHome: string, alias: string | undefined): Promise<WriteDraftEvalsResult> {
  const name = alias?.trim() ?? "";
  if (!name) return { ok: false, status: 400, error: "이름이 없다." };
  const studio = await readStudio(studioHome);
  if (!studio.projects.some((project) => project.alias === name)) {
    return { ok: false, status: 404, error: `등록된 프로젝트가 아니다: ${name}` };
  }

  const overlay = await readOverlay(studioHome, name);
  if (!overlay.ir) {
    return { ok: false, status: 409, error: "승인된 설계가 없다 — 1 설계에서 채택한 뒤에 평가 초안을 넣는다." };
  }
  const { records } = await readRunRecords(studioHome, name);
  const result = draftEvalsFromRuns(overlay.ir, records, { draft: await readProposedIrIfValid(studioHome, name) });
  if (result.draftEvals.length === 0) {
    return { ok: false, status: 409, error: "초안으로 만들 실패 기록이 없다." };
  }
  const fresh = draftsAsIrEvals(result);
  if (fresh.length === 0) {
    const ids = result.draftEvals.map((draft) => draft.id).join(" · ");
    return { ok: false, status: 409, error: `같은 실패의 평가가 이미 초안에 있다 — ${ids}. 1 설계에서 검토한다.` };
  }

  const appended = await appendProposedEvals(
    studioHome,
    name,
    fresh,
    result.requirementLinksToFill.map((row) => ({ node: row.node, eval: row.eval })),
  );
  if (!appended.ok) return { ok: false, status: 409, error: appended.error };
  return { ok: true, body: { added: appended.added, startedFrom: appended.startedFrom, unlinked: appended.unlinked } };
}

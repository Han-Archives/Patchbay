import {
  loadPrd,
  adoptIr,
  diffIr,
  parseIr,
  readOverlay,
  readProposedIr,
  readStudio,
  resolveProjectAlias,
  resolveStudioHome,
} from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface IrAdoptCommandOptions {
  project?: string;
  yes?: boolean;
  json?: boolean;
}

/**
 * `patchbay ir adopt [--project <alias>] [--yes] [--json]`
 *
 * **The only write path to `overlay.ir`** (명세 20260929a §2.3). The order is
 * check → archive → replace, and it lives in Core so this command and the
 * console's 채택 button cannot drift apart.
 *
 * There is no `--force`: a design that fails the gate is refused, because a
 * gate that can be stepped around is the same as no gate. `--yes` is not that
 * -- it only stands in for the human "yes" when there is no terminal to ask
 * in, which the spec requires before replacing an approved design.
 */
export async function runIrAdopt(
  options: IrAdoptCommandOptions,
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
    printError(json, `ir adopt: "${alias}" 는 등록된 프로젝트가 아니다.`);
    return 1;
  }

  // 차이를 먼저 보여 준다 (§2.3 「차이 먼저」). 비대화 실행이면 --yes 없이는 멈춘다.
  const overlay = await readOverlay(studioHome, alias);
  const current = overlay.ir ? parseIr(overlay.ir) : null;
  if (current?.ok) {
    const read = await readProposedIr(studioHome, alias);
    const proposed = read.ok ? parseIr(read.raw) : null;
    if (proposed?.ok) {
      const diff = diffIr(current.ir, proposed.ir);
      if (!json) {
        console.log(`${alias}: v${current.ir.version} → 초안을 채택한다`);
        if (diff.identical) console.log("  차이 없음 — 버전 번호만 오른다.");
        for (const line of diff.scalars) console.log(`  ${line}`);
        for (const section of diff.sections) {
          const parts = [
            section.added.length ? `+${section.added.join(", ")}` : "",
            section.removed.length ? `-${section.removed.join(", ")}` : "",
            section.changed.length ? `~${section.changed.join(", ")}` : "",
          ].filter(Boolean);
          console.log(`  ${section.section}: ${parts.join("  ")}`);
        }
      }
      if (!options.yes) {
        printError(
          json,
          "ir adopt: 승인된 IR을 바꾸려면 확인이 필요하다 — 차이를 본 뒤 --yes 를 붙인다.\n" +
            "  이 프로세스는 절대 되묻지 않는다 (비대화 계약).",
        );
        return 1;
      }
    }
  }

  // 화면은 PRD 11절이 모두 「맞아요」여야 채택한다. CLI는 막지 않고 알린다 — 묻지 않는 명령이고,
  // CLI를 쓰는 사람은 이미 사람이다 (명세 20261006a §14.2).
  const prd = await loadPrd(studioHome, alias);
  const reviewWaiting = prd.ok ? prd.review.sections.filter((s) => s.state !== "ok").map((s) => s.n) : [];
  if (reviewWaiting.length && !json) {
    console.error(`주의: PRD 검토가 덜 됐다 — ${reviewWaiting.join(" · ")}절. 콘솔에서는 이 상태로 채택할 수 없다.`);
  }
  const result = await adoptIr(studioHome, alias, { docRoot: project.path });
  if (!result.ok) {
    printError(json, `ir adopt: ${result.error}`, {
      ok: false,
      error: result.error,
      failedGates: result.checks?.failedGates ?? [],
      invalidated: result.checks?.invalidated ?? [],
    });
    return 1;
  }

  printResult(
    json,
    { ok: true, project: alias, version: result.version, previousVersion: result.previousVersion, archived: result.archived },
    [
      `채택했다 — ${alias} v${result.version}` + (result.previousVersion ? ` (이전 v${result.previousVersion})` : ""),
      ...(result.archived ? [`보관: ${result.archived}`] : []),
      "초안은 그대로 두었다 — 비교할 것이 남아야 한다.",
    ],
  );
  return 0;
}

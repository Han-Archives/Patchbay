import {
  PROPOSED_IR_FILE_NAME,
  diffIr,
  parseIr,
  readOverlay,
  readProposedIr,
  readStudio,
  resolveProjectAlias,
  resolveStudioHome,
} from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface IrDiffCommandOptions {
  project?: string;
  json?: boolean;
}

/**
 * `patchbay ir diff [--project <alias>] [--json]`
 *
 * Shows the draft against the approved IR. Read-only by design: seeing the
 * difference is the step *before* `ir adopt`, and 명세 §2.3 requires a person
 * to look at it first.
 */
export async function runIrDiff(
  options: IrDiffCommandOptions,
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

  const read = await readProposedIr(studioHome, alias);
  if (!read.ok) {
    printError(json, `ir diff: ${read.error}`);
    return 1;
  }
  const proposed = parseIr(read.raw);
  if (!proposed.ok) {
    printError(json, `ir diff: ${PROPOSED_IR_FILE_NAME} — ${proposed.error}`);
    return 1;
  }

  const overlay = await readOverlay(studioHome, alias);
  if (!overlay.ir) {
    printResult(
      json,
      { project: alias, current: null, proposed: proposed.ir.version, firstAdoption: true },
      [
        `${alias}: 승인된 IR이 아직 없다 — 이 초안이 첫 채택이 된다.`,
        `  초안 version ${proposed.ir.version} · 노드 ${proposed.ir.nodes.length} · State ${proposed.ir.state.length}칸`,
      ],
    );
    return 0;
  }

  const current = parseIr(overlay.ir);
  if (!current.ok) {
    printError(json, `ir diff: overlay.ir — ${current.error}`);
    return 1;
  }

  const { sections, scalars } = diffIr(current.ir, proposed.ir);
  const lines = [`${alias}: overlay.ir (v${current.ir.version}) → ${PROPOSED_IR_FILE_NAME} (v${proposed.ir.version})`, ""];
  if (!sections.length && !scalars.length) {
    lines.push("  차이 없음.");
  } else {
    for (const scalar of scalars) lines.push(`  ${scalar}`);
    for (const section of sections) {
      const parts = [
        section.added.length ? `+${section.added.join(", ")}` : "",
        section.removed.length ? `-${section.removed.join(", ")}` : "",
        section.changed.length ? `~${section.changed.join(", ")}` : "",
      ].filter(Boolean);
      lines.push(`  ${section.section}: ${parts.join("  ")}`);
    }
    lines.push("");
    lines.push("  채택하려면 검사를 먼저 통과해야 한다: patchbay ir check --project " + alias + " --proposed");
  }
  printResult(json, { project: alias, current: current.ir.version, proposed: proposed.ir.version, sections, scalars }, lines);
  return 0;
}

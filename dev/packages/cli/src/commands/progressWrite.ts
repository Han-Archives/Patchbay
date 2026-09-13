import {
  readAllProjectsProgress,
  readStudio,
  renderProgressMd,
  renderStudioProgressRollup,
  resolveStudioHome,
  writeProgressEntry,
  writeProgressMd,
  writeStudioProgressRollup,
} from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface ProgressWriteOptions {
  project?: string;
  summary?: string;
  skill?: string;
  step?: string;
  json?: boolean;
}

/**
 * `patchbay progress write --project <alias> --summary "<text>" [--skill <slug>] [--step <name>] [--json]`
 *
 * The only command that mutates the progress surface (spec Phase 7,
 * principle 10: no watcher, no inference -- `current`'s content comes only
 * from these explicit arguments). On success, in one process:
 *
 *   1. `writeProgressEntry` -- records the new `current` in `progress.yaml`
 *      for `--project`, moving the old `current` onto `history`.
 *   2. `renderProgressMd` + `writeProgressMd` -- regenerates that project's
 *      `PROGRESS.md` from the just-updated `Progress`.
 *   3. `readAllProjectsProgress` + `renderStudioProgressRollup` +
 *      `writeStudioProgressRollup` -- regenerates the studio-wide
 *      `progress.md` rollup across every registered project (not just this
 *      one), so it's never stale relative to what was just recorded.
 *
 * Exit codes:
 *   0 - recorded, all three files regenerated
 *   1 - missing --project/--summary, or --project isn't a registered alias
 *
 * Never prompts.
 */
export async function runProgressWrite(
  options: ProgressWriteOptions,
  studioHome: string = resolveStudioHome(),
): Promise<number> {
  const json = Boolean(options.json);

  if (!options.project) {
    printError(json, "progress write: --project <alias> is required.");
    return 1;
  }
  if (!options.summary) {
    printError(json, "progress write: --summary <text> is required.");
    return 1;
  }

  const studio = await readStudio(studioHome);
  const registered = studio.projects.find((project) => project.alias === options.project);
  if (!registered) {
    const knownAliases = studio.projects.map((project) => project.alias);
    printError(
      json,
      `No project registered with alias "${options.project}". ` +
        (knownAliases.length > 0
          ? `Registered aliases: ${knownAliases.join(", ")}.`
          : `No projects are registered yet -- run "patchbay project add --path <path>" first.`),
    );
    return 1;
  }

  const alias = registered.alias;

  const progress = await writeProgressEntry(studioHome, alias, {
    summary: options.summary,
    skill: options.skill,
    step: options.step,
  });
  const progressMdPath = await writeProgressMd(studioHome, alias, renderProgressMd(progress));

  const allProgress = await readAllProjectsProgress(studioHome);
  const rollupPath = await writeStudioProgressRollup(studioHome, renderStudioProgressRollup(allProgress));

  printResult(json, { ok: true, alias, summary: options.summary, progressMdPath, rollupPath }, [
    `Recorded progress for "${alias}": ${options.summary}`,
    progressMdPath,
    rollupPath,
  ]);
  return 0;
}

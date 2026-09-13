import {
  readProgress,
  readProgressMd,
  readProgressRaw,
  readStudio,
  readStudioProgressRollup,
  renderProgressLevel1,
  resolveStudioHome,
} from "@patchbay/core";
import { printError } from "../output.js";

export interface ProgressCommandOptions {
  project?: string;
  level?: string;
}

const VALID_LEVELS = ["1", "2", "3"] as const;

/**
 * `patchbay progress [--project <alias>] [--level 1|2|3]` -- read-only
 * (spec 8.4 signature, spec 5.5: "터미널: `patchbay progress` -- 현재 상태를
 * L1 요약으로 출력").
 *
 * Deliberately does NOT use `resolveProjectAlias` (unlike `scan`/`atlas`):
 * this command is spec'd as studio-wide-by-default, not "the sole
 * registered project by default" -- omitting `--project` always means the
 * studio-wide rollup across every registered project, never a per-project
 * fallback.
 *
 *   --project omitted  -> prints the studio-wide progress.md rollup as-is.
 *                          --level is ignored here (a rollup has no L2/L3 --
 *                          there's nothing to switch layers on).
 *   --project <alias>  -> that project isn't registered -> exit 1.
 *                          Otherwise:
 *     --level 1 (default) -- one-line summary, computed on the spot from
 *                             `readProgress` (no separate digest file).
 *     --level 2           -- PROGRESS.md, in full.
 *     --level 3           -- raw progress.yaml text.
 */
export async function runProgress(
  options: ProgressCommandOptions,
  studioHome: string = resolveStudioHome(),
): Promise<number> {
  if (!options.project) {
    try {
      const content = await readStudioProgressRollup(studioHome);
      process.stdout.write(content);
      return 0;
    } catch {
      printError(
        false,
        `No progress has been recorded yet for any project -- run "patchbay progress write --project <alias> --summary <text>" first.`,
      );
      return 1;
    }
  }

  const level = options.level ?? "1";
  if (!(VALID_LEVELS as readonly string[]).includes(level)) {
    printError(false, `progress: invalid --level "${level}" -- must be one of 1, 2, 3.`);
    return 1;
  }

  const studio = await readStudio(studioHome);
  const registered = studio.projects.find((project) => project.alias === options.project);
  if (!registered) {
    const knownAliases = studio.projects.map((project) => project.alias);
    printError(
      false,
      `No project registered with alias "${options.project}". ` +
        (knownAliases.length > 0
          ? `Registered aliases: ${knownAliases.join(", ")}.`
          : `No projects are registered yet -- run "patchbay project add --path <path>" first.`),
    );
    return 1;
  }

  if (level === "1") {
    const progress = await readProgress(studioHome, registered.alias);
    process.stdout.write(`${renderProgressLevel1(progress)}\n`);
    return 0;
  }

  if (level === "3") {
    const content = await readProgressRaw(studioHome, registered.alias);
    process.stdout.write(content);
    return 0;
  }

  try {
    const content = await readProgressMd(studioHome, registered.alias);
    process.stdout.write(content);
    return 0;
  } catch {
    printError(
      false,
      `PROGRESS.md not found for "${registered.alias}" -- run "patchbay progress write --project ${registered.alias} --summary <text>" first.`,
    );
    return 1;
  }
}

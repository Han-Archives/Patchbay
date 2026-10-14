import { recordProgressWrite, resolveStudioHome } from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface ProgressWriteOptions {
  project?: string;
  summary?: string;
  skill?: string;
  step?: string;
  asked?: string;
  did?: string;
  json?: boolean;
}

/**
 * `patchbay progress write --project <alias> --summary "<text>" [--skill <slug>]
 *   [--step <name>] [--asked "<request>"] [--did "<what shipped>"] [--json]`
 *
 * `--asked`/`--did` record the request and what came of it. The host model
 * holds the conversation and passes them here; the kernel reads no transcript.
 *
 * Thin wrapper around Core `recordProgressWrite` -- the same function MCP
 * `progress_write` calls. `current` comes only from these arguments.
 *
 * Exit codes:
 *   0 - recorded, all files regenerated
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

  try {
    const recorded = await recordProgressWrite(studioHome, options.project, {
      summary: options.summary,
      skill: options.skill,
      step: options.step,
      asked: options.asked,
      did: options.did,
    });
    printResult(json, { ok: true, alias: recorded.alias, summary: recorded.summary, progressMdPath: recorded.progressMdPath, rollupPath: recorded.rollupPath }, [
      `Recorded progress for "${recorded.alias}": ${recorded.summary}`,
      recorded.progressMdPath,
      recorded.rollupPath,
    ]);
    return 0;
  } catch (error) {
    printError(json, error instanceof Error ? error.message : String(error));
    return 1;
  }
}

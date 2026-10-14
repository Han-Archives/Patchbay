import fs from "node:fs";
import path from "node:path";
import { excavate, writeExcavation } from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface ProjectTriageOptions {
  path?: string;
  json?: boolean;
}

/**
 * `patchbay project triage --path <abs> [--json]`
 *
 * Runs the forensic excavation scan (no LLM, no studio registration) and
 * writes `<path>/excavation.json` inside the target folder itself (spec
 * 9.7 -- triage output lives in the project repo, not the studio home).
 *
 * Deliberately never registers a project or touches `studio.yaml` -- per
 * spec 6.0/6.3, triage is not an independent terminus. It's the
 * `triage-project` skill's job to read `excavation.json`, work with the
 * human to sort things out, and then hand off to `project new`/`project
 * add` once the folder is sorted.
 */
export async function runProjectTriage(options: ProjectTriageOptions): Promise<number> {
  const json = Boolean(options.json);

  if (!options.path) {
    printError(json, "project triage: --path <path> is required.");
    return 1;
  }

  const absolutePath = path.resolve(options.path);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
    printError(json, `project triage: path does not exist or is not a directory: ${absolutePath}`);
    return 1;
  }

  const excavation = await excavate(absolutePath);
  const excavationPath = await writeExcavation(absolutePath, excavation);

  printResult(json, { ok: true, path: absolutePath, excavationPath, excavation }, [
    `Excavation scan complete for ${absolutePath}.`,
    `Wrote ${excavationPath}`,
    `Files: ${excavation.totalFiles}, duplicate-name matches: ${excavation.duplicateMatches.length}, ` +
      `orphan candidates: ${excavation.orphanFiles.length}, TODO/FIXME matches: ${excavation.todoDensity.totalMatches}.`,
    `Next: run the "triage-project" skill to review these signals and sort this folder out.`,
  ]);
  return 0;
}

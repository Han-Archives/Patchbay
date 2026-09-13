import fs from "node:fs";
import path from "node:path";
import { ProjectAliasAlreadyRegisteredError, ensureStudioInitialized, registerProject, resolveStudioHome } from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface ProjectNewOptions {
  path?: string;
  json?: boolean;
}

/**
 * `patchbay project new <alias> --path <abs>`
 *
 * Contract only (spec Phase 3) -- no interactive design interview, that's
 * Phase 9:
 *   - no --path              -> exit 1
 *   - directory doesn't exist -> create it
 *   - directory exists, non-empty -> exit 1, nothing written
 *   - otherwise: ensureStudioInitialized + registerProject (empty project,
 *     no scan -- there's nothing there yet), exit 0
 */
export async function runProjectNew(
  alias: string,
  options: ProjectNewOptions,
  studioHome: string = resolveStudioHome(),
): Promise<number> {
  const json = Boolean(options.json);

  if (!options.path) {
    printError(json, "project new: --path <path> is required.");
    return 1;
  }

  const absolutePath = path.resolve(options.path);

  if (fs.existsSync(absolutePath)) {
    const stat = fs.statSync(absolutePath);
    if (!stat.isDirectory()) {
      printError(json, `project new: ${absolutePath} already exists and is not a directory.`);
      return 1;
    }
    const entries = fs.readdirSync(absolutePath);
    if (entries.length > 0) {
      printError(json, `project new: directory ${absolutePath} already exists and is not empty.`);
      return 1;
    }
  } else {
    fs.mkdirSync(absolutePath, { recursive: true });
  }

  await ensureStudioInitialized(studioHome);

  try {
    await registerProject(studioHome, { alias, kind: "local_repo", path: absolutePath });
  } catch (error) {
    if (error instanceof ProjectAliasAlreadyRegisteredError) {
      printError(json, error.message);
      return 1;
    }
    throw error;
  }

  printResult(json, { ok: true, alias, path: absolutePath }, [
    `Registered new project "${alias}" at ${absolutePath}.`,
    `No design interview yet (Phase 9) -- the project directory is empty and unscanned.`,
  ]);
  return 0;
}

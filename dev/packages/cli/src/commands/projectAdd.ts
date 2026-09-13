import fs from "node:fs";
import path from "node:path";
import {
  ProjectAliasAlreadyRegisteredError,
  computeAtlasCounts,
  computeAtlasSections,
  computeClarityScore,
  ensureStudioInitialized,
  hasReadmePort,
  readOverlay,
  registerProject,
  renderAtlas,
  renderAtlasDigest,
  renderFlowFile,
  resolveStudioHome,
  scan,
  walk,
  writeAtlas,
  writeAtlasDigest,
  writeFlow,
  writeInferred,
  writeOverlayIfAbsent,
} from "@patchbay/core";
import { CLARITY_GATE_THRESHOLD } from "../constants.js";
import { printError, printResult } from "../output.js";

export interface ProjectAddOptions {
  path?: string;
  alias?: string;
  forceAdd?: boolean;
  json?: boolean;
}

/**
 * `patchbay project add --path <abs> [--alias <alias>] [--force-add] [--json]`
 *
 * Exit codes (spec Phase 3 table):
 *   0 - registered + scanned successfully (prints ATLAS.md's absolute path)
 *   2 - clarity score below the triage gate and no --force-add (not registered)
 *   1 - bad/missing arguments (no --path, path doesn't exist, alias collision)
 *
 * Never prompts -- there is nothing in this flow that could block on stdin.
 */
export async function runProjectAdd(
  options: ProjectAddOptions,
  studioHome: string = resolveStudioHome(),
): Promise<number> {
  const json = Boolean(options.json);

  if (!options.path) {
    printError(json, "project add: --path <path> is required.");
    return 1;
  }

  const absolutePath = path.resolve(options.path);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
    printError(json, `project add: path does not exist or is not a directory: ${absolutePath}`);
    return 1;
  }

  const alias = options.alias ?? path.basename(absolutePath);

  await ensureStudioInitialized(studioHome);

  const inferred = await scan(absolutePath);
  const allRelativePaths = walk(absolutePath).map((file) => file.relativePath);
  const score = computeClarityScore({
    hasReadme: hasReadmePort(inferred),
    commitSubjects: inferred.git.recentCommitSubjects,
    allRelativePaths,
  });

  if (score < CLARITY_GATE_THRESHOLD && !options.forceAdd) {
    const message =
      `Clarity score ${score} is below the triage threshold (${CLARITY_GATE_THRESHOLD}). ` +
      `Try "patchbay project triage" instead, or pass --force-add to register anyway.`;
    printError(json, message, { ok: false, alias, path: absolutePath, score, threshold: CLARITY_GATE_THRESHOLD, message });
    return 2;
  }

  try {
    await registerProject(studioHome, { alias, kind: "local_repo", path: absolutePath });
  } catch (error) {
    if (error instanceof ProjectAliasAlreadyRegisteredError) {
      printError(json, error.message);
      return 1;
    }
    throw error;
  }

  await writeOverlayIfAbsent(studioHome, alias);
  await writeInferred(studioHome, alias, inferred);
  const overlay = await readOverlay(studioHome, alias);
  const atlasPath = await writeAtlas(studioHome, alias, renderAtlas(inferred, overlay));
  const atlasSections = computeAtlasSections(inferred, overlay);
  await writeAtlasDigest(studioHome, alias, renderAtlasDigest(computeAtlasCounts(atlasSections)));
  await writeFlow(studioHome, alias, renderFlowFile(inferred, overlay));

  printResult(json, { ok: true, alias, path: absolutePath, score, atlasPath }, [
    `Registered project "${alias}" at ${absolutePath} (clarity score ${score}).`,
    atlasPath,
  ]);
  return 0;
}

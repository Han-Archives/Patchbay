import {
  readOverlay,
  readStudio,
  renderAtlas,
  renderFlow,
  resolveStudioHome,
  scan,
  writeAtlas,
  writeFlow,
  writeInferred,
} from "@patchbay/core";
import { resolveProjectAlias } from "../aliasResolution.js";
import { printError, printResult } from "../output.js";

export interface ScanCommandOptions {
  project?: string;
  json?: boolean;
}

/**
 * `patchbay scan [--project <alias>]` -- re-runs `scan()` against a project
 * already registered in `studio.yaml` and rewrites `inferred.json` +
 * `ATLAS.md` + `FLOW.md`. Never touches `overlay.yaml` (human-owned).
 */
export async function runScan(
  options: ScanCommandOptions,
  studioHome: string = resolveStudioHome(),
): Promise<number> {
  const json = Boolean(options.json);
  const studio = await readStudio(studioHome);

  const resolution = resolveProjectAlias(studio, options.project);
  if (!resolution.ok) {
    printError(json, resolution.message);
    return 1;
  }

  const registered = studio.projects.find((project) => project.alias === resolution.alias);
  if (!registered) {
    // Unreachable given resolveProjectAlias's contract, but keeps this
    // function's own error handling self-contained rather than trusting it
    // silently.
    printError(json, `No project registered with alias "${resolution.alias}".`);
    return 1;
  }

  const inferred = await scan(registered.path);
  await writeInferred(studioHome, registered.alias, inferred);
  const overlay = await readOverlay(studioHome, registered.alias);
  const atlasPath = await writeAtlas(studioHome, registered.alias, renderAtlas(inferred, overlay));
  await writeFlow(studioHome, registered.alias, renderFlow(inferred, overlay));

  printResult(json, { ok: true, alias: registered.alias, atlasPath }, [
    `Rescanned "${registered.alias}".`,
    atlasPath,
  ]);
  return 0;
}

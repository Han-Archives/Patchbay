import { readAtlas, readStudio, resolveStudioHome } from "@patchbay/core";
import { resolveProjectAlias } from "../aliasResolution.js";
import { printError } from "../output.js";

export interface AtlasCommandOptions {
  project?: string;
}

/**
 * `patchbay atlas [--project <alias>]` -- prints the current ATLAS.md for a
 * registered project to stdout. No `--level` flag yet (that's Phase 4).
 */
export async function runAtlas(
  options: AtlasCommandOptions,
  studioHome: string = resolveStudioHome(),
): Promise<number> {
  const studio = await readStudio(studioHome);

  const resolution = resolveProjectAlias(studio, options.project);
  if (!resolution.ok) {
    printError(false, resolution.message);
    return 1;
  }

  try {
    const content = await readAtlas(studioHome, resolution.alias);
    process.stdout.write(content);
    return 0;
  } catch {
    printError(
      false,
      `ATLAS.md not found for "${resolution.alias}" -- run "patchbay scan --project ${resolution.alias}" first.`,
    );
    return 1;
  }
}

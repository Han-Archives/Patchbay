import {
  readAtlas,
  readAtlasDigest,
  readInferred,
  readStudio,
  resolveProjectAlias,
  resolveStudioHome,
} from "@patchbay/core";
import { printError } from "../output.js";

export interface AtlasCommandOptions {
  project?: string;
  level?: string;
}

const VALID_LEVELS = ["1", "2", "3"] as const;

/**
 * `patchbay atlas [--project <alias>] [--level <1|2|3>]` -- prints a
 * registered project's Atlas at the requested layer to stdout (spec Phase
 * 4):
 *
 *   --level 1 (L1) -- ATLAS.digest.md (counts/status only)
 *   --level 2 (L2) -- ATLAS.md (default, matches pre-Phase-4 behavior)
 *   --level 3 (L3) -- inferred.json, as-is
 *
 * Any other --level value is rejected (exit 1) rather than silently
 * falling back to the default.
 */
export async function runAtlas(
  options: AtlasCommandOptions,
  studioHome: string = resolveStudioHome(),
): Promise<number> {
  const level = options.level ?? "2";
  if (!(VALID_LEVELS as readonly string[]).includes(level)) {
    printError(false, `atlas: invalid --level "${level}" -- must be one of 1, 2, 3.`);
    return 1;
  }

  const studio = await readStudio(studioHome);

  const resolution = resolveProjectAlias(studio, options.project);
  if (!resolution.ok) {
    printError(false, resolution.message);
    return 1;
  }

  try {
    if (level === "1") {
      const content = await readAtlasDigest(studioHome, resolution.alias);
      process.stdout.write(content);
      return 0;
    }
    if (level === "3") {
      const inferred = await readInferred(studioHome, resolution.alias);
      process.stdout.write(`${JSON.stringify(inferred, null, 2)}\n`);
      return 0;
    }
    const content = await readAtlas(studioHome, resolution.alias);
    process.stdout.write(content);
    return 0;
  } catch {
    const fileLabel = level === "1" ? "ATLAS.digest.md" : level === "3" ? "inferred.json" : "ATLAS.md";
    printError(
      false,
      `${fileLabel} not found for "${resolution.alias}" -- run "patchbay scan --project ${resolution.alias}" first.`,
    );
    return 1;
  }
}

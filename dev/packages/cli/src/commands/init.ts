import os from "node:os";
import { ensureStudioInitialized, readStudio, resolveStudioHome, writeStudio } from "@patchbay/core";
import { printResult } from "../output.js";

export interface InitOptions {
  name?: string;
  json?: boolean;
}

/**
 * `patchbay init [--name <name>]` -- thin wrapper: create the studio home
 * (Core), pick a name (no prompting -- `os.hostname()` if not given), write
 * `studio.yaml` (Core), print, exit 0.
 */
export async function runInit(options: InitOptions, studioHome: string = resolveStudioHome()): Promise<number> {
  await ensureStudioInitialized(studioHome);

  const existing = await readStudio(studioHome);
  const name = options.name ?? existing.name ?? os.hostname();
  const studio = { ...existing, name };
  await writeStudio(studioHome, studio);

  printResult(Boolean(options.json), { ok: true, studioHome, name }, [
    `Initialized Patchbay studio "${name}" at ${studioHome}`,
  ]);
  return 0;
}

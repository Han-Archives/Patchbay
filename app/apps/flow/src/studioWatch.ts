import fs from "node:fs";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { parseStudioEvent, type StudioEvent } from "./eventsContract.js";

export interface StudioWatch {
  close(): Promise<void>;
  ready: Promise<void>;
}

/**
 * Watches `<studioHome>/projects/<alias>/{progress.yaml,inferred.json,overlay.yaml,
 * ir.proposed.yaml,board.yaml}` for the lifetime of `patchbay flow`.
 * Not a boot daemon -- `close()` ends it.
 */
export function startStudioWatch(studioHome: string, onEvent: (event: StudioEvent) => void): StudioWatch {
  const projectsDir = path.join(studioHome, "projects");
  fs.mkdirSync(projectsDir, { recursive: true });

  const watcher: FSWatcher = watch(projectsDir, {
    ignoreInitial: true,
    depth: 2,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  });

  const ready = new Promise<void>((resolve) => {
    watcher.once("ready", () => resolve());
  });

  const handle = (filePath: string) => {
    const parsed = parseStudioEvent(filePath, studioHome);
    if (parsed) onEvent(parsed);
  };

  watcher.on("add", handle);
  watcher.on("change", handle);
  watcher.on("unlink", handle);

  return {
    ready,
    close: () => watcher.close(),
  };
}

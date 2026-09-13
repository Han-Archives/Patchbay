import fs from "node:fs/promises";
import path from "node:path";
import type { PortId } from "../types/portId.js";

/**
 * One truncated excerpt of a discovered "signal" source file (spec 7.8's
 * README/AGENTS.md/CLAUDE.md/`.cursor/rules` list, surfaced as `source:`
 * kind `PortId`s in `inferred.discoveredPorts`), read fresh from the
 * project's own working tree -- not from anything cached in
 * `inferred.json`.
 */
export interface SignalExcerpt {
  /** The full `source:` PortId this excerpt came from. */
  port: string;
  /** POSIX path relative to the project root (the PortId's ref). */
  path: string;
  /** File content, truncated to at most `maxChars` characters. */
  content: string;
  /** True iff `content` was cut short of the file's actual length. */
  truncated: boolean;
}

/**
 * Reads excerpts of every `source:` kind PortId in `discoveredPorts`,
 * resolved against `projectPath` (a registered project's real filesystem
 * path, spec Phase 3's `StudioRegisteredProject.path`), each capped at
 * `maxChars` characters (default 2000).
 *
 * Built for `get_project_bundle`'s `scope: "full"` (Phase 6, MCP): the
 * "core files excerpts" a proposal needs, read directly rather than
 * reinventing signal detection (that already lives in
 * `scan/signalReader.ts`'s `findSignalPaths` -- this just re-reads whatever
 * the scan already found and recorded as PortIds).
 *
 * A discovered signal file that no longer exists or can't be read (deleted,
 * permissions, etc. -- `inferred.json` can be stale relative to the current
 * working tree) is silently skipped rather than failing the whole bundle;
 * every other kind of PortId (non-`source:`) is skipped too, since this
 * function only ever excerpts signal files.
 */
export async function readSignalExcerpts(
  projectPath: string,
  discoveredPorts: readonly PortId[],
  maxChars = 2000,
): Promise<SignalExcerpt[]> {
  const sourcePorts = discoveredPorts.filter((port) => port.startsWith("source:"));

  const excerpts: SignalExcerpt[] = [];
  for (const port of sourcePorts) {
    const relPath = port.slice("source:".length);
    const absPath = path.join(projectPath, relPath);

    let raw: string;
    try {
      raw = await fs.readFile(absPath, "utf8");
    } catch {
      continue;
    }

    const truncated = raw.length > maxChars;
    excerpts.push({
      port,
      path: relPath,
      content: truncated ? raw.slice(0, maxChars) : raw,
      truncated,
    });
  }

  return excerpts;
}

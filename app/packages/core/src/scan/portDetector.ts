import path from "node:path";
import { portIdSchema, type PortId } from "../types/portId.js";
import type { WalkedFile } from "./fileWalker.js";
import { findSignalPaths } from "./signalReader.js";

export interface DetectPortsOptions {
  /**
   * Studio Bay slugs known in this scanning context. Default: `[]`, since
   * Phase 2 has no studio context yet (studios/Bays don't exist until a
   * later phase) -- the parameter exists now so scanner.ts's signature is
   * already future-proof.
   */
  studioBaySlugs?: string[];
}

function toPortId(raw: string): PortId {
  const result = portIdSchema.safeParse(raw);
  if (!result.success) {
    // Should be unreachable: every string this module builds is either
    // `skill:<slug>` (slug already validated against the same slug
    // pattern by construction below) or `skill:`/`source:` + a POSIX
    // relative path produced by fileWalker. A failure here means a bug in
    // this module, not bad input -- so throwing (rather than silently
    // dropping the port) is the right failure mode.
    throw new Error(`Scanner produced an invalid PortId: "${raw}" (${result.error.message})`);
  }
  return result.data;
}

/**
 * Finds SKILL.md files (at any depth, outside ignored dirs) among an
 * already-walked file list.
 *
 * Exception: if a SKILL.md's immediate parent directory name exactly
 * matches an entry in `studioBaySlugs`, it is emitted as the bare Bay-slug
 * form (`skill:<slug>`) instead of the fileRef form (`skill:<path>`).
 *
 * Returns PortIds, not yet deduplicated/merged with signal ports -- see
 * `detectPorts` for the combined, sorted result.
 */
export function findSkillPorts(files: WalkedFile[], studioBaySlugs: string[] = []): PortId[] {
  const slugSet = new Set(studioBaySlugs);
  const ports: PortId[] = [];

  for (const file of files) {
    const rel = file.relativePath;
    if (path.posix.basename(rel) !== "SKILL.md") continue;

    const parentDirName = path.posix.basename(path.posix.dirname(rel));
    if (slugSet.has(parentDirName)) {
      ports.push(toPortId(`skill:${parentDirName}`));
    } else {
      ports.push(toPortId(`skill:${rel}`));
    }
  }

  return ports;
}

/**
 * Combines skill-port detection (this module) with signal-file detection
 * (`signalReader`) into the final `discoveredPorts` array: deduplicated and
 * sorted ascending, lexicographically on the PortId string itself.
 *
 * Kept as a separate step from `findSkillPorts`/`findSignalPaths` because
 * these are genuinely two different jobs -- skill discovery has the
 * Bay-slug exception, signal discovery doesn't -- and each is easier to
 * test in isolation than through the merge.
 */
export function detectPorts(files: WalkedFile[], options: DetectPortsOptions = {}): PortId[] {
  const skillPorts = findSkillPorts(files, options.studioBaySlugs ?? []);
  const signalPorts = findSignalPaths(files).map((rel) => toPortId(`source:${rel}`));

  const unique = Array.from(new Set([...skillPorts, ...signalPorts]));
  unique.sort();
  return unique;
}

import path from "node:path";
import { inferredSchema, type Inferred, type StoredSensitivity } from "../types/inferred.js";
import { portFileRef, type PortId } from "../types/portId.js";
import { classifyPath, isSecret, WORKING_LEVEL } from "../sensitivity/sensitivity.js";
import { walk } from "./fileWalker.js";
import { readGitInfo } from "./gitReader.js";
import { detectPorts } from "./portDetector.js";

export interface ScanOptions {
  /** Studio Bay slugs known in this context. Default: `[]` (see portDetector). */
  studioBaySlugs?: string[];
}

/**
 * Deterministic scanner composition root (Phase 2).
 *
 * Given a local folder path, walks the file tree (skipping the standard
 * ignore list), reads local-only git metadata, and detects ports
 * (SKILL.md / README / AGENTS.md / CLAUDE.md / .cursor/rules) to produce a
 * value matching `inferredSchema` -- the "unlabeled jacks" the scanner
 * found, with no concept of an ontology to label them against (that's a
 * later phase's job).
 *
 * No LLM calls, no network calls. Given the same on-disk + git state, this
 * function is deterministic: every array is sorted before being returned,
 * and nothing timestamp- or filesystem-order-derived is included.
 */
export async function scan(rootDir: string, options: ScanOptions = {}): Promise<Inferred> {
  const absoluteRoot = path.resolve(rootDir);

  const files = walk(absoluteRoot);
  const detected = detectPorts(files, { studioBaySlugs: options.studioBaySlugs ?? [] });
  const git = await readGitInfo(absoluteRoot);

  const { discoveredPorts, portLevels } = gradePorts(detected);

  const result: Inferred = {
    discoveredPorts,
    portLevels,
    git,
    agents: [],
  };

  // Parse (not just validate) so the returned value is exactly what
  // `inferredSchema` produces (defaults applied, branded PortId type) --
  // a thrown error here would mean a bug in this module, not bad input.
  return inferredSchema.parse(result);
}

/**
 * Grades every detected port and withholds the secret ones.
 *
 * Classification happens here, at write time, so the level is *stored* in
 * `inferred.json` rather than recomputed by each reader -- Neo4j ingest, the
 * knowledge search and an MCP bundle then all see the same grade the scan
 * recorded, instead of each reimplementing the rule (or forgetting to).
 *
 * A secret port is kept out of `discoveredPorts` entirely: an L4 file must
 * never be advertised as a jack that something downstream might read. It is
 * still recorded in `portLevels` -- `classifyPath` judges the path without
 * opening the file, and Atlas already shows names without contents, so the
 * grade can be audited without the content leaking. This is reachable, not
 * theoretical: `secrets/.cursor/rules/x.mdc` and `.ssh/README.md` both match
 * a signal-file pattern *and* a secret rule.
 *
 * A Bay slug (`skill:map-project`) has no project path to grade, so it gets
 * the same default as any unmatched file -- L2 -- with a reason that says why
 * rather than implying a rule matched.
 */
function gradePorts(detected: readonly PortId[]): {
  discoveredPorts: PortId[];
  portLevels: Record<string, StoredSensitivity>;
} {
  const discoveredPorts: PortId[] = [];
  const portLevels: Record<string, StoredSensitivity> = {};

  for (const port of detected) {
    const ref = portFileRef(port);
    const verdict: StoredSensitivity = ref
      ? classifyPath(ref)
      : { level: WORKING_LEVEL, reason: "스튜디오 Bay 슬러그라 프로젝트 경로가 없습니다" };
    portLevels[port] = verdict;
    if (!isSecret(verdict.level)) discoveredPorts.push(port);
  }

  return { discoveredPorts, portLevels };
}

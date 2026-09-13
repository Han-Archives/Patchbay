import type { Inferred } from "../types/inferred.js";
import type { Overlay } from "../types/overlay.js";
import type { PortId } from "../types/portId.js";

/**
 * Shared aggregation for Atlas's layered views (spec Phase 4, spec
 * principle 9: L1 must never be produced by slicing/regexing L2's rendered
 * markdown -- both layers have to be rendered from this same underlying
 * data structure instead).
 *
 * `computeAtlasSections` is the single place that categorizes a project's
 * ports into the v1 Skills/Rules/Unlabeled-ports buckets (there is no
 * ontology yet, Phase 8 -- see `atlasRenderer.ts` for the rationale, which
 * used to live inline there and now lives here so `atlasRenderer.ts` (L2)
 * and the L1 digest renderer below both consume the exact same values).
 */
export interface AtlasSections {
  skills: PortId[];
  rules: PortId[];
  unlabeledPorts: PortId[];
}

/**
 * Categorizes `inferred`/`overlay` into the three Atlas buckets:
 *   - skills:          distinct `from` PortIds of kind "skill" in overlay.patches
 *   - rules:           discoveredPorts of kind "source"
 *   - unlabeledPorts:  discoveredPorts of kind "skill"
 *
 * Pure function -- no I/O, no LLM calls. Takes the raw `Inferred`/`Overlay`
 * data structures, never a rendered string.
 */
export function computeAtlasSections(inferred: Inferred, overlay: Overlay): AtlasSections {
  const skills = Array.from(
    new Set(overlay.patches.filter((patch) => patch.from.startsWith("skill:")).map((patch) => patch.from)),
  ).sort() as PortId[];

  const rules = inferred.discoveredPorts.filter((port) => port.startsWith("source:"));
  const unlabeledPorts = inferred.discoveredPorts.filter((port) => port.startsWith("skill:"));

  return { skills, rules, unlabeledPorts };
}

/** L1 counts -- a trivial `.length` mapping over `AtlasSections`. */
export interface AtlasCounts {
  skills: number;
  rules: number;
  unlabeledPorts: number;
}

export function computeAtlasCounts(sections: AtlasSections): AtlasCounts {
  return {
    skills: sections.skills.length,
    rules: sections.rules.length,
    unlabeledPorts: sections.unlabeledPorts.length,
  };
}

/**
 * Renders `ATLAS.digest.md` (L1 layer): counts/status only, one screen or
 * less. Exact prose isn't an acceptance criterion -- the count values are.
 */
export function renderAtlasDigest(counts: AtlasCounts): string {
  return [
    "# Atlas Digest",
    "",
    `- Skills: ${counts.skills}`,
    `- Rules: ${counts.rules}`,
    `- Unlabeled ports: ${counts.unlabeledPorts}`,
    "",
  ].join("\n");
}

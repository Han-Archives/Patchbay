import type { Inferred } from "../types/inferred.js";
import type { Overlay } from "../types/overlay.js";
import type { PortId } from "../types/portId.js";
import { matchPatchesAndWires, type Patch, type PatchWireMatch, type Wire } from "../types/project.js";

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
 *
 * Phase 5 adds `matched`/`patchesWithoutWire`/`wiresWithoutPatch` (spec
 * section 7.2's `matchPatchesAndWires`, reused as-is here rather than
 * reimplemented): `matched` is a Patch actually wired up. `patchesWithoutWire`
 * is a "to-do" -- declared intent nothing has actually wired up yet.
 * `wiresWithoutPatch` is a normal discovered integration nobody declared a
 * Patch for -- expected, not a bug. Together the three are every cable a
 * graph view of Atlas needs to draw -- see `visual-first` rule.
 */
export interface AtlasSections {
  skills: PortId[];
  rules: PortId[];
  unlabeledPorts: PortId[];
  matched: PatchWireMatch[];
  patchesWithoutWire: Patch[];
  wiresWithoutPatch: Wire[];
}

/**
 * Categorizes `inferred`/`overlay` into the Atlas buckets:
 *   - skills:             distinct `from` PortIds of kind "skill" in overlay.patches
 *   - rules:               discoveredPorts of kind "source"
 *   - unlabeledPorts:      discoveredPorts of kind "skill"
 *   - matched:             overlay.patches with a matching overlay.wires entry (spec 7.2)
 *   - patchesWithoutWire:  overlay.patches with no matching overlay.wires entry (spec 7.2)
 *   - wiresWithoutPatch:   overlay.wires with no matching overlay.patches entry (spec 7.2)
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

  const { matched, patchesWithoutWire, wiresWithoutPatch } = matchPatchesAndWires(overlay.patches, overlay.wires);

  return { skills, rules, unlabeledPorts, matched, patchesWithoutWire, wiresWithoutPatch };
}

/** L1 counts -- a trivial `.length` mapping over `AtlasSections`. */
export interface AtlasCounts {
  skills: number;
  rules: number;
  unlabeledPorts: number;
  patchesWithoutWire: number;
  wiresWithoutPatch: number;
}

export function computeAtlasCounts(sections: AtlasSections): AtlasCounts {
  return {
    skills: sections.skills.length,
    rules: sections.rules.length,
    unlabeledPorts: sections.unlabeledPorts.length,
    patchesWithoutWire: sections.patchesWithoutWire.length,
    wiresWithoutPatch: sections.wiresWithoutPatch.length,
  };
}

/**
 * Renders `ATLAS.digest.md` (L1 layer): counts/status only, one screen or
 * less. Exact prose isn't an acceptance criterion -- the count values are.
 */
export function renderAtlasDigest(counts: AtlasCounts): string {
  return [
    "# 구조 요약 (간단본)",
    "",
    `- 스킬: ${counts.skills}`,
    `- 규칙: ${counts.rules}`,
    `- 분류 안 된 항목: ${counts.unlabeledPorts}`,
    `- 선언만 있고 실물이 없는 연결: ${counts.patchesWithoutWire}`,
    `- 실물만 있고 선언이 없는 연결: ${counts.wiresWithoutPatch}`,
    "",
  ].join("\n");
}

import type { Inferred } from "../types/inferred.js";
import type { Overlay } from "../types/overlay.js";
import type { PortId } from "../types/portId.js";
import { computeAtlasSections } from "./layers.js";

/** Literal placeholder for an empty section (spec Phase 3: no ontology yet, so an empty list is expected, not a bug). */
const EMPTY_MARKER = "없음";

function renderPortList(ports: readonly PortId[]): string {
  if (ports.length === 0) return EMPTY_MARKER;
  return ports.map((port) => `- ${port}`).join("\n");
}

/**
 * Renders `ATLAS.md` (L2 layer -- the full view; the L1 digest lives in
 * `layers.ts`'s `renderAtlasDigest`, both consuming the same
 * `computeAtlasSections` output so their numbers can never drift apart,
 * spec Phase 4) from a project's `Inferred` scan output and its human-owned
 * `Overlay`.
 *
 * There is no ontology yet (Phase 8), so the Skills/Rules/Unlabeled-ports
 * categorization (a project-lead decision, not derived from the spec's
 * discovered-ports model) lives in `computeAtlasSections` -- see that
 * function's doc comment for exactly what each bucket means.
 *
 * Pure function -- no I/O, no LLM calls.
 */
export function renderAtlas(inferred: Inferred, overlay: Overlay): string {
  const { skills, rules, unlabeledPorts } = computeAtlasSections(inferred, overlay);

  return [
    "## Skills",
    "",
    renderPortList(skills),
    "",
    "## Rules",
    "",
    renderPortList(rules),
    "",
    "## Unlabeled ports",
    "",
    renderPortList(unlabeledPorts),
    "",
  ].join("\n");
}

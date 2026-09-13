import type { Inferred } from "../types/inferred.js";
import type { Overlay } from "../types/overlay.js";
import type { PortId } from "../types/portId.js";

/** Literal placeholder for an empty section (spec Phase 3: no ontology yet, so an empty list is expected, not a bug). */
const EMPTY_MARKER = "없음";

function renderPortList(ports: readonly PortId[]): string {
  if (ports.length === 0) return EMPTY_MARKER;
  return ports.map((port) => `- ${port}`).join("\n");
}

/**
 * Renders `ATLAS.md` (L2 layer only -- no digest/L1 in this phase, spec
 * Phase 3/4 split) from a project's `Inferred` scan output and its
 * human-owned `Overlay`.
 *
 * There is no ontology yet (Phase 8), so this is a from-scratch v1 mapping
 * (a project-lead decision, not derived from the spec's discovered-ports
 * model):
 *   - Skills:          distinct `from` PortIds of kind "skill" in overlay.patches
 *   - Rules:           discoveredPorts of kind "source" (README/AGENTS.md/CLAUDE.md/.cursor/rules)
 *   - Unlabeled ports: discoveredPorts of kind "skill" (found SKILL.md, not yet patched in)
 *
 * Pure function -- no I/O, no LLM calls.
 */
export function renderAtlas(inferred: Inferred, overlay: Overlay): string {
  const skillPorts = Array.from(
    new Set(overlay.patches.filter((patch) => patch.from.startsWith("skill:")).map((patch) => patch.from)),
  ).sort() as PortId[];

  const rulePorts = inferred.discoveredPorts.filter((port) => port.startsWith("source:"));
  const unlabeledPorts = inferred.discoveredPorts.filter((port) => port.startsWith("skill:"));

  return [
    "## Skills",
    "",
    renderPortList(skillPorts),
    "",
    "## Rules",
    "",
    renderPortList(rulePorts),
    "",
    "## Unlabeled ports",
    "",
    renderPortList(unlabeledPorts),
    "",
  ].join("\n");
}

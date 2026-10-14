import type { Inferred } from "../types/inferred.js";
import type { Overlay } from "../types/overlay.js";
import type { PortId } from "../types/portId.js";
import type { Patch, Wire } from "../types/project.js";
import { computeAtlasSections } from "./layers.js";

/** Literal placeholder for an empty section (spec Phase 3: no ontology yet, so an empty list is expected, not a bug). */
const EMPTY_MARKER = "없음";

function renderPortList(ports: readonly PortId[]): string {
  if (ports.length === 0) return EMPTY_MARKER;
  return ports.map((port) => `- ${port}`).join("\n");
}

/** Compact one-line rendering of a Patch/Wire's (from, kind, to) triple, shared by both Gaps sub-lists below. */
function renderGapEntry(entry: { from: PortId; kind: string; to: PortId }): string {
  return `- \`${entry.from} --[${entry.kind}]--> ${entry.to}\``;
}

function renderPatchList(patches: readonly Patch[]): string {
  if (patches.length === 0) return EMPTY_MARKER;
  return patches.map(renderGapEntry).join("\n");
}

function renderWireList(wires: readonly Wire[]): string {
  if (wires.length === 0) return EMPTY_MARKER;
  return wires.map(renderGapEntry).join("\n");
}

/**
 * Renders `ATLAS.md` (L2 layer -- the full view; the L1 digest lives in
 * `layers.ts`'s `renderAtlasDigest`, both consuming the same
 * `computeAtlasSections` output so their numbers can never drift apart,
 * spec Phase 4) from a project's `Inferred` scan output and its human-owned
 * `Overlay`.
 *
 * There is no ontology yet (Phase 8), so the 스킬/규칙/분류-안-된-항목
 * categorization (a project-lead decision, not derived from the spec's
 * discovered-ports model) lives in `computeAtlasSections` -- see that
 * function's doc comment for exactly what each bucket means.
 *
 * Phase 5 adds a fourth section, `## Gaps`, rendered from
 * `computeAtlasSections`'s `patchesWithoutWire`/`wiresWithoutPatch` (spec
 * section 7.2) -- it never recomputes the diff itself. A Patch without a
 * Wire is a to-do (declared intent nothing has actually wired up yet); a
 * Wire without a Patch is a normal discovered integration nobody declared
 * ahead of time -- expected, not a bug, worded that way in the prose below.
 *
 * Pure function -- no I/O, no LLM calls.
 */
export function renderAtlas(inferred: Inferred, overlay: Overlay): string {
  const { skills, rules, unlabeledPorts, patchesWithoutWire, wiresWithoutPatch } = computeAtlasSections(
    inferred,
    overlay,
  );

  // Headings name what the reader is looking at, with the term's meaning on
  // the line under it (visual-first.mdc 3) -- this file is read by a person,
  // not parsed, so "Unlabeled ports" buying nothing over "분류 안 된 항목".
  return [
    "## 스킬",
    "",
    renderPortList(skills),
    "",
    "## 규칙",
    "",
    renderPortList(rules),
    "",
    "## 분류 안 된 항목",
    "",
    "스캔이 찾았지만 아직 스킬도 규칙도 아닌 파일이다.",
    "",
    renderPortList(unlabeledPorts),
    "",
    "## 빈틈",
    "",
    "선언된 연결과 실제 연결이 짝을 못 찾은 곳이다.",
    "",
    "### 선언만 있고 실물이 없는 연결",
    "",
    "사람이 선언했지만 아직 실제로 연결된 것이 없다. 할 일이다.",
    "",
    renderPatchList(patchesWithoutWire),
    "",
    "### 실물만 있고 선언이 없는 연결",
    "",
    "실제로 연결돼 있지만 아무도 선언하지 않았다. 정상이고 결함이 아니다.",
    "",
    renderWireList(wiresWithoutPatch),
    "",
  ].join("\n");
}

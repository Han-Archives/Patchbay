import { z } from "zod";
import { portIdOfKind, portIdSchema, type PortId } from "./portId.js";

/**
 * Meta/studio ontology (spec section 1.2):
 *
 *   Project --> Skill
 *   Project --> Agent
 *   Agent   --> Skill
 *   Skill   --> Source
 *   Artifact/Patch/Wire --> Project
 *
 * Relations to a Project are expressed as a `project` alias field on the
 * "many" side (Artifact/Patch/Wire) rather than by embedding those arrays
 * back on Project, to avoid re-deriving the same data in two places.
 */

// --- Source -----------------------------------------------------------

export const sourceSchema = z.object({
  port: portIdOfKind("source"),
  description: z.string().optional(),
});
export type Source = z.infer<typeof sourceSchema>;

// --- Skill --------------------------------------------------------------

export const skillSchema = z.object({
  port: portIdOfKind("skill"), // this Skill's own address (Bay slug, or project-local SKILL.md fileRef)
  name: z.string(),
  source: sourceSchema,
  description: z.string().optional(),
});
export type Skill = z.infer<typeof skillSchema>;

// --- Agent ----------------------------------------------------------------
// Schema-only in v1: nothing populates this automatically. Reserved for a
// later host/session surface; not wired to assignments or Telegram.

export const agentSchema = z.object({
  port: portIdOfKind("agent"),
  name: z.string(),
  skills: z.array(portIdOfKind("skill")).default([]), // Agent --> Skill
});
export type Agent = z.infer<typeof agentSchema>;

// --- Artifact -------------------------------------------------------------

export const ARTIFACT_LAYERS = ["digest", "detail"] as const;
export type ArtifactLayer = (typeof ARTIFACT_LAYERS)[number];
export const artifactLayerSchema = z.enum(ARTIFACT_LAYERS);

export const artifactSchema = z.object({
  port: portIdOfKind("artifact"),
  project: z.string(), // alias of the owning Project
  layer: artifactLayerSchema, // rendered at different levels of detail
  description: z.string().optional(),
});
export type Artifact = z.infer<typeof artifactSchema>;

// --- Patch / Wire -----------------------------------------------------

export const PATCH_KINDS = ["reads", "produces", "proposes", "uses"] as const;
export type PatchKind = (typeof PATCH_KINDS)[number];
export const patchKindSchema = z.enum(PATCH_KINDS);

export const patchSchema = z.object({
  project: z.string(), // alias of the owning Project
  from: portIdSchema,
  to: portIdSchema,
  kind: patchKindSchema,
});
export type Patch = z.infer<typeof patchSchema>;

export const WIRE_INSTALL_METHODS = ["symlink", "copy"] as const;
export type WireInstallMethod = (typeof WIRE_INSTALL_METHODS)[number];
export const wireInstallMethodSchema = z.enum(WIRE_INSTALL_METHODS);

// Wire is NOT a child of Patch — it is an independently discovered
// integration that a Patch may or may not have declared. `evidence` is
// deliberately excluded from the matching key.
export const wireSchema = patchSchema.extend({
  evidence: z.string().optional(),
  install: wireInstallMethodSchema,
});
export type Wire = z.infer<typeof wireSchema>;

// --- Project ----------------------------------------------------------

export const projectSchema = z.object({
  alias: z.string(),
  skills: z.array(skillSchema).default([]),
  agents: z.array(agentSchema).default([]), // v1 default/common case: empty
});
export type Project = z.infer<typeof projectSchema>;

// --- Patch/Wire matching (spec section 7.2) -------------------------------

/** The matching key between a Patch and a Wire is exactly (from, to, kind). */
function matchKey(entry: { from: PortId; to: PortId; kind: PatchKind }): string {
  return `${entry.from} ${entry.to} ${entry.kind}`;
}

export interface PatchWireMatch {
  patch: Patch;
  wire: Wire;
}

export interface MatchPatchesAndWiresResult {
  matched: PatchWireMatch[];
  patchesWithoutWire: Patch[];
  wiresWithoutPatch: Wire[];
}

/**
 * Pure diff between declared Patches and discovered Wires, keyed on
 * (from, to, kind). A Wire with no matching Patch is normal (a discovered
 * integration nobody has declared yet), not a bug.
 */
export function matchPatchesAndWires(patches: Patch[], wires: Wire[]): MatchPatchesAndWiresResult {
  const unclaimedWiresByKey = new Map<string, Wire[]>();
  for (const wire of wires) {
    const key = matchKey(wire);
    const bucket = unclaimedWiresByKey.get(key);
    if (bucket) {
      bucket.push(wire);
    } else {
      unclaimedWiresByKey.set(key, [wire]);
    }
  }

  const matched: PatchWireMatch[] = [];
  const patchesWithoutWire: Patch[] = [];
  const claimedWires = new Set<Wire>();

  for (const patch of patches) {
    const bucket = unclaimedWiresByKey.get(matchKey(patch));
    const wire = bucket?.find((candidate) => !claimedWires.has(candidate));
    if (wire) {
      claimedWires.add(wire);
      matched.push({ patch, wire });
    } else {
      patchesWithoutWire.push(patch);
    }
  }

  const wiresWithoutPatch = wires.filter((wire) => !claimedWires.has(wire));

  return { matched, patchesWithoutWire, wiresWithoutPatch };
}

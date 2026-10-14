import { computeAtlasCounts, computeAtlasSections, renderAtlasDigest } from "../render/layers.js";
import { renderAtlas } from "../render/atlasRenderer.js";
import { renderFlowFile } from "../render/flowRenderer.js";
import type { Inferred } from "../types/index.js";
import { readOverlay, writeAtlas, writeAtlasDigest, writeFlow, writeInferred } from "./projectFiles.js";

/**
 * Writes one scan's outputs for a registered alias: `inferred.json`, then
 * `ATLAS.md`, `ATLAS.digest.md` and `FLOW.md` rendered against the current
 * overlay. Never touches `overlay.yaml` (human-owned).
 *
 * `project add`, `scan`, and the console's register/rescan buttons all end
 * here, so the four files can't drift apart between a terminal scan and a
 * screen scan.
 */
export async function writeScanOutputs(
  studioHome: string,
  alias: string,
  inferred: Inferred,
): Promise<{ atlasPath: string }> {
  await writeInferred(studioHome, alias, inferred);
  const overlay = await readOverlay(studioHome, alias);
  const atlasPath = await writeAtlas(studioHome, alias, renderAtlas(inferred, overlay));
  const atlasSections = computeAtlasSections(inferred, overlay);
  await writeAtlasDigest(studioHome, alias, renderAtlasDigest(computeAtlasCounts(atlasSections)));
  await writeFlow(studioHome, alias, renderFlowFile(inferred, overlay));
  return { atlasPath };
}

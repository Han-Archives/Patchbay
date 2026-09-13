import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  computeAtlasCounts,
  computeAtlasSections,
  readOverlay,
  registerProject,
  renderAtlas,
  renderAtlasDigest,
  renderFlowFile,
  scan,
  writeAtlas,
  writeAtlasDigest,
  writeFlow,
  writeInferred,
  writeOverlayIfAbsent,
  type Inferred,
  type Overlay,
} from "@patchbay/core";

/**
 * Test-only fixture: registers a project and produces the same on-disk file
 * set `patchbay scan` would (`packages/cli/src/commands/scan.ts`), by
 * calling the exact same Core functions in the exact same order -- kept
 * here rather than duplicated per test file. Always a fresh OS tmpdir for
 * both the studio home and the project itself, never anything real.
 */
export interface ScannedProjectFixture {
  studioHome: string;
  alias: string;
  projectPath: string;
  inferred: Inferred;
  overlay: Overlay;
}

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export async function setupScannedProject(options: {
  alias?: string;
  readmeContent?: string;
} = {}): Promise<ScannedProjectFixture> {
  const alias = options.alias ?? "demo";
  const studioHome = tmpDir("patchbay-mcp-home-");
  const projectPath = tmpDir("patchbay-mcp-project-");

  fs.writeFileSync(path.join(projectPath, "README.md"), options.readmeContent ?? "hello from README\n");

  await registerProject(studioHome, { alias, kind: "local_repo", path: projectPath });

  const inferred = await scan(projectPath);
  await writeInferred(studioHome, alias, inferred);

  await writeOverlayIfAbsent(studioHome, alias);
  const overlay = await readOverlay(studioHome, alias);

  await writeAtlas(studioHome, alias, renderAtlas(inferred, overlay));
  const sections = computeAtlasSections(inferred, overlay);
  await writeAtlasDigest(studioHome, alias, renderAtlasDigest(computeAtlasCounts(sections)));
  await writeFlow(studioHome, alias, renderFlowFile(inferred, overlay));

  return { studioHome, alias, projectPath, inferred, overlay };
}

/** Registers a project but never scans it -- for "not yet scanned" error-path tests. */
export async function setupUnscannedProject(alias = "demo"): Promise<{ studioHome: string; projectPath: string }> {
  const studioHome = tmpDir("patchbay-mcp-home-");
  const projectPath = tmpDir("patchbay-mcp-project-");
  await registerProject(studioHome, { alias, kind: "local_repo", path: projectPath });
  return { studioHome, projectPath };
}

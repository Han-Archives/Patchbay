import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adoptIr,
  readOverlay,
  registerProject,
  scan,
  projectStudioDir,
  writeOverlayIfAbsent,
  writeScanOutputs,
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
  await writeOverlayIfAbsent(studioHome, alias);
  await writeScanOutputs(studioHome, alias, inferred);
  const overlay = await readOverlay(studioHome, alias);

  return { studioHome, alias, projectPath, inferred, overlay };
}

/**
 * A scanned project whose design has been adopted -- what `find_documents`
 * needs. The IR and its guide files are the fixed test material (명세 §8), copied
 * in so the project is self-contained: the acceptance run against a real repo is
 * held until the build is finished (사용자 결정 2026-09-28).
 */
export async function setupProjectWithAdoptedIr(alias = "demo"): Promise<ScannedProjectFixture> {
  const fixtureDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..", "..", "core", "src", "ir", "__fixtures__",
  );
  const fixture = await setupScannedProject({ alias });
  fs.cpSync(path.join(fixtureDir, "guides"), path.join(fixture.projectPath, "guides"), { recursive: true });
  fs.copyFileSync(
    path.join(fixtureDir, "valid.ir.yaml"),
    path.join(projectStudioDir(fixture.studioHome, alias), "ir.proposed.yaml"),
  );
  const adopted = await adoptIr(fixture.studioHome, alias, { docRoot: fixture.projectPath });
  if (!adopted.ok) throw new Error(`fixture: ir adopt failed -- ${adopted.error}`);
  return { ...fixture, overlay: await readOverlay(fixture.studioHome, alias) };
}

/** Registers a project but never scans it -- for "not yet scanned" error-path tests. */
export async function setupUnscannedProject(alias = "demo"): Promise<{ studioHome: string; projectPath: string }> {
  const studioHome = tmpDir("patchbay-mcp-home-");
  const projectPath = tmpDir("patchbay-mcp-project-");
  await registerProject(studioHome, { alias, kind: "local_repo", path: projectPath });
  return { studioHome, projectPath };
}

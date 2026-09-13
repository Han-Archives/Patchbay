import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { overlaySchema, type Overlay } from "../types/overlay.js";
import { inferredSchema, type Inferred } from "../types/inferred.js";
import { wireSchema, type Wire } from "../types/project.js";
import { projectStudioDir } from "./studioStore.js";

/**
 * Read/write helpers for a single registered project's studio-side file
 * tree (`<studioHome>/projects/<alias>/...`, spec Phase 3):
 *
 *   overlay.yaml       human-owned  -- created once if absent, never overwritten
 *   inferred.json      kernel-owned -- always overwritten wholesale by a scan
 *   ATLAS.md           kernel-owned -- always overwritten wholesale
 *   ATLAS.digest.md    kernel-owned -- always overwritten wholesale (L1, spec Phase 4)
 *   FLOW.md            kernel-owned -- always overwritten wholesale
 *
 * Kept in Core (not the CLI) for the same reason as `studioStore.ts`: MCP
 * will need to read these same files later.
 */

const OVERLAY_FILE_NAME = "overlay.yaml";
const INFERRED_FILE_NAME = "inferred.json";
const ATLAS_FILE_NAME = "ATLAS.md";
const ATLAS_DIGEST_FILE_NAME = "ATLAS.digest.md";
const FLOW_FILE_NAME = "FLOW.md";

function defaultOverlay(): Overlay {
  return overlaySchema.parse({ patches: [], wires: [], decisions: [], accepted_guides: [] });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Creates `<studioHome>/projects/<alias>/` if missing and returns its path. */
export async function ensureProjectDir(studioHome: string, alias: string): Promise<string> {
  const dir = projectStudioDir(studioHome, alias);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Writes a fresh, empty `overlay.yaml` for `alias` -- but only if one
 * doesn't already exist. `overlay.yaml` is human-owned; this must never
 * clobber an existing file.
 */
export async function writeOverlayIfAbsent(studioHome: string, alias: string): Promise<void> {
  const dir = await ensureProjectDir(studioHome, alias);
  const filePath = path.join(dir, OVERLAY_FILE_NAME);
  if (await fileExists(filePath)) return;
  await fs.writeFile(filePath, YAML.stringify(defaultOverlay()), "utf8");
}

/** Reads `overlay.yaml` for `alias`, or a fresh default `Overlay` if it doesn't exist yet. */
export async function readOverlay(studioHome: string, alias: string): Promise<Overlay> {
  const filePath = path.join(projectStudioDir(studioHome, alias), OVERLAY_FILE_NAME);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultOverlay();
    }
    throw error;
  }
  const parsed: unknown = YAML.parse(raw) ?? {};
  return overlaySchema.parse(parsed);
}

/** Overwrites `overlay.yaml` wholesale. Private -- unlike `writeOverlayIfAbsent`, this DOES clobber an existing file, so it's only used by explicit, validated CLI actions (`appendWire`) below, never by a scan. */
async function writeOverlay(studioHome: string, alias: string, overlay: Overlay): Promise<void> {
  const validated = overlaySchema.parse(overlay);
  const dir = await ensureProjectDir(studioHome, alias);
  await fs.writeFile(path.join(dir, OVERLAY_FILE_NAME), YAML.stringify(validated), "utf8");
}

/**
 * Appends `wire` to `alias`'s `overlay.yaml` and writes the whole file back.
 * `overlay.yaml` is human-owned in the sense that scans never touch it --
 * but an explicit CLI action like `patchbay patch` (spec Phase 5) is
 * exactly how it's meant to be modified. Validates `wire` with `wireSchema`
 * before writing anything. Returns the updated `Overlay`.
 */
export async function appendWire(studioHome: string, alias: string, wire: Wire): Promise<Overlay> {
  const validatedWire = wireSchema.parse(wire);
  const overlay = await readOverlay(studioHome, alias);
  const updated: Overlay = { ...overlay, wires: [...overlay.wires, validatedWire] };
  await writeOverlay(studioHome, alias, updated);
  return updated;
}

/** Overwrites `inferred.json` for `alias` wholesale (kernel-owned). */
export async function writeInferred(studioHome: string, alias: string, inferred: Inferred): Promise<void> {
  const validated = inferredSchema.parse(inferred);
  const dir = await ensureProjectDir(studioHome, alias);
  await fs.writeFile(path.join(dir, INFERRED_FILE_NAME), `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}

/** Reads `inferred.json` for `alias`. Throws if it hasn't been scanned yet. */
export async function readInferred(studioHome: string, alias: string): Promise<Inferred> {
  const filePath = path.join(projectStudioDir(studioHome, alias), INFERRED_FILE_NAME);
  const raw = await fs.readFile(filePath, "utf8");
  return inferredSchema.parse(JSON.parse(raw));
}

/** Overwrites `ATLAS.md` for `alias` wholesale. Returns the absolute path written. */
export async function writeAtlas(studioHome: string, alias: string, content: string): Promise<string> {
  const dir = await ensureProjectDir(studioHome, alias);
  const filePath = path.join(dir, ATLAS_FILE_NAME);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

/** Reads `ATLAS.md` for `alias`. Throws if it hasn't been generated yet. */
export async function readAtlas(studioHome: string, alias: string): Promise<string> {
  return fs.readFile(path.join(projectStudioDir(studioHome, alias), ATLAS_FILE_NAME), "utf8");
}

/** Overwrites `ATLAS.digest.md` (L1) for `alias` wholesale. Returns the absolute path written. */
export async function writeAtlasDigest(studioHome: string, alias: string, content: string): Promise<string> {
  const dir = await ensureProjectDir(studioHome, alias);
  const filePath = path.join(dir, ATLAS_DIGEST_FILE_NAME);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

/** Reads `ATLAS.digest.md` (L1) for `alias`. Throws if it hasn't been generated yet. */
export async function readAtlasDigest(studioHome: string, alias: string): Promise<string> {
  return fs.readFile(path.join(projectStudioDir(studioHome, alias), ATLAS_DIGEST_FILE_NAME), "utf8");
}

/** Overwrites `FLOW.md` for `alias` wholesale. Returns the absolute path written. */
export async function writeFlow(studioHome: string, alias: string, content: string): Promise<string> {
  const dir = await ensureProjectDir(studioHome, alias);
  const filePath = path.join(dir, FLOW_FILE_NAME);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

/** Reads `FLOW.md` for `alias`. Throws if it hasn't been generated yet. */
export async function readFlow(studioHome: string, alias: string): Promise<string> {
  return fs.readFile(path.join(projectStudioDir(studioHome, alias), FLOW_FILE_NAME), "utf8");
}

export function atlasPath(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), ATLAS_FILE_NAME);
}

export function atlasDigestPath(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), ATLAS_DIGEST_FILE_NAME);
}

export function flowPath(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), FLOW_FILE_NAME);
}

// --- Skill Bay / `patchbay patch` install (spec Phase 5) -------------------
//
// The Bay itself lives at `<studioHome>/skills/<slug>/` (empty until a
// later phase populates it, Phase 8). Nothing here reaches into
// `studioStore.ts` (out of scope this phase) -- these are plain path/fs
// helpers colocated here because this is the one other file new studio-side
// I/O is allowed to live in.

/** Absolute path to a Skill Bay package's directory: `<studioHome>/skills/<slug>/`. */
export function skillBayDir(studioHome: string, slug: string): string {
  return path.join(studioHome, "skills", slug);
}

/** True iff `<studioHome>/skills/<slug>/SKILL.md` exists -- i.e. the Bay actually has this skill. */
export async function skillPackageExists(studioHome: string, slug: string): Promise<boolean> {
  return fileExists(path.join(skillBayDir(studioHome, slug), "SKILL.md"));
}

export const SKILL_INSTALL_METHODS = ["symlink", "copy"] as const;
export type SkillInstallMethod = (typeof SKILL_INSTALL_METHODS)[number];

/**
 * Installs a Skill Bay package into a project by symlinking the whole
 * source directory (not just SKILL.md -- a package may carry other files
 * alongside it) to `<projectPath>/skills/<slug>/`. Falls back to a
 * recursive copy if the symlink call fails (cross-device link, permissions,
 * or anything else -- caught generically) and returns exactly which method
 * was used, so a caller can never accidentally record the wrong one.
 *
 * `symlinkFn` is an injectable seam (defaults to `fs.symlink`) so tests can
 * force the fallback path deterministically without needing a genuinely
 * different filesystem/device.
 */
export async function installSkillIntoProject(
  skillSourceDir: string,
  projectPath: string,
  slug: string,
  symlinkFn: (target: string, linkPath: string, type?: string) => Promise<void> = fs.symlink,
): Promise<SkillInstallMethod> {
  const skillsDir = path.join(projectPath, "skills");
  await fs.mkdir(skillsDir, { recursive: true });
  const targetDir = path.join(skillsDir, slug);

  try {
    await symlinkFn(skillSourceDir, targetDir, "dir");
    return "symlink";
  } catch {
    await fs.cp(skillSourceDir, targetDir, { recursive: true });
    return "copy";
  }
}

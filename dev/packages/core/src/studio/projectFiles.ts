import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { overlaySchema, type Overlay } from "../types/overlay.js";
import { inferredSchema, type Inferred } from "../types/inferred.js";
import { projectStudioDir } from "./studioStore.js";

/**
 * Read/write helpers for a single registered project's studio-side file
 * tree (`<studioHome>/projects/<alias>/...`, spec Phase 3):
 *
 *   overlay.yaml    human-owned  -- created once if absent, never overwritten
 *   inferred.json   kernel-owned -- always overwritten wholesale by a scan
 *   ATLAS.md        kernel-owned -- always overwritten wholesale
 *   FLOW.md         kernel-owned -- always overwritten wholesale
 *
 * Kept in Core (not the CLI) for the same reason as `studioStore.ts`: MCP
 * will need to read these same files later.
 */

const OVERLAY_FILE_NAME = "overlay.yaml";
const INFERRED_FILE_NAME = "inferred.json";
const ATLAS_FILE_NAME = "ATLAS.md";
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

export function flowPath(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), FLOW_FILE_NAME);
}

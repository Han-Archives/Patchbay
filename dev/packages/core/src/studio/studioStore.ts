import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CheckRepoActions, simpleGit } from "simple-git";
import YAML from "yaml";
import { studioSchema, type Studio, type StudioRegisteredProject } from "../types/studio.js";

/**
 * Studio-home persistence (spec Phase 3): everything that reads or writes
 * inside a "studio home" directory lives here, in Core -- never in the CLI
 * (or, later, the MCP server) directly. Both surfaces need the exact same
 * `studio.yaml` on disk, so the read/write/validate logic has exactly one
 * owner.
 */

const STUDIO_FILE_NAME = "studio.yaml";

/** `PATCHBAY_HOME` if set, else `~/.patchbay`. */
export function resolveStudioHome(): string {
  const fromEnv = process.env.PATCHBAY_HOME;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return path.join(os.homedir(), ".patchbay");
}

/**
 * Ensures `studioHome` exists on disk and is a git repository. Idempotent:
 * safe to call on an already-initialized studio home (no-op past the
 * directory-creation step, never re-inits or touches existing history).
 */
export async function ensureStudioInitialized(studioHome: string): Promise<void> {
  await fs.mkdir(studioHome, { recursive: true });

  const git = simpleGit(studioHome);
  const isRepo = await git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT).catch(() => false);
  if (!isRepo) {
    await git.init();
  }
}

function defaultStudio(): Studio {
  return studioSchema.parse({ name: os.hostname(), projects: [] });
}

function studioFilePath(studioHome: string): string {
  return path.join(studioHome, STUDIO_FILE_NAME);
}

/**
 * Reads and parses `studio.yaml`. A missing file is not an error -- it
 * means no studio has been initialized yet on disk, so a fresh default
 * `Studio` (no registered projects) is returned instead.
 */
export async function readStudio(studioHome: string): Promise<Studio> {
  let raw: string;
  try {
    raw = await fs.readFile(studioFilePath(studioHome), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultStudio();
    }
    throw error;
  }

  const parsed: unknown = YAML.parse(raw) ?? {};
  return studioSchema.parse(parsed);
}

/** Validates `studio` and writes it as `studio.yaml`, overwriting any existing file. */
export async function writeStudio(studioHome: string, studio: Studio): Promise<void> {
  const validated = studioSchema.parse(studio);
  await fs.mkdir(studioHome, { recursive: true });
  await fs.writeFile(studioFilePath(studioHome), YAML.stringify(validated), "utf8");
}

/** Thrown by `registerProject` when the given alias is already registered. */
export class ProjectAliasAlreadyRegisteredError extends Error {
  constructor(public readonly alias: string) {
    super(
      `A project with alias "${alias}" is already registered in this studio. ` +
        `Choose a different --alias, or remove the existing registration first.`,
    );
    this.name = "ProjectAliasAlreadyRegisteredError";
  }
}

/**
 * Reads the current studio, appends `project`, writes it back, and returns
 * the updated `Studio`. Rejects (throws `ProjectAliasAlreadyRegisteredError`)
 * rather than silently overwriting an existing registration under the same
 * alias.
 */
export async function registerProject(
  studioHome: string,
  project: StudioRegisteredProject,
): Promise<Studio> {
  const studio = await readStudio(studioHome);
  if (studio.projects.some((existing) => existing.alias === project.alias)) {
    throw new ProjectAliasAlreadyRegisteredError(project.alias);
  }

  const updated: Studio = { ...studio, projects: [...studio.projects, project] };
  await writeStudio(studioHome, updated);
  return updated;
}

/** Absolute path to a registered project's studio-side directory. */
export function projectStudioDir(studioHome: string, alias: string): string {
  return path.join(studioHome, "projects", alias);
}

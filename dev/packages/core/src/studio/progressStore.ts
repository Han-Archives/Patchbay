import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { progressSchema, type Progress, type ProgressEntry } from "../types/progress.js";
import { ensureProjectDir } from "./projectFiles.js";
import { projectStudioDir, readStudio } from "./studioStore.js";

/**
 * Read/write helpers for the progress surface (spec Phase 7, principle 10:
 * no watcher, no inference -- a human/skill explicitly calls `progress
 * write` with what's currently happening, and that one command call
 * regenerates every file below in the same process).
 *
 * Three kinds of file, all kernel-owned (nothing here is human-edited the
 * way `overlay.yaml` is):
 *
 *   <studioHome>/projects/<alias>/progress.yaml  -- structured Progress data
 *   <studioHome>/projects/<alias>/PROGRESS.md    -- that project's L2 view
 *   <studioHome>/progress.md                     -- studio-wide L1 rollup
 *                                                    across ALL registered
 *                                                    projects (spec 5.5) --
 *                                                    a studio-level file,
 *                                                    sibling to studio.yaml,
 *                                                    not inside a
 *                                                    projects/<alias>/ dir.
 *
 * Kept in Core (not the CLI/MCP) for the same reason as `projectFiles.ts`:
 * both surfaces need the exact same on-disk shape.
 */

const PROGRESS_FILE_NAME = "progress.yaml";
const PROGRESS_MD_FILE_NAME = "PROGRESS.md";
const STUDIO_PROGRESS_MD_FILE_NAME = "progress.md";

function defaultProgress(): Progress {
  return progressSchema.parse({ current: null, history: [] });
}

function progressFilePath(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), PROGRESS_FILE_NAME);
}

function studioProgressRollupPath(studioHome: string): string {
  return path.join(studioHome, STUDIO_PROGRESS_MD_FILE_NAME);
}

/** Reads `progress.yaml` for `alias`, or a fresh default `Progress` (`{current: null, history: []}`) if it doesn't exist yet -- same "missing file is not an error" pattern as `readOverlay`. */
export async function readProgress(studioHome: string, alias: string): Promise<Progress> {
  let raw: string;
  try {
    raw = await fs.readFile(progressFilePath(studioHome, alias), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultProgress();
    }
    throw error;
  }
  const parsed: unknown = YAML.parse(raw) ?? {};
  return progressSchema.parse(parsed);
}

/** Overwrites `progress.yaml` for `alias` wholesale. Private -- only ever called from `writeProgressEntry` below, which is the sole way `progress.yaml`'s content is meant to change. */
async function writeProgress(studioHome: string, alias: string, progress: Progress): Promise<void> {
  const validated = progressSchema.parse(progress);
  const dir = await ensureProjectDir(studioHome, alias);
  await fs.writeFile(path.join(dir, PROGRESS_FILE_NAME), YAML.stringify(validated), "utf8");
}

/**
 * Records a new "current" progress entry for `alias` and writes
 * `progress.yaml` back. `entry`'s `skill`/`step`/`summary` come only from
 * the caller's explicit arguments (CLI/MCP) -- never inferred from git
 * activity or file changes (spec anomaly warning: "커널은 현재 작업을
 * 추론하지 않는다. yaml의 current는 이 명령의 인자에서만 온다"). The
 * `timestamp` is generated here mechanically (`new Date().toISOString()`)
 * -- that's just a stamp on the caller-provided content, not the kernel
 * guessing what's being worked on.
 *
 * The previous `current` (if any) is moved onto the *front* of `history`
 * (most-recent-first ordering, kept consistent by every later push landing
 * at index 0 too -- `renderProgressMd`/`renderStudioProgressRollup` rely on
 * this ordering to show the newest history entry first without needing to
 * re-sort).
 */
export async function writeProgressEntry(
  studioHome: string,
  alias: string,
  entry: { skill?: string; step?: string; summary: string },
): Promise<Progress> {
  const progress = await readProgress(studioHome, alias);
  const history = progress.current ? [progress.current, ...progress.history] : progress.history;

  const newEntry: ProgressEntry = {
    project: alias,
    skill: entry.skill,
    step: entry.step,
    summary: entry.summary,
    timestamp: new Date().toISOString(),
  };

  const updated: Progress = { current: newEntry, history };
  await writeProgress(studioHome, alias, updated);
  return updated;
}

/**
 * Raw `progress.yaml` text for `alias` (for level-3 exposure) -- either the
 * file's actual on-disk bytes, or a re-serialized fresh default `Progress`
 * if it doesn't exist yet, so this never throws for an otherwise-registered
 * project (mirrors `readProgress`'s own default-on-missing behavior rather
 * than `readAtlas`'s throw-on-missing one, since "no progress recorded yet"
 * is the normal starting state for a progress.yaml, not an error).
 */
export async function readProgressRaw(studioHome: string, alias: string): Promise<string> {
  try {
    return await fs.readFile(progressFilePath(studioHome, alias), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return YAML.stringify(defaultProgress());
    }
    throw error;
  }
}

/** Overwrites a project's `PROGRESS.md` (L2) wholesale. Kernel-owned, mirrors `writeAtlas` exactly. Returns the absolute path written. */
export async function writeProgressMd(studioHome: string, alias: string, content: string): Promise<string> {
  const dir = await ensureProjectDir(studioHome, alias);
  const filePath = path.join(dir, PROGRESS_MD_FILE_NAME);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

/** Reads a project's `PROGRESS.md`. Throws if it hasn't been generated yet (i.e. `progress write` has never been called for this alias) -- mirrors `readAtlas`. */
export async function readProgressMd(studioHome: string, alias: string): Promise<string> {
  return fs.readFile(path.join(projectStudioDir(studioHome, alias), PROGRESS_MD_FILE_NAME), "utf8");
}

/**
 * Reads every registered project's `Progress`, sorted by alias ascending
 * for determinism. Used to build the studio-wide rollup
 * (`renderStudioProgressRollup`) -- a project that's never had `progress
 * write` called for it still shows up here with the default empty
 * `Progress` (`readProgress`'s own default-on-missing behavior), so the
 * rollup can show it as idle rather than omitting it.
 */
export async function readAllProjectsProgress(
  studioHome: string,
): Promise<{ alias: string; progress: Progress }[]> {
  const studio = await readStudio(studioHome);
  const aliases = studio.projects.map((project) => project.alias).sort((a, b) => a.localeCompare(b));

  const results: { alias: string; progress: Progress }[] = [];
  for (const alias of aliases) {
    results.push({ alias, progress: await readProgress(studioHome, alias) });
  }
  return results;
}

/** Overwrites the studio-wide `<studioHome>/progress.md` rollup wholesale. Kernel-owned, mirrors `writeAtlas`. Returns the absolute path written. */
export async function writeStudioProgressRollup(studioHome: string, content: string): Promise<string> {
  await fs.mkdir(studioHome, { recursive: true });
  const filePath = studioProgressRollupPath(studioHome);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

/** Reads the studio-wide `<studioHome>/progress.md` rollup. Throws if it hasn't been generated yet (i.e. `progress write` has never been called for any project in this studio). */
export async function readStudioProgressRollup(studioHome: string): Promise<string> {
  return fs.readFile(studioProgressRollupPath(studioHome), "utf8");
}

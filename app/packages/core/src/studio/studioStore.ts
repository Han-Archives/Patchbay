import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CheckRepoActions, simpleGit } from "simple-git";
import YAML from "yaml";
import { randomUUID } from "node:crypto";
import { withFileLock } from "../rooms/store.js";
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

/** `requireStudioHome` 이 멈출 때 — 작업 공간 위치가 틀렸거나 아직 만들지 않았다. */
export class StudioHomeMissingError extends Error {
  constructor(public readonly studioHome: string, reason: string) {
    super(
      `작업 공간을 열 수 없다: ${studioHome} (${reason}). PATCHBAY_HOME 이 맞는지 보고, 새로 만들 때만 \`patchbay init\` 을 쓴다.`,
    );
    this.name = "StudioHomeMissingError";
  }
}

/**
 * 작업 공간 열기 — 유효한 `studio.yaml` 이 있는 곳만 연다 (저장구조.md 3절, 2026-10-14).
 * `readStudio` 는 파일이 없으면 빈 작업 공간을 돌려주고 쓰기 함수들은 폴더를 새로 만들기 때문에,
 * 위치가 틀리면 아무도 모르게 빈 작업 공간이 하나 더 생긴다. 콘솔 · MCP · CLI 의 입구에서 이것을
 * 먼저 부른다. 새로 만드는 명령(`init` · `project add` · `project new`)만 예외다.
 */
export function requireStudioHome(studioHome: string = resolveStudioHome()): string {
  let raw: string;
  try {
    raw = readFileSync(studioFilePath(studioHome), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new StudioHomeMissingError(studioHome, "studio.yaml 없음");
    throw error;
  }
  const parsed = studioSchema.safeParse(YAML.parse(raw) ?? {});
  if (!parsed.success) throw new StudioHomeMissingError(studioHome, "studio.yaml 형식 오류");
  return studioHome;
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
  const file = studioFilePath(studioHome);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, YAML.stringify(validated), { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
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
  await fs.mkdir(studioHome, { recursive: true });
  return withFileLock(studioFilePath(studioHome), async () => {
    const studio = await readStudio(studioHome);
    if (studio.projects.some((existing) => existing.alias === project.alias)) {
      throw new ProjectAliasAlreadyRegisteredError(project.alias);
    }

    const updated: Studio = { ...studio, projects: [...studio.projects, project] };
    await writeStudio(studioHome, updated);
    return updated;
  });
}

/**
 * 콘솔 레일에서 프로젝트를 숨기거나 다시 보인다. 등록 · 파일은 그대로 둔다 — 숨김은 보기의
 * 일이지 삭제가 아니다 (원칙 16). 없는 alias는 거절한다.
 */
export async function setProjectHidden(studioHome: string, alias: string, hidden: boolean): Promise<Studio> {
  return withFileLock(studioFilePath(studioHome), async () => {
    const studio = await readStudio(studioHome);
    if (!studio.projects.some((project) => project.alias === alias)) {
      throw new Error(`No project registered with alias "${alias}".`);
    }
    const projects = studio.projects.map((project) => {
      if (project.alias !== alias) return project;
      const { hidden: _drop, ...rest } = project;
      return hidden ? { ...rest, hidden: true } : rest;
    });
    const updated: Studio = { ...studio, projects };
    await writeStudio(studioHome, updated);
    return updated;
  });
}

export class ProjectRenameError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 | 500) {
    super(message);
    this.name = "ProjectRenameError";
  }
}

function containsPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/** 표시 이름과 실제 레포 폴더를 함께 바꾼다. alias와 작업 공간 기록의 주소는 유지한다. */
export async function renameProject(
  studioHome: string,
  alias: string,
  rawName: string,
  options: { protectedPaths?: string[]; isBusy?: (alias: string) => boolean } = {},
): Promise<{ project: StudioRegisteredProject; previousPath: string; affectedAliases: string[] }> {
  const name = rawName.trim().normalize("NFC");
  if (!name || name === "." || name === ".." || /[\\/\x00-\x1f\x7f:*?"<>|]/.test(name) || /[. ]$/.test(name) || Buffer.byteLength(name) > 240) {
    throw new ProjectRenameError("폴더 이름으로 사용할 수 있는 프로젝트 이름을 입력해 주세요.", 400);
  }
  return withFileLock(studioFilePath(studioHome), async () => {
    const studio = await readStudio(studioHome);
    const project = studio.projects.find(item => item.alias === alias);
    if (!project) throw new ProjectRenameError("등록된 프로젝트가 아닙니다.", 404);
    const previousPath = path.resolve(project.path);
    const stat = await fs.lstat(previousPath).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new ProjectRenameError("실제 프로젝트 폴더를 찾을 수 없습니다.", 400);
    const source = await fs.realpath(previousPath);
    const destination = path.join(path.dirname(source), name);
    const moving = source !== destination;
    const paths = await Promise.all(studio.projects.map(async item => ({ item, actual: await fs.realpath(item.path).catch(() => path.resolve(item.path)) })));
    const affected = paths.filter(({ actual }) => containsPath(source, actual));
    const affectedAliases = affected.map(({ item }) => item.alias);
    if (affectedAliases.some(id => options.isBusy?.(id))) throw new ProjectRenameError("실행 중인 작업이 끝난 뒤 이름을 변경해 주세요.", 409);
    if (moving) {
      for (const protectedPath of [studioHome, process.cwd(), ...(options.protectedPaths ?? [])]) {
        const actual = await fs.realpath(protectedPath).catch(() => path.resolve(protectedPath));
        if (containsPath(source, actual)) throw new ProjectRenameError("실행 중인 Patchbay 또는 작업 공간을 포함한 폴더는 이름을 변경할 수 없습니다.", 409);
      }
      const existing = await fs.lstat(destination).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
      if (existing && (existing.ino !== stat.ino || existing.dev !== stat.dev)) throw new ProjectRenameError("같은 이름의 폴더가 이미 있습니다. 다른 이름을 입력해 주세요.", 409);
    }
    const projects = studio.projects.map(item => {
      const linked = affected.find(row => row.item.alias === item.alias);
      return {
        ...item,
        ...(linked ? { path: path.join(destination, path.relative(source, linked.actual)) } : {}),
        ...(item.alias === alias ? { name } : {}),
      };
    });
    let moved = false;
    try {
      if (affectedAliases.some(id => options.isBusy?.(id))) throw new ProjectRenameError("실행 중인 작업이 끝난 뒤 이름을 변경해 주세요.", 409);
      if (moving) { await fs.rename(source, destination); moved = true; }
      await writeStudio(studioHome, { ...studio, projects });
    } catch (error) {
      if (moved) {
        try {
          const occupied = await fs.lstat(source).then(() => true, (reason: NodeJS.ErrnoException) => { if (reason.code === "ENOENT") return false; throw reason; });
          if (occupied) throw new Error("원래 경로가 사용 중입니다.");
          await fs.rename(destination, source);
        }
        catch { throw new ProjectRenameError(`이름 저장과 폴더 복구에 실패했습니다. 현재 폴더 위치를 확인해 주세요: ${destination}`, 500); }
      }
      if (error instanceof ProjectRenameError) throw error;
      throw new ProjectRenameError("폴더 이름을 변경하지 못했습니다. 폴더 권한과 사용 중인 프로그램을 확인해 주세요.", 400);
    }
    return { project: projects.find(item => item.alias === alias)!, previousPath, affectedAliases };
  });
}

/** Absolute path to a registered project's studio-side directory. */
export function projectStudioDir(studioHome: string, alias: string): string {
  return path.join(studioHome, "projects", alias);
}

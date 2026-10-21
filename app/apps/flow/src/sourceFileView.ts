import fs from "node:fs/promises";
import path from "node:path";
import { classifyPath, isSecret, readStudio, SENSITIVITY_LABELS } from "@patchbay/core";

export const SOURCE_FILE_MAX_BYTES = 256 * 1024;

export type SourceFileResult =
  | { ok: true; status: 200; body: Record<string, unknown> }
  | { ok: false; status: 400 | 403 | 404 | 413 | 415; error: string };

export function normalizeProjectRelPath(raw: string): string | null {
  const trimmed = raw.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.startsWith("/") || trimmed.includes("\0")) return null;
  const parts = trimmed.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === "..")) return null;
  return parts.join("/");
}

function unknownAliasError(alias: string, known: string[]): string {
  return (
    `No project registered with alias "${alias}". ` +
    (known.length > 0
      ? `Registered aliases: ${known.join(", ")}.`
      : `No projects are registered yet -- run "patchbay project add --path <path>" first.`)
  );
}

function isInsideRoot(root: string, candidate: string): boolean {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  return target === base || target.startsWith(base + path.sep);
}

async function resolveInsideProject(
  studioHome: string,
  alias: string | undefined,
  relRaw: string | undefined,
): Promise<
  | { ok: true; alias: string; rel: string; abs: string; root: string }
  | { ok: false; status: 400 | 403 | 404; error: string }
> {
  if (!alias) {
    return { ok: false, status: 400, error: "source: alias is required." };
  }
  const rel = relRaw ? normalizeProjectRelPath(relRaw) : null;
  if (!rel) {
    return { ok: false, status: 400, error: "source: path must be a relative file inside the project." };
  }

  // Ahead of every filesystem call, so refusing a secret never opens it. Both
  // reading and saving come through here -- `.env` was previously served, and
  // written, verbatim.
  const verdict = classifyPath(rel);
  if (isSecret(verdict.level)) {
    return {
      ok: false,
      status: 403,
      error: `source: "${rel}" 는 비밀 등급(L${verdict.level} ${SENSITIVITY_LABELS[verdict.level]})이라 열지 않습니다 — ${verdict.reason}.`,
    };
  }

  const studio = await readStudio(studioHome);
  const registered = studio.projects.find((project) => project.alias === alias);
  if (!registered) {
    return { ok: false, status: 404, error: unknownAliasError(alias, studio.projects.map((project) => project.alias)) };
  }

  const root = path.resolve(registered.path);
  const abs = path.resolve(root, rel);
  if (!isInsideRoot(root, abs)) {
    return { ok: false, status: 403, error: "source: path is outside the project." };
  }
  return { ok: true, alias, rel, abs, root };
}

export async function loadSourceFile(
  studioHome: string,
  alias: string | undefined,
  relRaw: string | undefined,
): Promise<SourceFileResult> {
  const resolved = await resolveInsideProject(studioHome, alias, relRaw);
  if (!resolved.ok) return resolved;

  let stat;
  try {
    stat = await fs.stat(resolved.abs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, status: 404, error: `source: file not found: ${resolved.rel}` };
    }
    throw error;
  }
  if (stat.isDirectory()) {
    return { ok: false, status: 400, error: "source: folders cannot be opened." };
  }
  if (stat.size > SOURCE_FILE_MAX_BYTES) {
    return { ok: false, status: 413, error: `source: file is larger than ${SOURCE_FILE_MAX_BYTES} bytes.` };
  }

  const realRoot = await fs.realpath(resolved.root);
  const realFile = await fs.realpath(resolved.abs);
  if (!isInsideRoot(realRoot, realFile)) {
    return { ok: false, status: 403, error: "source: path is outside the project." };
  }

  const buffer = await fs.readFile(realFile);
  if (buffer.includes(0)) {
    return { ok: false, status: 415, error: "source: binary files cannot be opened." };
  }
  return {
    ok: true,
    status: 200,
    body: { alias: resolved.alias, path: resolved.rel, content: buffer.toString("utf8"), bytes: buffer.length },
  };
}

export async function saveSourceFile(
  studioHome: string,
  payload: Record<string, unknown>,
): Promise<SourceFileResult> {
  const alias = typeof payload.alias === "string" ? payload.alias : undefined;
  const relRaw = typeof payload.path === "string" ? payload.path : undefined;
  if (typeof payload.content !== "string") {
    return { ok: false, status: 400, error: "source: content must be a string." };
  }
  if (Buffer.byteLength(payload.content, "utf8") > SOURCE_FILE_MAX_BYTES) {
    return { ok: false, status: 413, error: `source: file is larger than ${SOURCE_FILE_MAX_BYTES} bytes.` };
  }

  const resolved = await resolveInsideProject(studioHome, alias, relRaw);
  if (!resolved.ok) return resolved;

  let stat;
  try {
    stat = await fs.stat(resolved.abs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, status: 404, error: `source: file not found: ${resolved.rel}` };
    }
    throw error;
  }
  if (stat.isDirectory()) {
    return { ok: false, status: 400, error: "source: folders cannot be opened." };
  }

  const realRoot = await fs.realpath(resolved.root);
  const realFile = await fs.realpath(resolved.abs);
  if (!isInsideRoot(realRoot, realFile)) {
    return { ok: false, status: 403, error: "source: path is outside the project." };
  }

  await fs.writeFile(realFile, payload.content, "utf8");
  return {
    ok: true,
    status: 200,
    body: { alias: resolved.alias, path: resolved.rel, saved: true, bytes: Buffer.byteLength(payload.content, "utf8") },
  };
}

/**
 * 대화방 · 상담 창의 링크가 여는 파일 (사용자 요청 2026-10-16: 시안 · 산출물을 링크로 보고 받기).
 * `loadSourceFile` 은 편집기용이라 글자만 JSON 으로 준다. 여기는 파일을 그대로 내준다 — 이미지 · PDF · 시안 HTML.
 */
export const PROJECT_FILE_MAX_BYTES = 50 * 1024 * 1024;

const PROJECT_FILE_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".pdf": "application/pdf", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".woff2": "font/woff2", ".woff": "font/woff",
};

export type ProjectFileResult =
  | { ok: true; rel: string; data: Buffer; contentType: string }
  | { ok: false; status: 400 | 403 | 404 | 413; error: string };

/**
 * 답에 적힌 절대 경로를 프로젝트 안 상대 경로로 바꾼다. 상대 경로로 옮겨 열어야 시안 HTML 의
 * `style.css` 같은 옆 파일 참조가 같은 길로 풀린다. 프로젝트 밖이면 null.
 */
export async function projectRelFromAbsolute(studioHome: string, alias: string, abs: string): Promise<string | null> {
  const studio = await readStudio(studioHome);
  const registered = studio.projects.find((project) => project.alias === alias);
  if (!registered) return null;
  const root = path.resolve(registered.path);
  const target = path.resolve(abs);
  if (target === root || !isInsideRoot(root, target)) return null;
  return path.relative(root, target).split(path.sep).join("/");
}

export async function loadProjectFile(
  studioHome: string,
  alias: string | undefined,
  relRaw: string | undefined,
): Promise<ProjectFileResult> {
  const resolved = await resolveInsideProject(studioHome, alias, relRaw);
  if (!resolved.ok) return resolved;
  let realFile;
  try {
    realFile = await fs.realpath(resolved.abs);
  } catch {
    return { ok: false, status: 404, error: `파일이 없다: ${resolved.rel}` };
  }
  if (!isInsideRoot(await fs.realpath(resolved.root), realFile)) {
    return { ok: false, status: 403, error: "프로젝트 밖의 파일이다." };
  }
  const stat = await fs.stat(realFile);
  if (stat.isDirectory()) return { ok: false, status: 400, error: "폴더는 열지 않는다." };
  if (stat.size > PROJECT_FILE_MAX_BYTES) return { ok: false, status: 413, error: "50MB 보다 큰 파일이다." };
  const data = await fs.readFile(realFile);
  const known = PROJECT_FILE_TYPES[path.extname(realFile).toLowerCase()];
  // 모르는 확장자는 글자면 글로 보여 주고, 아니면 받게 한다.
  const contentType = known ?? (data.includes(0) ? "application/octet-stream" : "text/plain; charset=utf-8");
  return { ok: true, rel: resolved.rel, data, contentType };
}

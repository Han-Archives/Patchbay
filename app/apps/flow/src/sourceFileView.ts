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

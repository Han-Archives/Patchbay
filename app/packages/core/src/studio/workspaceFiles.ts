import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import YAML from "yaml";
import { classifyPath, isSecret } from "../sensitivity/sensitivity.js";
import { withFileLock } from "../rooms/store.js";
import { projectStudioDir, readStudio } from "./studioStore.js";

/**
 * 「폴더 · 문서」 편집기 — 그 프로젝트의 기록 폴더(`projects/<alias>/`)만 보고 고친다
 * (사용자 결정 2026-10-16: 편집기형, 루트는 기록 폴더, 다른 프로젝트는 보이지 않는다).
 *
 * 편집 등급: edit 은 고칠 수 있고 저장할 때 형식(JSON · YAML)과 내용 해시를 확인한다.
 * auto 는 다시 만들면 덮어쓰는 파일, live 는 지금도 덧붙여지는 파일 — 둘 다 읽기만 한다.
 */
export type WorkspaceFileGrade = "edit" | "auto" | "live";

export const WORKSPACE_FILE_MAX_BYTES = 256 * 1024;

const AUTO_FILES = new Set(["ATLAS.md", "ATLAS.digest.md", "FLOW.md", "inferred.json", "PROGRESS.md"]);
const AUTO_DIRS = ["log/index/", "log/records/", "log/summaries/"];
const LIVE_DIRS = ["chats/", "rooms/", "log/events/", "consult/", "threads/", "test-runs/", "knowledge/"];

export function workspaceFileGrade(rel: string): WorkspaceFileGrade {
  if (rel.endsWith(".jsonl") || LIVE_DIRS.some((dir) => rel.startsWith(dir))) return "live";
  if (AUTO_FILES.has(rel) || AUTO_DIRS.some((dir) => rel.startsWith(dir))) return "auto";
  return "edit";
}

/** Patchbay 가 아는 파일 · 폴더의 한 줄 설명. 모르면 빈 글자. */
const NOTES: Record<string, string> = {
  "": "Patchbay가 이 프로젝트에 대해 쌓는 기록. 대화 · Log · 진행 · 할 일 · 스캔 결과가 여기 있다. 코드와 문서는 여기 없다.",
  chats: "대화방마다 두 파일: 말 기록(.jsonl)과 방 정보(.meta.json). 대화가 진행되는 동안 계속 쓰인다.",
  rooms: "대화방의 옛 폴더. 콘솔 서버를 다시 켜면 chats/로 옮겨진다.",
  log: "Log 화면의 원재료와 결과. 사건 · 달 목록 · 하루 기록.",
  "log/events": "Log의 원재료. 파일이 바뀔 때마다 한 줄씩 붙는다.",
  "log/index": "달마다 한 파일. 달력에서 그 달을 열면 다시 만든다.",
  "log/records": "하루에 한 파일. Log 화면이 사건과 진행 보고로 만든다.",
  "log/summaries": "하루 기록을 로컬 LLM이 줄인 글.",
  "log/reports": "Log 보고서 바탕 — 사람이 고쳐 쓴다.",
  "todo-history": "끝난 할 일마다 한 폴더. 요약과 그 할 일을 다룬 대화 사본.",
  consult: "설계 상담 기록. 상담이 진행되는 동안 계속 쓰인다.",
  threads: "실행 스레드 기록.",
  "test-runs": "시험 실행 기록.",
  refs: "설계가 기대는 참고 자료 원본.",
  knowledge: "선택한 지식 자료의 원문 버전과 근거 검토 기록. 근거 검토 화면에서 고친다.",
  "knowledge/semantic.json": "A+B·RAG 공유 원문 버전 · 개체 · 인용 · 검토 · 검색/그래프 사용과 외부 전달 설정. 커널만 저장한다.",
  "knowledge/rag-deliveries.jsonl": "RAG 모델 실행 요청·결과의 자료/버전 식별자 기록. 질문·발췌·답변 본문은 기록하지 않는다.",
  "agents.json": "에이전트 배치 — 역할과 모델",
  "ATLAS.md": "스캔 결과 — 스킬 · 규칙 · 설정 목록. 스캔할 때마다 다시 만든다",
  "ATLAS.digest.md": "스캔 요약 한 단락 — 스캔할 때마다 다시 만든다",
  "FLOW.md": "흐름 요약 — 스캔할 때마다 다시 만든다",
  "inferred.json": "스캔이 추론한 연결 — 스캔할 때마다 다시 만든다",
  "board.yaml": "대시보드 판 — 칸 배치와 내용",
  "cycle-items.json": "흐름도 세부 항목 — 에이전트가 계획을 남긴다",
  "DASHBOARD.proposed.md": "대시보드 초안 — 스킬이 쓰고 사람이 고쳐 확정한다",
  "overlay.yaml": "결정 기록 — patchbay decision add가 쓴다",
  "PROGRESS.md": "진행 기록 읽기용 — progress.yaml에서 다시 만든다",
  "progress.yaml": "진행 기록 원본 — 요구 · 구현이 여기 쌓인다",
  "todos.json": "할 일 목록 — 에이전트가 차례 끝마다 고친다",
  "ir.proposed.yaml": "설계 초안(IR) — 상담과 PRD 검토가 채운다",
  "ir.requirement-review.json": "요구사항 검토 — 확정 · 보류 · 변경 이력",
  "ir.yaml": "채택한 설계(IR)",
};

export function workspaceFileNote(rel: string): string {
  if (NOTES[rel] !== undefined) return NOTES[rel]!;
  if (/^(chats|rooms)\/[^/]+\.jsonl$/.test(rel)) return "대화방 기록 — 한 줄이 말 하나";
  if (/^(chats|rooms)\/[^/]+\.meta\.json$/.test(rel)) return "대화방 정보 — 제목 · 참여 에이전트 · 차례 상태";
  if (/^log\/records\/[^/]+\.md$/.test(rel)) return "하루 Log — Log 화면이 그 날 기록으로 만든다";
  if (/^log\/index\/[^/]+\.json$/.test(rel)) return "달 목록 — 달력에서 그 달을 열 때 만든다";
  if (/^todo-history\/[^/]+\/summary\.md$/.test(rel)) return "끝난 할 일 하나의 요약";
  if (/^todo-history\/[^/]+$/.test(rel)) return "끝난 할 일 하나";
  return "";
}

export interface WorkspaceEntry {
  name: string;
  path: string;
  dir: boolean;
  bytes: number;
  mtimeMs: number;
  /** 폴더면 바로 아래 항목 수. */
  count?: number;
  grade?: WorkspaceFileGrade;
  secret?: boolean;
  note: string;
}

export interface WorkspaceDirSummary {
  folders: number;
  files: number;
  /** 아래 전체 파일 수 · 가장 최근 수정 · 등급별 수. */
  total: number;
  latestMs: number;
  grades: Record<WorkspaceFileGrade, number>;
}

export type WorkspaceFileResult<T> =
  | { ok: true; body: T }
  | { ok: false; status: 400 | 403 | 404 | 409 | 413 | 415; error: string; hash?: string };

export function workspaceContentHash(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

/** 쓰는 도중의 잠금 · 임시 파일은 보이지 않는다. */
function hiddenName(name: string): boolean {
  return name.endsWith(".lock") || name.endsWith(".tmp") || name === ".DS_Store";
}

function normalizeRel(raw: string | undefined, allowRoot: boolean): string | null {
  const trimmed = (raw ?? "").trim().replace(/\\/g, "/");
  if (trimmed.startsWith("/") || trimmed.includes("\0")) return null;
  const parts = trimmed.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === "..")) return null;
  if (parts.length === 0) return allowRoot ? "" : null;
  return parts.join("/");
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

async function resolve(
  studioHome: string,
  alias: string | undefined,
  relRaw: string | undefined,
  allowRoot: boolean,
): Promise<{ ok: true; root: string; rel: string; abs: string } | { ok: false; status: 400 | 403 | 404; error: string }> {
  if (!alias) return { ok: false, status: 400, error: "alias 가 필요하다." };
  const rel = normalizeRel(relRaw, allowRoot);
  if (rel === null) return { ok: false, status: 400, error: "경로는 기록 폴더 안의 상대 경로여야 한다." };
  if (rel && isSecret(classifyPath(rel).level)) return { ok: false, status: 403, error: `"${rel}" 는 비밀 파일이라 열지 않는다.` };
  const studio = await readStudio(studioHome);
  if (!studio.projects.some((project) => project.alias === alias)) {
    return { ok: false, status: 404, error: `등록된 프로젝트가 아니다: ${alias}` };
  }
  const root = path.resolve(projectStudioDir(studioHome, alias));
  const abs = path.resolve(root, rel);
  if (!isInside(root, abs)) return { ok: false, status: 403, error: "기록 폴더 밖이다." };
  return { ok: true, root, rel, abs };
}

/** 실제 경로(링크를 따라간 곳)도 기록 폴더 안이어야 한다. 없으면 null. */
async function realInside(root: string, abs: string): Promise<string | null | false> {
  try {
    const [realRoot, real] = await Promise.all([fs.realpath(root), fs.realpath(abs)]);
    return isInside(realRoot, real) ? real : false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function summarize(dir: string, base: string): Promise<WorkspaceDirSummary> {
  const summary: WorkspaceDirSummary = { folders: 0, files: 0, total: 0, latestMs: 0, grades: { edit: 0, auto: 0, live: 0 } };
  async function walk(current: string, rel: string, top: boolean): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (hiddenName(entry.name) || entry.isSymbolicLink()) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (top) summary.folders++;
        await walk(path.join(current, entry.name), childRel, false);
      } else if (entry.isFile()) {
        if (top) summary.files++;
        summary.total++;
        summary.grades[workspaceFileGrade(childRel)]++;
        const stat = await fs.stat(path.join(current, entry.name));
        summary.latestMs = Math.max(summary.latestMs, stat.mtimeMs);
      }
    }
  }
  await walk(dir, base, true);
  return summary;
}

export async function listWorkspaceDir(
  studioHome: string,
  alias: string | undefined,
  dirRaw: string | undefined,
): Promise<WorkspaceFileResult<{ alias: string; dir: string; note: string; entries: WorkspaceEntry[]; summary: WorkspaceDirSummary }>> {
  const resolved = await resolve(studioHome, alias, dirRaw, true);
  if (!resolved.ok) return resolved;
  const real = await realInside(resolved.root, resolved.abs);
  if (real === false) return { ok: false, status: 403, error: "기록 폴더 밖이다." };
  const empty: WorkspaceDirSummary = { folders: 0, files: 0, total: 0, latestMs: 0, grades: { edit: 0, auto: 0, live: 0 } };
  if (real === null) {
    if (resolved.rel) return { ok: false, status: 404, error: `폴더가 없다: ${resolved.rel}` };
    return { ok: true, body: { alias: alias!, dir: "", note: workspaceFileNote(""), entries: [], summary: empty } };
  }
  if (!(await fs.stat(real)).isDirectory()) return { ok: false, status: 400, error: "폴더가 아니다." };

  const entries: WorkspaceEntry[] = [];
  for (const entry of await fs.readdir(real, { withFileTypes: true })) {
    if (hiddenName(entry.name) || entry.isSymbolicLink()) continue;
    if (!entry.isDirectory() && !entry.isFile()) continue;
    const rel = resolved.rel ? `${resolved.rel}/${entry.name}` : entry.name;
    const stat = await fs.stat(path.join(real, entry.name));
    if (entry.isDirectory()) {
      const count = (await fs.readdir(path.join(real, entry.name))).filter((name) => !hiddenName(name)).length;
      entries.push({ name: entry.name, path: rel, dir: true, bytes: 0, mtimeMs: stat.mtimeMs, count, note: workspaceFileNote(rel) });
    } else {
      const secret = isSecret(classifyPath(rel).level);
      entries.push({
        name: entry.name, path: rel, dir: false, bytes: stat.size, mtimeMs: stat.mtimeMs,
        grade: workspaceFileGrade(rel), ...(secret ? { secret } : {}), note: workspaceFileNote(rel),
      });
    }
  }
  entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, "ko", { sensitivity: "base" }));
  return {
    ok: true,
    body: { alias: alias!, dir: resolved.rel, note: workspaceFileNote(resolved.rel), entries, summary: await summarize(real, resolved.rel) },
  };
}

export interface WorkspaceFileBody {
  alias: string;
  path: string;
  content: string;
  bytes: number;
  mtimeMs: number;
  hash: string;
  grade: WorkspaceFileGrade;
  note: string;
}

export async function loadWorkspaceFile(
  studioHome: string,
  alias: string | undefined,
  relRaw: string | undefined,
): Promise<WorkspaceFileResult<WorkspaceFileBody>> {
  const resolved = await resolve(studioHome, alias, relRaw, false);
  if (!resolved.ok) return resolved;
  const real = await realInside(resolved.root, resolved.abs);
  if (real === false) return { ok: false, status: 403, error: "기록 폴더 밖이다." };
  if (real === null) return { ok: false, status: 404, error: `파일이 없다: ${resolved.rel}` };
  const stat = await fs.stat(real);
  if (stat.isDirectory()) return { ok: false, status: 400, error: "폴더는 파일로 열지 않는다." };
  if (stat.size > WORKSPACE_FILE_MAX_BYTES) return { ok: false, status: 413, error: `${Math.round(WORKSPACE_FILE_MAX_BYTES / 1024)}KB보다 큰 파일이라 미리보기가 없다.` };
  const buffer = await fs.readFile(real);
  if (buffer.includes(0)) return { ok: false, status: 415, error: "글자 파일이 아니라 미리보기가 없다." };
  return {
    ok: true,
    body: {
      alias: alias!, path: resolved.rel, content: buffer.toString("utf8"), bytes: buffer.length, mtimeMs: stat.mtimeMs,
      hash: workspaceContentHash(buffer), grade: workspaceFileGrade(resolved.rel), note: workspaceFileNote(resolved.rel),
    },
  };
}

/** 형식이 틀리면 그 이유. JSON · YAML 만 본다. */
export function workspaceFormatError(rel: string, content: string): string | null {
  try {
    if (rel.endsWith(".json")) JSON.parse(content);
    else if (rel.endsWith(".yaml") || rel.endsWith(".yml")) {
      const doc = YAML.parseDocument(content);
      if (doc.errors.length > 0) return doc.errors[0]!.message;
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * 편집 등급 파일만 쓴다. `expectedHash` 가 오면 지금 디스크 내용과 같을 때만 쓴다 —
 * 연 뒤에 에이전트가 같은 파일을 고쳤으면 409 와 지금 해시를 돌려준다.
 */
export async function saveWorkspaceFile(
  studioHome: string,
  payload: Record<string, unknown>,
): Promise<WorkspaceFileResult<{ alias: string; path: string; bytes: number; mtimeMs: number; hash: string }>> {
  const alias = typeof payload.alias === "string" ? payload.alias : undefined;
  const relRaw = typeof payload.path === "string" ? payload.path : undefined;
  const expectedHash = typeof payload.expectedHash === "string" ? payload.expectedHash : undefined;
  if (typeof payload.content !== "string") return { ok: false, status: 400, error: "content 는 글자여야 한다." };
  const content = payload.content;
  if (Buffer.byteLength(content, "utf8") > WORKSPACE_FILE_MAX_BYTES) return { ok: false, status: 413, error: "파일이 너무 크다." };
  const resolved = await resolve(studioHome, alias, relRaw, false);
  if (!resolved.ok) return resolved;
  const grade = workspaceFileGrade(resolved.rel);
  if (grade !== "edit") {
    return { ok: false, status: 403, error: grade === "live" ? "지금도 쓰이는 파일이라 읽기만 한다." : "자동으로 다시 만드는 파일이라 읽기만 한다." };
  }
  const formatError = workspaceFormatError(resolved.rel, content);
  if (formatError) return { ok: false, status: 400, error: `형식이 틀려 저장하지 않았다: ${formatError}` };
  const real = await realInside(resolved.root, resolved.abs);
  if (real === false) return { ok: false, status: 403, error: "기록 폴더 밖이다." };
  if (real === null) return { ok: false, status: 404, error: `파일이 없다: ${resolved.rel}` };

  return withFileLock(real, async () => {
    const current = await fs.readFile(real);
    const currentHash = workspaceContentHash(current);
    if (expectedHash && expectedHash !== currentHash) {
      return { ok: false as const, status: 409 as const, error: "연 뒤에 이 파일이 화면 밖에서 바뀌었다.", hash: currentHash };
    }
    const tmp = `${real}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, real);
    const stat = await fs.stat(real);
    return {
      ok: true as const,
      body: { alias: alias!, path: resolved.rel, bytes: stat.size, mtimeMs: stat.mtimeMs, hash: workspaceContentHash(content) },
    };
  });
}

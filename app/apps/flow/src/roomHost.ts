import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ROOM_SPEAKERS,
  ROOM_SPEAKER_LABEL,
  appendRoomMessage,
  deleteRoom,
  listRooms,
  newRoomId,
  readRoom,
  displayRoomTitle,
  readAgents,
  readModes,
  readRoomMeta,
  readStudio,
  roomStatus,
  roundKind,
  roundPrompt,
  todosPath,
  readTodoPreparations,
  latestPreparations,
  cycleItemsPath,
  readTodos,
  updateTodos,
  recordLlmQuotaExhausted,
  writeAgents,
  writeModes,
  type RoundKind,
  writeRoomMeta,
  type RoomMember,
  type RoomMeta,
  type RoomMode,
  type RoomSpeaker,
} from "@patchbay/core";
import { resolveBin } from "./processHost.js";

/**
 * 대화방 한 턴 — 오른쪽 대화 칸.
 *
 * 모델을 부르는 곳은 상담(`consultHost.ts`)과 여기뿐이다. API 키는 없다. 사용자가 로그인한 CLI를 부른다.
 * 상담과 달리 초안을 쓰지 않고, 호스트 세션을 이어 가지 않는다. 한 방의 기록 전체를 이번 모델에게 넘긴다.
 *
 * Grok은 Grok Build CLI다 (`grok --no-auto-update -p --output-format json`, 문서 2026-10).
 * 로컬은 LM Studio `lms chat -p` 다. 실행 파일이 없으면 그 차례는 「없음」이고 한 바퀴는 이어 간다.
 */

export const ROOM_TURN_TIMEOUT_MS = 180_000;
/** Claude · Codex는 요청이면 파일을 고치고 검사까지 돌려서 말만 하는 것보다 오래 걸린다. */
export const ROOM_ACT_TIMEOUT_MS = 900_000;

const BIN: Record<RoomSpeaker, { name: string; env: string }> = {
  "claude-code": { name: "claude", env: "PATCHBAY_CLAUDE_BIN" },
  codex: { name: "codex", env: "PATCHBAY_CODEX_BIN" },
  grok: { name: "grok", env: "PATCHBAY_GROK_BIN" },
  local: { name: "lms", env: "PATCHBAY_LMS_BIN" },
};

export function resolveRoomBin(speaker: RoomSpeaker): string | null {
  const spec = BIN[speaker];
  const fallbacks = speaker === "local" ? [path.join(os.homedir(), ".lmstudio", "bin", "lms")] : [];
  return resolveBin(spec.name, spec.env, fallbacks);
}

export interface RoomTurnRequest {
  speaker: RoomSpeaker;
  model: string;
  role: string;
  /** Claude `--effort`. medium 또는 high. */
  effort?: "low" | "medium" | "high";
  /**
   * 일반 토의는 기본 권한. 테스트 모델 호출은 명시적으로 읽기/편집 범위를 제한한다.
   * `apply` 는 대화방 보내기 — 요청이면 그 LLM이 직접 프로젝트를 고치고 검사 명령까지 돌린다. 커밋은 열고, 푸시 · 삭제는 막는다.
   */
  execution?: "read" | "edit" | "apply";
  bin: string;
  prompt: string;
  cwd: string;
  timeoutMs: number;
  /** 사람이 「중단하기」를 누르면 끊긴다. */
  signal?: AbortSignal;
  /** 작업 폴더 밖에서 이번 차례에 고칠 수 있는 디렉터리. */
  writeDirs?: string[];
}

export type RoomTurnResult =
  | { ok: true; text: string; ms: number; usage?: { input: number; output: number } }
  | { ok: false; kind: "error" | "timeout" | "stopped"; text: string; ms: number };

export type RoomRunner = (req: RoomTurnRequest) => Promise<RoomTurnResult>;

export function claudeRoomArgs(prompt: string, model: string, effort?: string): string[] {
  const level = effort === "low" || effort === "medium" || effort === "high" ? effort : "";
  return ["-p", prompt, "--output-format", "json", ...(model ? ["--model", model] : []), ...(level ? ["--effort", level] : [])];
}

/**
 * `apply` 는 네트워크를 열고(`npm install`), `gitDir` 를 주면 샌드박스가 잠그는 `.git` 도 열어 커밋하게 한다.
 * 작업 폴더 밖은 `writeDirs` 로 넘긴 프로젝트 상태 디렉터리만 추가로 연다.
 */
export function codexRoomArgs(prompt: string, model: string, effort?: string, execution?: "read" | "edit" | "apply", gitDir?: string, writeDirs: string[] = []): string[] {
  const apply = execution === "apply" ? ["-c", "sandbox_workspace_write.network_access=true", ...[...(gitDir ? [gitDir] : []), ...writeDirs].flatMap((dir) => ["--add-dir", dir])] : [];
  return ["exec", "--json", "--skip-git-repo-check", "--sandbox", execution === "edit" || execution === "apply" ? "workspace-write" : "read-only", ...apply, ...(model ? ["-m", model] : []), ...(["low", "medium", "high"].includes(effort ?? "") ? ["-c", `model_reasoning_effort=${JSON.stringify(effort)}`] : []), prompt];
}

/** Grok Build 헤드리스. 답은 JSON의 `text`. 도구 자동 승인은 켜지 않는다. */
export function grokRoomArgs(prompt: string, model: string): string[] {
  return ["--no-auto-update", "-p", prompt, "--output-format", "json", ...(model ? ["-m", model] : [])];
}

/** LM Studio. `-p` 는 한 번 답하고 끝난다. */
export function lmsRoomArgs(prompt: string, role: string, model: string): string[] {
  return ["chat", "-p", prompt, "--system-prompt", role.trim() || "짧게 답한다.", model.trim()];
}

export function isEmbeddingModel(model: string): boolean {
  return /embed/i.test(model);
}

/** 답이 입력·출력 양을 같이 주면 그 숫자만 남긴다. 없으면 양을 만들지 않는다. */
export function parseRoomStdout(stdout: string): { text: string; usage?: { input: number; output: number } } {
  // LM Studio `lms chat` 은 터미널 제어 문자(\x1b[K, \x1b[?25h 등)를 답 앞에 붙인다.
  const text = parseLoose(stdout).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  const usage = readUsage(stdout);
  return usage ? { text, usage } : { text };
}

function readUsage(stdout: string): { input: number; output: number } | undefined {
  for (const line of stdout.trim().split("\n").reverse()) {
    try {
      const body = JSON.parse(line) as {
        usage?: { input_tokens?: unknown; output_tokens?: unknown; cached_input_tokens?: unknown };
      };
      const rawInput = body.usage?.input_tokens;
      const output = body.usage?.output_tokens;
      const cached = body.usage?.cached_input_tokens;
      if (typeof rawInput === "number" && typeof output === "number" && rawInput >= 0 && output >= 0) {
        const input =
          typeof cached === "number" && cached > 0 && cached <= rawInput
            ? rawInput - cached
            : rawInput;
        return { input, output };
      }
    } catch {
      // 평문 줄.
    }
  }
  return undefined;
}

function parseLoose(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  const last = trimmed.split("\n").at(-1) ?? "";
  try {
    const body = JSON.parse(last) as Record<string, unknown>;
    if (typeof body.text === "string") return body.text;
    if (typeof body.result === "string") return body.result;
    if (typeof body.response === "string") return body.response;
  } catch {
    // 평문 답.
  }
  try {
    let text = "";
    for (const line of trimmed.split("\n")) {
      const event = JSON.parse(line) as Record<string, unknown>;
      const item = event.item as Record<string, unknown> | undefined;
      if (event.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") text = item.text;
    }
    if (text) return text;
  } catch {
    // 평문.
  }
  return trimmed;
}

function runProcess(
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  stdin?: string,
  signal?: AbortSignal,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd,
      stdio: [stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
      env: process.env,
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), 2000).unref();
      setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ code: null, stdout, stderr, timedOut });
        }
      }, 100).unref();
    }, timeoutMs);
    const stop = () => {
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), 2000).unref();
    };
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
    if (stdin !== undefined && child.stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ code: -1, stdout, stderr: stderr || error.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/** 대화방에서 Claude가 묻지 않고 쓰는 도구. 셸은 검사 · 빌드 · 상태 보기 · 스크립트 · 설치 · 커밋 — 목록에 없는 명령은 거절된다. */
export const APPLY_ALLOWED = [
  "Read", "Grep", "Glob", "Edit", "Write",
  "Bash(cd:*)", "Bash(ls:*)", "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)",
  "Bash(npx tsc:*)", "Bash(npx vitest:*)", "Bash(npx vite build:*)", "Bash(npm run:*)", "Bash(npm test:*)",
  "Bash(node:*)", "Bash(python3:*)", "Bash(python:*)", "Bash(npm install:*)", "Bash(git add:*)", "Bash(git commit:*)",
].join(",");
export const APPLY_DENIED = ["Bash(git push:*)", "Bash(git reset:*)", "Bash(git checkout:*)", "Bash(rm:*)"].join(",");

/** 직접 고칠 수 있는 사람 — 편집 권한을 제한할 수 있는 Claude · Codex. Grok · 로컬 모델은 말만 한다. */
export function canApply(member: RoomMember): boolean {
  return member.speaker === "claude-code" || member.speaker === "codex";
}

export const defaultRoomRunner: RoomRunner = async (req) => {
  const started = Date.now();
  const args =
    req.speaker === "claude-code"
      ? claudeRoomArgs(req.prompt, req.model, req.effort)
      : req.speaker === "codex"
        ? codexRoomArgs(req.prompt, req.model, req.effort, req.execution, req.execution === "apply" && (await fs.stat(path.join(req.cwd, ".git")).then((s) => s.isDirectory(), () => false)) ? path.join(req.cwd, ".git") : undefined, req.writeDirs)
        : req.speaker === "grok"
          ? grokRoomArgs(req.prompt, req.model)
          : lmsRoomArgs(req.prompt, req.role, req.model);
  if (req.execution === "apply" && req.speaker === "claude-code") {
    args.push("--tools", "Read,Grep,Glob,Edit,Write,Bash", "--allowedTools", APPLY_ALLOWED, "--disallowedTools", APPLY_DENIED, "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}');
    for (const dir of req.writeDirs ?? []) args.push("--add-dir", dir);
  } else if (req.execution && req.speaker === "claude-code") {
    const tools = req.execution === "edit" ? "Read,Grep,Glob,Edit,Write" : "Read,Grep,Glob";
    args.push("--tools", tools, "--allowedTools", tools, "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}');
  }
  if (req.execution && req.speaker === "grok") return { ok: false, kind: "error", text: "Grok의 테스트 도구 권한 제한은 아직 확인되지 않았다. 읽기·편집 권한을 제한할 수 있는 담당을 선택한다.", ms: 0 };
  const run = await runProcess(req.bin, args, req.cwd, req.timeoutMs, undefined, req.signal);
  const ms = Date.now() - started;
  if (req.signal?.aborted) return { ok: false, kind: "stopped", text: "사람이 중단했다.", ms };
  if (run.timedOut) return { ok: false, kind: "timeout", text: "답을 기다리는 시간을 넘겼다.", ms };
  const parsed = parseRoomStdout(run.stdout);
  if (run.code !== 0 || !parsed.text) {
    return { ok: false, kind: "error", text: (run.stderr || parsed.text || "호스트가 아무 말 없이 끝났다.").trim().slice(0, 800), ms };
  }
  return { ok: true, text: parsed.text, ms, ...(parsed.usage ? { usage: parsed.usage } : {}) };
};

const running = new Set<string>();
const stoppers = new Map<string, AbortController>();
/** 고칠 수 있는 사람이 낀 바퀴는 프로젝트마다 한 번에 하나 — 두 방이 같은 파일을 동시에 고치지 않게. */
const applying = new Set<string>();

/** 사전 준비도 기존 실행 잠금을 공유한다. 프로젝트별 한 작업, 대화별 한 호출. */
export function claimPreparationRoom(alias: string, roomId: string) {
  const key = `${alias}/${roomId}`;
  if (runningRoomAliases().includes(alias) || applying.has(alias)) throw new Error("프로젝트의 다른 LLM 작업이 끝난 뒤 진행해주세요.");
  const controller = new AbortController();
  running.add(key); applying.add(alias); stoppers.set(key, controller);
  return { signal: controller.signal, abort: () => controller.abort(), release: () => { running.delete(key); applying.delete(alias); stoppers.delete(key); } };
}

/** 손댄 파일(git 기준)과 그 수정 시각. git 저장소가 아니면 null. */
export type DirtySnapshot = (cwd: string) => Promise<Map<string, number> | null>;

export const gitDirtySnapshot: DirtySnapshot = async (cwd) => {
  const run = await runProcess("git", ["status", "--porcelain=v1", "-z", "-uall"], cwd, 20_000);
  if (run.code !== 0) return null;
  const tokens = run.stdout.split("\0").filter(Boolean);
  const files = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const file = token.slice(3);
    // 이름 바꿈 · 복사는 다음 칸이 옛 이름이다.
    if (/^[RC]/.test(token)) i++;
    try {
      files.set(file, (await fs.stat(path.join(cwd, file))).mtimeMs);
    } catch {
      files.set(file, -1);
    }
  }
  return files;
};

/** 차례 전후로 새로 손대졌거나, 다시 고쳐졌거나, 원래대로 돌아간 파일. */
export function changedFiles(before: Map<string, number>, after: Map<string, number>): string[] {
  const out = new Set<string>();
  for (const [file, mtime] of after) if (before.get(file) !== mtime) out.add(file);
  for (const file of before.keys()) if (!after.has(file)) out.add(file);
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** 모델의 보고 뒤에 Patchbay가 직접 센 바뀐 파일을 붙인다 — 모델의 말만 믿지 않게. 안 바뀌었으면 붙이지 않는다. */
export function changeNote(files: string[] | null): string {
  if (files === null || files.length === 0) return "";
  const shown = files.slice(0, 30).map((file) => `- \`${file}\``);
  return [`**Patchbay 확인 · 바뀐 파일 ${files.length}개**`, ...shown, ...(files.length > 30 ? [`- 외 ${files.length - 30}개`] : [])].join("\n");
}

export function isRoomRunning(alias: string, roomId: string): boolean {
  return running.has(`${alias}/${roomId}`);
}

/** 지금 어느 방에서든 LLM이 답하는 중인 프로젝트. */
export function runningRoomAliases(): string[] {
  return [...running].map((key) => key.slice(0, key.lastIndexOf("/")));
}

/** 이전 대화의 맥락을 지금 방에 붙인다. 모델을 부르지 않는다. 방이 없으면 새로 만든다. */
export async function attachRoomMemory(
  studioHome: string,
  input: { alias: string; roomId?: string; text: string; sourceId: string },
): Promise<{ ok: true; roomId: string } | { ok: false; status: 400 | 404 | 409; error: string }> {
  const text = input.text.trim();
  const sourceId = input.sourceId.trim();
  if (!text) return { ok: false, status: 400, error: "붙일 맥락이 비어 있다." };
  if (!sourceId) return { ok: false, status: 400, error: "어느 기록에서 왔는지 없다." };
  const studio = await readStudio(studioHome);
  if (!studio.projects.some((p) => p.alias === input.alias)) {
    return { ok: false, status: 404, error: `"${input.alias}" 는 등록된 프로젝트가 아니다.` };
  }
  const roomId = input.roomId ?? newRoomId();
  if (input.roomId) {
    let existing;
    try {
      existing = await readRoom(studioHome, input.alias, roomId);
    } catch (error) {
      return { ok: false, status: 400, error: (error as Error).message };
    }
    if (!existing) return { ok: false, status: 404, error: `대화방 ${roomId} 가 없다.` };
    if (existing.messages.some((m) => m.role === "memory")) {
      return { ok: false, status: 400, error: "이 방에는 맥락이 이미 있다." };
    }
    const meta = await readRoomMeta(studioHome, input.alias, roomId);
    if (meta.kept) return { ok: false, status: 409, error: "이 방은 읽기만 된다. 이 방에서 계속한 뒤에 붙인다." };
  }
  try {
    await appendRoomMessage(studioHome, input.alias, roomId, { role: "memory", text, sourceId });
  } catch (error) {
    return { ok: false, status: 400, error: (error as Error).message };
  }
  return { ok: true, roomId };
}

export { newRoomId };

export interface SendRoomInput {
  alias: string;
  roomId?: string;
  text: string;
  round?: RoundKind;
}

function memberKey(member: RoomMember): string {
  return `${member.speaker}\n${member.model.trim()}\n${member.effort ?? ""}\n${member.name?.trim() ?? ""}`;
}

export function checkMembers(members: RoomMember[]): string | null {
  const seen = new Set<string>();
  for (const member of members) {
    if (!(ROOM_SPEAKERS as readonly string[]).includes(member.speaker)) return "말할 사람을 알지 못한다.";
    if (member.speaker === "local" && !member.model.trim()) return "로컬 모델은 LM Studio 모델 id가 필요하다.";
    if (member.speaker === "local" && isEmbeddingModel(member.model)) return "임베딩 모델은 말하는 사람이 아니다.";
    const key = memberKey(member);
    if (seen.has(key)) return "같은 사람을 한 바퀴에 두 번 부르지 않는다.";
    seen.add(key);
  }
  return null;
}

async function ensureRoom(studioHome: string, alias: string, roomId: string): Promise<RoomMeta> {
  const meta = await readRoomMeta(studioHome, alias, roomId);
  await writeRoomMeta(studioHome, alias, roomId, meta);
  return meta;
}

export async function saveRoomCast(
  studioHome: string,
  input: { alias: string; roomId?: string; members: RoomMember[]; now?: () => Date },
): Promise<{ ok: true; roomId: string } | { ok: false; status: 400 | 404 | 409; error: string }> {
  const problem = checkMembers(input.members);
  if (problem) return { ok: false, status: 400, error: problem };
  const studio = await readStudio(studioHome);
  if (!studio.projects.some((p) => p.alias === input.alias)) {
    return { ok: false, status: 404, error: `"${input.alias}" 는 등록된 프로젝트가 아니다.` };
  }
  const roomId = input.roomId ?? newRoomId(input.now?.());
  if (input.roomId) {
    const existing = await readRoom(studioHome, input.alias, roomId);
    if (!existing) return { ok: false, status: 404, error: `대화방 ${roomId} 가 없다.` };
  }
  const meta = await ensureRoom(studioHome, input.alias, roomId);
  if (meta.kept) return { ok: false, status: 409, error: "이 방은 읽기만 된다." };
  if (meta.execution && !["done", "failed", "consult"].includes(meta.execution.phase)) return { ok: false, status: 409, error: "진행 중 실행의 담당은 고정돼 있다. 실행을 마친 뒤 바꾼다." };
  const members = input.members.map(member => ({ ...member, id: member.id ?? randomUUID() }));
  if (new Set(members.map(m => m.id)).size !== members.length) return { ok: false, status: 400, error: "담당 id가 중복됐다." };
  await writeRoomMeta(studioHome, input.alias, roomId, { ...meta, members });
  return { ok: true, roomId };
}

/** Agents 목록 — 프로젝트에 저장해 두고 대화마다 골라 부르는 LLM. 같은 사람 두 번은 막는다. */
export async function loadAgents(
  studioHome: string,
  alias: string,
): Promise<{ ok: true; agents: RoomMember[] } | { ok: false; status: 404; error: string }> {
  const studio = await readStudio(studioHome);
  if (!studio.projects.some((p) => p.alias === alias)) return { ok: false, status: 404, error: `"${alias}" 는 등록된 프로젝트가 아니다.` };
  return { ok: true, agents: await readAgents(studioHome, alias) };
}

export async function saveAgents(
  studioHome: string,
  input: { alias: string; agents: RoomMember[] },
): Promise<{ ok: true; agents: RoomMember[] } | { ok: false; status: 400 | 404; error: string }> {
  const problem = checkMembers(input.agents);
  if (problem) return { ok: false, status: 400, error: problem };
  const studio = await readStudio(studioHome);
  if (!studio.projects.some((p) => p.alias === input.alias)) return { ok: false, status: 404, error: `"${input.alias}" 는 등록된 프로젝트가 아니다.` };
  const agents = input.agents.map(agent => ({ ...agent, id: agent.id ?? randomUUID() }));
  await writeAgents(studioHome, input.alias, agents);
  return { ok: true, agents };
}

export function checkModes(modes: RoomMode[]): string | null {
  const seen = new Set<string>();
  for (const mode of modes) {
    const name = mode.name.trim();
    if (!name) return "모드 이름이 비어 있다.";
    if (seen.has(name)) return "같은 이름의 모드를 두 번 등록하지 않는다.";
    seen.add(name);
  }
  return null;
}

export async function loadModes(
  studioHome: string,
  alias: string,
): Promise<{ ok: true; modes: RoomMode[] } | { ok: false; status: 404; error: string }> {
  const studio = await readStudio(studioHome);
  if (!studio.projects.some((p) => p.alias === alias)) return { ok: false, status: 404, error: `"${alias}" 는 등록된 프로젝트가 아니다.` };
  return { ok: true, modes: await readModes(studioHome, alias) };
}

export async function saveModes(
  studioHome: string,
  input: { alias: string; modes: RoomMode[] },
): Promise<{ ok: true; modes: RoomMode[] } | { ok: false; status: 400 | 404; error: string }> {
  const problem = checkModes(input.modes);
  if (problem) return { ok: false, status: 400, error: problem };
  const studio = await readStudio(studioHome);
  if (!studio.projects.some((p) => p.alias === input.alias)) return { ok: false, status: 404, error: `"${input.alias}" 는 등록된 프로젝트가 아니다.` };
  const modes = input.modes.map((mode) => ({ ...mode, id: mode.id || randomUUID(), name: mode.name.trim() }));
  await writeModes(studioHome, input.alias, modes);
  return { ok: true, modes };
}

export async function saveRoomMode(
  studioHome: string,
  input: { alias: string; roomId?: string; modeId: string | null; now?: () => Date },
): Promise<{ ok: true; roomId: string; modeId: string | null; members: RoomMember[] } | { ok: false; status: 400 | 404 | 409; error: string }> {
  const studio = await readStudio(studioHome);
  if (!studio.projects.some((p) => p.alias === input.alias)) {
    return { ok: false, status: 404, error: `"${input.alias}" 는 등록된 프로젝트가 아니다.` };
  }
  const modes = await readModes(studioHome, input.alias);
  const picked = input.modeId ? modes.find((m) => m.id === input.modeId) ?? null : null;
  if (input.modeId && !picked) {
    return { ok: false, status: 400, error: "선택한 모드가 목록에 없다." };
  }
  const roomId = input.roomId ?? newRoomId(input.now?.());
  if (input.roomId) {
    const existing = await readRoom(studioHome, input.alias, roomId);
    if (!existing) return { ok: false, status: 404, error: `대화방 ${roomId} 가 없다.` };
  }
  const meta = await ensureRoom(studioHome, input.alias, roomId);
  if (meta.kept) return { ok: false, status: 409, error: "이 방은 읽기만 된다." };
  if (meta.execution && !["done", "failed", "consult"].includes(meta.execution.phase)) {
    return { ok: false, status: 409, error: "진행 중인 실행에서는 모드를 바꾸지 않는다." };
  }
  let members = meta.members;
  if (picked?.agentIds && picked.agentIds.length > 0) {
    const agents = await readAgents(studioHome, input.alias);
    const ordered: RoomMember[] = [];
    for (const agentId of picked.agentIds) {
      const inRoom = members.find((m) => m.id === agentId);
      if (inRoom) {
        ordered.push({ ...inRoom, enabled: true });
        continue;
      }
      const inAgents = agents.find((a) => a.id === agentId);
      if (inAgents) {
        ordered.push({ ...inAgents, id: inAgents.id ?? randomUUID(), enabled: true });
      }
    }
    if (ordered.length > 0) {
      const chosenIds = new Set(ordered.map((m) => m.id));
      const rest = members.filter((m) => !chosenIds.has(m.id)).map((m) => ({ ...m, enabled: false }));
      members = [...ordered, ...rest];
    }
  }
  const nextModeId = picked ? picked.id : null;
  await writeRoomMeta(studioHome, input.alias, roomId, { ...meta, members, modeId: nextModeId });
  return { ok: true, roomId, modeId: nextModeId, members };
}

export async function removeRoom(
  studioHome: string,
  input: { alias: string; roomId: string },
): Promise<{ ok: true } | { ok: false; status: 400 | 404 | 409; error: string }> {
  const studio = await readStudio(studioHome);
  if (!studio.projects.some((p) => p.alias === input.alias)) {
    return { ok: false, status: 404, error: `"${input.alias}" 는 등록된 프로젝트가 아니다.` };
  }
  if (running.has(`${input.alias}/${input.roomId}`)) {
    return { ok: false, status: 409, error: "이 대화방은 답을 기다리는 중이다." };
  }
  const meta = await readRoomMeta(studioHome, input.alias, input.roomId);
  if (meta.execution && !["done", "failed", "consult"].includes(meta.execution.phase)) return { ok: false, status: 409, error: "진행 중인 테스트 실행은 종료하거나 상담으로 넘긴 뒤 삭제한다." };
  let gone = false;
  try {
    gone = await deleteRoom(studioHome, input.alias, input.roomId);
  } catch (error) {
    return { ok: false, status: 400, error: (error as Error).message };
  }
  if (!gone) return { ok: false, status: 404, error: `대화방 ${input.roomId} 가 없다.` };
  return { ok: true };
}

export async function saveRoomTitle(
  studioHome: string,
  input: { alias: string; roomId: string; title: string },
): Promise<{ ok: true } | { ok: false; status: 400 | 404; error: string }> {
  const studio = await readStudio(studioHome);
  if (!studio.projects.some((p) => p.alias === input.alias)) {
    return { ok: false, status: 404, error: `"${input.alias}" 는 등록된 프로젝트가 아니다.` };
  }
  const existing = await readRoom(studioHome, input.alias, input.roomId);
  if (!existing) return { ok: false, status: 404, error: `대화방 ${input.roomId} 가 없다.` };
  const meta = await readRoomMeta(studioHome, input.alias, input.roomId);
  await writeRoomMeta(studioHome, input.alias, input.roomId, { ...meta, title: input.title });
  return { ok: true };
}

export async function saveRoomKept(
  studioHome: string,
  input: { alias: string; roomId: string; kept: boolean },
): Promise<{ ok: true } | { ok: false; status: 400 | 404 | 409; error: string }> {
  const studio = await readStudio(studioHome);
  if (!studio.projects.some((p) => p.alias === input.alias)) {
    return { ok: false, status: 404, error: `"${input.alias}" 는 등록된 프로젝트가 아니다.` };
  }
  const existing = await readRoom(studioHome, input.alias, input.roomId);
  if (!existing) return { ok: false, status: 404, error: `대화방 ${input.roomId} 가 없다.` };
  if (!input.kept && running.has(`${input.alias}/${input.roomId}`)) {
    return { ok: false, status: 409, error: "이 대화방은 답을 기다리는 중이다." };
  }
  const meta = await readRoomMeta(studioHome, input.alias, input.roomId);
  await writeRoomMeta(studioHome, input.alias, input.roomId, { ...meta, kept: input.kept });
  return { ok: true };
}

export type SendRoomResult =
  | { ok: true; roomId: string; done: Promise<void> }
  | { ok: false; status: 400 | 404 | 409 | 503; error: string };

export async function sendRoomTurn(
  studioHome: string,
  input: SendRoomInput,
  deps: { runner?: RoomRunner; bin?: string | null; timeoutMs?: number; now?: () => Date; snapshot?: DirtySnapshot } = {},
): Promise<SendRoomResult> {
  const text = input.text.trim();
  if (!text && !input.round) return { ok: false, status: 400, error: "보낼 말이 비어 있다." };
  const studio = await readStudio(studioHome);
  const project = studio.projects.find((p) => p.alias === input.alias);
  if (!project) return { ok: false, status: 404, error: `"${input.alias}" 는 등록된 프로젝트가 아니다.` };

  const roomId = input.roomId ?? newRoomId(deps.now?.());
  const key = `${input.alias}/${roomId}`;
  if (running.has(key)) return { ok: false, status: 409, error: "이 대화방은 답을 기다리는 중이다." };

  const now = () => deps.now?.() ?? new Date();
  let existing: Awaited<ReturnType<typeof readRoom>>;
  try {
    existing = await readRoom(studioHome, input.alias, roomId);
  } catch (error) {
    return { ok: false, status: 400, error: (error as Error).message };
  }
  if (input.roomId && !existing) return { ok: false, status: 404, error: `대화방 ${roomId} 가 없다.` };
  const meta = existing ? await readRoomMeta(studioHome, input.alias, roomId) : await ensureRoom(studioHome, input.alias, roomId);
  if (meta.kept) return { ok: false, status: 409, error: "이 방은 읽기만 된다. 이 방에서 계속하면 다시 말한다." };
  if (meta.execution) return { ok: false, status: 409, error: "테스트 실행 방에서는 실행 버튼을 사용한다. 새 요구는 상담으로 보낸다." };

  const kind = input.round ?? roundKind(text);
  const live = meta.members.filter((member) => member.enabled !== false);
  if (kind && live.length === 0) {
    return { ok: false, status: 400, error: "켜진 사람이 없다. LLM에서 사람을 켜면 대화 화면에 아이콘이 나온다." };
  }
  const preparedReview = latestPreparations(await readTodoPreparations(studioHome, input.alias)).find(v => v.roomId === roomId && v.status !== "done");
  let activeMode = preparedReview
    ? { id: "preparation-review", name: "준비 결과 검토", execution: "read" as const, prompt: "준비 결과에 대한 질문에 답한다. 파일을 바꾸거나 업무를 실행하지 않는다. 실행은 준비 결과의 승인 버튼, 수정은 수정 요청을 사용하도록 안내한다." }
    : meta.modeId ? (await readModes(studioHome, input.alias)).find((m) => m.id === meta.modeId) ?? null : null;
  // 위에 미완료 할일이 있으면 막지 않고 대화만 한다 — 파일을 바꾸는 실행은 맨 위 할일부터.
  if (kind && (activeMode?.execution ?? "apply") !== "read" && live.some(canApply)) {
    const queue = (await readTodos(studioHome, input.alias)).filter(todo => !todo.done && !todo.inactive);
    const index = queue.findIndex(todo => todo.roomId === roomId);
    if (index > 0) activeMode = { id: "todo-waiting", name: "위 할일 대기", execution: "read" as const, prompt: `${activeMode?.prompt.trim() ? `${activeMode.prompt.trim()}\n` : ""}위의 할일 「${queue[0]!.title}」이 먼저라 이번 차례는 파일을 바꾸지 않고 답만 한다. 실행이 필요한 요구면 위 할일을 끝내거나 할일 순서를 바꾸라고 안내한다.` };
  }
  const modeExec = activeMode?.execution ?? "apply";
  const acts = Boolean(kind) && modeExec !== "read" && live.some(canApply);
  if (acts && applying.has(input.alias)) return { ok: false, status: 409, error: "이 프로젝트의 다른 대화방에서 LLM이 일하는 중이다. 끝난 뒤 보낸다." };

  const modeTag = activeMode
    ? {
        modeId: activeMode.id,
        modeName: activeMode.name,
        ...(activeMode.icon ? { modeIcon: activeMode.icon } : {}),
        ...(activeMode.color ? { modeColor: activeMode.color } : {}),
      }
    : {};
  if (text) await appendRoomMessage(studioHome, input.alias, roomId, { role: "user", text, ...modeTag }, now());
  if (input.round) await appendRoomMessage(studioHome, input.alias, roomId, { role: "user", text: input.round === "talk" ? "대화 시작" : "토의 시작", ...(!text ? modeTag : {}) }, now());
  if (!kind) return { ok: true, roomId, done: Promise.resolve() };

  running.add(key);
  if (acts) applying.add(input.alias);
  const stop = new AbortController();
  stoppers.set(key, stop);
  const runner = deps.runner ?? defaultRoomRunner;
  const snapshot = deps.snapshot ?? gitDirtySnapshot;
  const done = (async () => {
    try {
      const todoFile = todosPath(studioHome, input.alias);
      const todoInstruction = [
        "실제로 작업을 수행한 차례라면 끝나기 전에 이 프로젝트의 이후 할 일 목록도 현재 상태에 맞춘다.",
        `목록 파일: ${todoFile}`,
        '형식: {"todos":[{"id":"고유한 값","title":"할 일","detail":"필요할 때만 설명","done":false,"at":"ISO 시각"}]}',
        "기존 배열 순서와 id·at·roomId·source·inactive를 보존한다. 완료하면 completedAt에 현재 ISO 시각을 남긴다. 수행 중인 대화와 roomId가 같은 할일을 우선 확인한다. 답변이나 확인만으로 done을 true로 만들지 않는다.",
        "사용자가 명시한 새 작업 요구사항과 실행 중 발생한 미해결 오류·후속 작업을 구체적인 할일로 목록 맨 아래에 추가한다. 같은 미완료 항목이 이미 있으면 중복 추가하지 않는다. 6건은 화면 표시 기준일 뿐 저장 개수 제한이 아니다. 기존 할일을 새 목록으로 교체하거나 6건으로 잘라내지 않는다.",
        "방금 끝낸 항목은 done=true로 보존하고, 새로 드러난 구체적인 다음 작업은 추가하며, 아직 끝나지 않은 기존 항목을 임의로 지우지 않는다. 질문에 답만 한 차례에는 목록을 바꾸지 않는다.",
        "작업을 계획했다면 대시보드 흐름도의 세부 항목에도 남긴다. 사용자가 보고 무엇을 할지 알 수 있게 한다.",
        `세부 항목 파일: ${cycleItemsPath(studioHome, input.alias)}`,
        '형식: {"items":[{"id":"고유한 값","step":"design|build|test|review","task":"작업 이름","name":"업무명","desc":"무엇을 하는지 짧게","tag":"UI|Agent|데이터|서버|문서","source":"llm","at":"ISO 시각"}]}',
        "task는 흐름도 표의 작업 이름(설계는 PRD 주제, 구현·테스트는 LangGraph 노드 이름)과 같게 쓴다. name은 80자, desc는 200자 이하. 새 항목은 source를 llm으로 해서 맨 아래에 추가한다. 같은 작업 아래 같은 이름이 있으면 추가하지 않는다. 기존 항목의 id·todoId와 source가 user인 항목은 그대로 둔다.",
      ].join("\n");
      for (const member of live) {
        if (stop.signal.aborted) break;
        const bin = deps.bin !== undefined ? deps.bin : resolveRoomBin(member.speaker);
        const label = member.speaker === "local" && member.model.trim() ? member.model.trim() : ROOM_SPEAKER_LABEL[member.speaker];
        if (!bin) {
          await appendRoomMessage(studioHome, input.alias, roomId, { role: "system", kind: "error", text: `${label} 없음` }, now());
          continue;
        }
        const after = await readRoom(studioHome, input.alias, roomId);
        const canEdit = canApply(member);
        const memberExecution: "read" | "edit" | "apply" | undefined =
          modeExec === "read"
            ? (preparedReview || canEdit ? "read" : undefined)
            : modeExec === "edit"
              ? (canEdit ? "edit" : undefined)
              : (canEdit ? "apply" : undefined);
        const act = memberExecution === "apply" || memberExecution === "edit";
        const before = act ? await snapshot(project.path) : null;
        const result = await runner({
          speaker: member.speaker,
          model: member.model.trim(),
          role: member.role,
          ...(member.effort ? { effort: member.effort } : {}),
          bin,
          prompt: `${roundPrompt(after?.messages ?? [], member, kind, activeMode)}${memberExecution === "apply" ? `\n${todoInstruction}` : ""}`,
          cwd: project.path,
          timeoutMs: deps.timeoutMs ?? (act ? ROOM_ACT_TIMEOUT_MS : ROOM_TURN_TIMEOUT_MS),
          ...(memberExecution ? { execution: memberExecution } : {}),
          ...(memberExecution === "apply" ? { writeDirs: [path.dirname(todoFile)] } : {}),
          signal: stop.signal,
        });
        const later = before ? await snapshot(project.path) : null;
        const note = changeNote(before && later ? changedFiles(before, later) : null);
        if (result.ok) {
          await appendRoomMessage(
            studioHome,
            input.alias,
            roomId,
            {
            role: "speaker",
            speaker: member.speaker,
            model: member.model.trim(),
            text: note ? `${result.text}\n\n${note}` : result.text,
            ms: result.ms,
            ...(member.id ? { memberId: member.id } : {}),
            ...((member.speaker === "claude-code" || member.speaker === "codex") && member.effort ? { effort: member.effort } : {}),
            ...(result.usage ? { usage: result.usage } : {}),
          },
            now(),
          );
        } else {
          if (member.speaker === "claude-code" || member.speaker === "codex") {
            await recordLlmQuotaExhausted(studioHome, member.speaker, result.text, now()).catch(() => undefined);
          }
          await appendRoomMessage(
            studioHome,
            input.alias,
            roomId,
            { role: "system", kind: result.kind, text: `${label} — ${result.text}${note ? `\n\n${note}` : ""}` },
            now(),
          );
        }
      }
    } finally {
      try {
        // 화면을 닫아도 Agent가 완료한 할일과 마지막 응답을 즉시 보관한다.
        await updateTodos(studioHome, input.alias, rows => rows, now());
      } catch (error) {
        await appendRoomMessage(studioHome, input.alias, roomId, { role: "system", kind: "error", text: `할일 기록 보관 실패: ${(error as Error).message}` }, now()).catch(() => undefined);
      }
      running.delete(key);
      stoppers.delete(key);
      if (acts) applying.delete(input.alias);
    }
  })();
  return { ok: true, roomId, done };
}

/** 「중단하기」 — 지금 답하는 LLM을 끊고 이 바퀴의 남은 사람은 부르지 않는다. 이미 고친 파일은 되돌리지 않는다. */
export function stopRoomTurn(input: { alias: string; roomId: string }): { ok: true } | { ok: false; status: 409; error: string } {
  const stop = stoppers.get(`${input.alias}/${input.roomId}`);
  if (!stop) return { ok: false, status: 409, error: "이 대화방에서 답하는 LLM이 없다." };
  stop.abort();
  return { ok: true };
}

/** 방마다 지금 LLM이 답하는 중인지 같이 준다 — 다른 방에서 일하는 중이면 대화창 위에 보이게. */
export async function roomListView(studioHome: string, alias: string) {
  return (await listRooms(studioHome, alias)).map((row) => ({ ...row, running: isRoomRunning(alias, row.id) }));
}

export async function roomReadView(studioHome: string, alias: string, id: string) {
  const read = await readRoom(studioHome, alias, id);
  if (!read) return null;
  const meta = await readRoomMeta(studioHome, alias, id);
  return {
    ...read,
    title: meta.title,
    displayTitle: displayRoomTitle(meta.title, read.messages),
    kept: meta.kept,
    members: meta.members,
    modeId: meta.modeId ?? null,
    execution: meta.execution ?? null,
    status: roomStatus(read.messages),
    running: isRoomRunning(alias, id),
  };
}

const SKIP_DIRS = new Set(["node_modules", "dist", "dist-client", "dist-server", ".git"]);

/** 이 프로젝트 안에서 첨부로 고를 수 있는 파일. 숨김 폴더와 의존성 폴더는 빠진다. */
export async function listRoomProjectFiles(
  studioHome: string,
  alias: string,
): Promise<{ ok: true; files: string[] } | { ok: false; status: 404; error: string }> {
  const studio = await readStudio(studioHome);
  const project = studio.projects.find((item) => item.alias === alias);
  if (!project) return { ok: false, status: 404, error: `"${alias}" 는 등록된 프로젝트가 아니다.` };
  const files: string[] = [];
  await walkProjectFiles(project.path, "", files);
  files.sort((a, b) => a.localeCompare(b));
  return { ok: true, files };
}

/** 스킬 모음에 있는 스킬. 초안(`.proposed`)은 빠진다. */
export async function listRoomSkills(studioHome: string): Promise<{ slug: string }[]> {
  const dir = path.join(studioHome, "skills");
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const skills: { slug: string }[] = [];
  for (const name of names) {
    if (!/^[a-zA-Z0-9._-]+$/.test(name) || name.endsWith(".proposed")) continue;
    try {
      await fs.access(path.join(dir, name, "SKILL.md"));
      skills.push({ slug: name });
    } catch {
      // 패키지가 아니다.
    }
  }
  skills.sort((a, b) => a.slug.localeCompare(b.slug));
  return skills;
}

export async function readRoomSkill(studioHome: string, slug: string): Promise<{ ok: true; text: string } | { ok: false; status: 400 | 404; error: string }> {
  if (!/^[a-zA-Z0-9._-]+$/.test(slug) || slug.endsWith(".proposed")) {
    return { ok: false, status: 400, error: "스킬 이름을 알지 못한다." };
  }
  try {
    const text = await fs.readFile(path.join(studioHome, "skills", slug, "SKILL.md"), "utf8");
    return { ok: true, text };
  } catch {
    return { ok: false, status: 404, error: `스킬 ${slug} 가 없다.` };
  }
}

async function walkProjectFiles(dir: string, rel: string, out: string[]): Promise<void> {
  if (out.length >= 300) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= 300) return;
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walkProjectFiles(path.join(dir, entry.name), next, out);
    else if (entry.isFile()) out.push(next);
  }
}

export function roomHostAvailability(): { speaker: RoomSpeaker; label: string; available: boolean }[] {
  return ROOM_SPEAKERS.map((speaker) => ({
    speaker,
    label: ROOM_SPEAKER_LABEL[speaker],
    available: resolveRoomBin(speaker) !== null,
  }));
}

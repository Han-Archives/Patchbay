import fs from "node:fs/promises";
import path from "node:path";
import { appendRoomMessage, readRoomMeta } from "./store.js";

/**
 * Claude Code 세션 → 대화방 옮겨 적기 (사용자 요청 2026-10-11 — 폰에서 한 대화가 대화창에 그대로).
 *
 * 폰의 Claude 앱(Remote Control)이든 맥 터미널이든, 세션이 MCP `room_bind` 로 방을 고르면
 * 그 뒤 훅이 세션 기록(transcript JSONL)을 읽어 사람의 말과 Claude의 답을 그 방에 덧붙인다.
 * 모델이 「기록해야지」를 기억하지 않아도 되게 — 옮기는 일은 훅이 한다.
 *
 * 어느 방인지는 세션 기록 안의 `room_bind` 결과가 정한다. 세션 id를 MCP가 몰라도 되고,
 * 세션마다 따로 묶인다. 묶기 전의 말(처음 요청)은 처음 묶일 때 한 번에 옮긴다.
 * 훅은 세션을 막지 않는다 — 실패해도 조용히 끝나고, 다음 훅이 커서부터 다시 읽는다.
 */

export const ROOM_MIRROR_DIR = "room-mirror";
export const ROOM_BIND_TOOL = "room_bind";
const MAX_TEXT = 20_000;

export interface RoomMirrorState {
  alias: string | null;
  roomId: string | null;
  /** 세션 기록에서 다 읽은 줄 수. */
  cursor: number;
  /** UserPromptSubmit 이 먼저 적은 말. 세션 기록에 같은 말이 나오면 건너뛴다. */
  pending: string[];
  /** 아직 방에 적지 않은 Claude의 말 (한 턴이 끝나면 한 덩어리로 적는다). */
  draft: { text: string; model: string; from: string | null; lastAt?: string | null } | null;
  lastPromptAt: string | null;
}

export interface RoomMirrorInput {
  sessionId: string;
  transcriptPath: string;
  event: "UserPromptSubmit" | "Stop" | string;
  prompt?: string;
}

export interface RoomMirrorResult {
  bound: { alias: string; roomId: string } | null;
  appended: number;
}

type Line = Record<string, unknown>;

/** 세션 기록의 시각을 방 말의 `sourceAt` 으로. 형식이 틀리면 넣지 않는다. */
function sourceAtOf(value: unknown): { sourceAt?: string } {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && /T.*(Z|[+-]\d\d:\d\d)$/.test(value) ? { sourceAt: value } : {};
}

function emptyState(): RoomMirrorState {
  return { alias: null, roomId: null, cursor: 0, pending: [], draft: null, lastPromptAt: null };
}

function statePath(studioHome: string, sessionId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw new Error(`세션 id "${sessionId}" 는 파일 이름이 될 수 없다.`);
  return path.join(studioHome, ROOM_MIRROR_DIR, `${sessionId}.json`);
}

async function readState(file: string): Promise<RoomMirrorState> {
  try {
    return { ...emptyState(), ...(JSON.parse(await fs.readFile(file, "utf8")) as Partial<RoomMirrorState>) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw error;
  }
}

async function writeState(file: string, state: RoomMirrorState): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…(이하 생략)` : text;
}

/** 슬래시 명령·시스템이 끼운 말은 사람의 말이 아니다. */
export function isHumanPromptText(text: string): boolean {
  const line = text.trim();
  return !!line && !line.startsWith("/") && !line.startsWith("<");
}

/** 세션 기록 한 줄이 사람이 친 말이면 그 글. */
export function humanPromptOf(line: Line): string | null {
  if (line.type !== "user" || line.isSidechain === true || line.isMeta === true) return null;
  const origin = line.origin as { kind?: unknown } | undefined;
  if (origin && origin.kind !== "human") return null;
  const content = (line.message as { content?: unknown } | undefined)?.content;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    if (content.some((c) => (c as { type?: unknown })?.type === "tool_result")) return null;
    text = content.filter((c) => (c as { type?: unknown })?.type === "text").map((c) => String((c as { text?: unknown }).text ?? "")).join("\n");
  }
  return isHumanPromptText(text) ? text.trim() : null;
}

/** 세션 기록 한 줄이 Claude의 글을 가지고 있으면 그 글과 모델. */
export function assistantTextOf(line: Line): { text: string; model: string } | null {
  if (line.type !== "assistant" || line.isSidechain === true) return null;
  const message = line.message as { content?: unknown; model?: unknown } | undefined;
  if (!Array.isArray(message?.content)) return null;
  const text = message.content
    .filter((c) => (c as { type?: unknown })?.type === "text")
    .map((c) => String((c as { text?: unknown }).text ?? ""))
    .join("\n")
    .trim();
  return text ? { text, model: typeof message.model === "string" ? message.model : "" } : null;
}

/** `room_bind` 도구 호출의 id들. MCP 서버 이름이 무엇이든 `mcp__<server>__room_bind` 다. */
function bindCalls(line: Line): string[] {
  if (line.type !== "assistant") return [];
  const content = (line.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((c) => {
      const block = c as { type?: unknown; name?: unknown };
      return block.type === "tool_use" && typeof block.name === "string" && block.name.startsWith("mcp__") && block.name.endsWith(`__${ROOM_BIND_TOOL}`);
    })
    .map((c) => String((c as { id?: unknown }).id ?? ""));
}

/** `room_bind` 결과가 성공이면 묶인 방. */
function bindResult(line: Line, calls: Set<string>): { alias: string; roomId: string } | null {
  if (line.type !== "user") return null;
  const content = (line.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return null;
  for (const c of content) {
    const block = c as { type?: unknown; tool_use_id?: unknown; is_error?: unknown; content?: unknown };
    if (block.type !== "tool_result" || block.is_error === true || !calls.has(String(block.tool_use_id))) continue;
    const raw = typeof block.content === "string"
      ? block.content
      : Array.isArray(block.content)
        ? block.content.map((part) => String((part as { text?: unknown }).text ?? "")).join("")
        : "";
    try {
      const body = JSON.parse(raw) as { alias?: unknown; roomId?: unknown; bound?: unknown };
      if (body.bound === true && typeof body.alias === "string" && typeof body.roomId === "string") return { alias: body.alias, roomId: body.roomId };
    } catch {
      // 오류 문장.
    }
  }
  return null;
}

function parseLines(text: string): { lines: Line[]; complete: number } {
  const raw = text.split("\n");
  // 마지막 조각은 아직 쓰는 중일 수 있다 — 줄바꿈으로 끝난 줄만 읽는다.
  const whole = raw.slice(0, -1);
  const lines: Line[] = [];
  for (const row of whole) {
    if (!row.trim()) { lines.push({}); continue; }
    try { lines.push(JSON.parse(row) as Line); } catch { lines.push({}); }
  }
  return { lines, complete: whole.length };
}

/** 묶인 방을 세션 기록 처음부터 찾는다 (마지막 묶음이 이긴다). */
export function findBinding(lines: readonly Line[]): { alias: string; roomId: string } | null {
  const calls = new Set<string>();
  let found: { alias: string; roomId: string } | null = null;
  for (const line of lines) {
    for (const id of bindCalls(line)) calls.add(id);
    found = bindResult(line, calls) ?? found;
  }
  return found;
}

/**
 * 훅 한 번. `UserPromptSubmit` 이면 앞 턴의 남은 답을 적고 새 말을 바로 적는다
 * (긴 작업 중에도 PC에서 요청이 보이게). `Stop` 이면 이번 턴의 답을 적는다.
 */
export async function mirrorSession(studioHome: string, input: RoomMirrorInput, now: () => Date = () => new Date()): Promise<RoomMirrorResult> {
  const file = statePath(studioHome, input.sessionId);
  const state = await readState(file);
  let transcript = "";
  try {
    transcript = await fs.readFile(input.transcriptPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const { lines, complete } = parseLines(transcript);

  const binding = findBinding(lines);
  if (!binding) return { bound: null, appended: 0 };
  if (binding.alias !== state.alias || binding.roomId !== state.roomId) {
    const first = state.alias === null;
    state.alias = binding.alias;
    state.roomId = binding.roomId;
    if (first) { state.cursor = 0; state.draft = null; state.pending = []; }
  }
  const meta = await readRoomMeta(studioHome, binding.alias, binding.roomId);
  if (meta.kept) { await writeState(file, state); return { bound: binding, appended: 0 }; }

  let appended = 0;
  let lastSeen: string | null = null;
  const alias = binding.alias;
  const roomId = binding.roomId;
  const flush = async () => {
    const draft = state.draft;
    if (!draft) return;
    const started = draft.from ? Date.parse(draft.from) : NaN;
    await appendRoomMessage(studioHome, alias, roomId, {
      role: "speaker", via: "claude-session", speaker: "claude-code", model: draft.model, text: clip(draft.text),
      ms: Number.isFinite(started) ? Math.max(0, now().getTime() - started) : 0,
      ...sourceAtOf(draft.lastAt),
    }, now());
    state.draft = null;
    appended++;
  };

  for (let index = state.cursor; index < complete; index++) {
    const line = lines[index]!;
    const prompt = humanPromptOf(line);
    if (prompt) {
      await flush();
      lastSeen = prompt;
      state.lastPromptAt = typeof line.timestamp === "string" ? line.timestamp : state.lastPromptAt;
      if (state.pending[0] !== undefined && normalize(state.pending[0]) === normalize(prompt)) state.pending.shift();
      else { await appendRoomMessage(studioHome, alias, roomId, { role: "user", via: "claude-session", text: clip(prompt), ...sourceAtOf(line.timestamp) }, now()); appended++; }
    } else {
      const said = assistantTextOf(line);
      if (said) {
        const lastAt = typeof line.timestamp === "string" ? line.timestamp : null;
        state.draft = state.draft
          ? { ...state.draft, text: `${state.draft.text}\n\n${said.text}`, model: said.model || state.draft.model, lastAt: lastAt ?? state.draft.lastAt ?? null }
          : { text: said.text, model: said.model, from: state.lastPromptAt, lastAt };
      }
    }
    state.cursor = index + 1;
  }

  if (input.event === "UserPromptSubmit") {
    await flush();
    const prompt = input.prompt ?? "";
    // 훅보다 세션 기록이 먼저 썼으면 위에서 이미 적었다.
    if (isHumanPromptText(prompt) && !(lastSeen !== null && normalize(lastSeen) === normalize(prompt))) {
      await appendRoomMessage(studioHome, alias, roomId, { role: "user", via: "claude-session", text: clip(prompt.trim()) }, now());
      state.pending.push(prompt.trim());
      state.lastPromptAt = now().toISOString();
      appended++;
    }
  } else if (input.event === "Stop") {
    await flush();
  }
  await writeState(file, state);
  return { bound: binding, appended };
}

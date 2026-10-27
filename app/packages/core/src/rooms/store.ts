import fs from "node:fs/promises";
import { existsSync, readdirSync, renameSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { roomExecutionSchema, type RoomExecution } from "./execution.js";
import { projectStudioDir } from "../studio/studioStore.js";
import { TrashError, trashRecord } from "../studio/trashStore.js";
import {
  ROOM_SPEAKER_LABEL,
  ROOM_SPEAKERS,
  type RoomMember,
  type RoomMode,
  roomMemberSchema,
  roomMessageSchema,
  type NewRoomMessage,
  type RoomMessage,
  type RoomSpeaker,
  type RoomStatus,
} from "./types.js";

/** 대화방이 사는 곳: `~/.patchbay/projects/<alias>/chats/<id>.jsonl`. 덧붙이기만 한다. */
export const ROOM_DIR_NAME = "chats";
/** 2026-10-16 까지의 이름. 콘솔 서버가 켜질 때 `chats/` 로 옮긴다(`migrateLegacyRoomDirs`). */
export const LEGACY_ROOM_DIR_NAME = "rooms";

/**
 * 그 프로젝트의 대화방 폴더. 아직 옮기지 않은 작업 공간이면 옛 `rooms/` 를 그대로 쓴다 —
 * 옮기기 전에 새 코드(미러 훅 등)가 `chats/` 를 따로 만들어 기록이 둘로 갈리지 않게.
 */
export function roomDir(studioHome: string, alias: string): string {
  const base = projectStudioDir(studioHome, alias);
  const current = path.join(base, ROOM_DIR_NAME);
  const legacy = path.join(base, LEGACY_ROOM_DIR_NAME);
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
}

/** 프로젝트마다 `rooms/` 를 `chats/` 로 옮긴다. `chats/` 가 이미 있으면 건드리지 않는다. 옮긴 alias 를 돌려준다. */
export function migrateLegacyRoomDirs(studioHome: string): string[] {
  const projects = path.join(studioHome, "projects");
  if (!existsSync(projects)) return [];
  const moved: string[] = [];
  for (const entry of readdirSync(projects, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const legacy = path.join(projects, entry.name, LEGACY_ROOM_DIR_NAME);
    const current = path.join(projects, entry.name, ROOM_DIR_NAME);
    if (!existsSync(legacy) || existsSync(current)) continue;
    renameSync(legacy, current);
    moved.push(entry.name);
  }
  return moved;
}
const roomWrites = new Map<string, Promise<unknown>>();
function serialize<T>(file: string, action: () => Promise<T>): Promise<T> {
  const previous = roomWrites.get(file) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(action);
  roomWrites.set(file, next);
  void next.finally(() => { if (roomWrites.get(file) === next) roomWrites.delete(file); }).catch(() => undefined);
  return next;
}

/**
 * 프로세스 사이 잠금. 콘솔 서버와 Claude Code 훅(`patchbay room mirror`)이 같은 방에 쓴다 —
 * `serialize` 는 한 프로세스 안만 막으므로, seq 가 겹치지 않게 `<file>.lock` 을 `wx` 로 잡는다.
 * 죽은 프로세스가 남긴 잠금은 10초가 지나면 걷는다.
 */
export const ROOM_LOCK_STALE_MS = 10_000;
export async function withFileLock<T>(file: string, action: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const handle = await fs.open(lock, "wx");
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const stat = await fs.stat(lock);
        if (Date.now() - stat.mtimeMs > ROOM_LOCK_STALE_MS) { await fs.rm(lock, { force: true }); continue; }
      } catch { continue; }
      if (Date.now() > deadline) throw new Error("대화방 기록 잠금을 얻지 못했다. 다른 쓰기가 끝난 뒤 다시 시도한다.");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  try {
    return await action();
  } finally {
    await fs.rm(lock, { force: true });
  }
}

/** 새 방 id: `2026-10-11-1a2b3c4d`. 콘솔과 세션 연결(`room_bind`)이 같은 꼴을 쓴다. */
export function newRoomId(now: Date = new Date()): string {
  return `${now.toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
}

export function safeRoomId(id: string): string {
  if (!id || /[\\/]/.test(id) || id === "." || id === "..") throw new Error(`대화방: id "${id}" 는 파일 이름이 될 수 없다.`);
  return id;
}

export function roomPath(studioHome: string, alias: string, id: string): string {
  return path.join(roomDir(studioHome, alias), `${safeRoomId(id)}.jsonl`);
}

export interface RoomRead {
  id: string;
  messages: RoomMessage[];
  broken: { line: number; error: string }[];
}

export async function readRoom(studioHome: string, alias: string, id: string): Promise<RoomRead | null> {
  let text: string;
  try {
    text = await fs.readFile(roomPath(studioHome, alias, id), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const messages: RoomMessage[] = [];
  const broken: RoomRead["broken"] = [];
  text.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = roomMessageSchema.safeParse(JSON.parse(line));
      if (parsed.success) messages.push(parsed.data);
      else broken.push({ line: index + 1, error: parsed.error.issues[0]?.message ?? "형식이 맞지 않는다" });
    } catch (error) {
      broken.push({ line: index + 1, error: (error as Error).message });
    }
  });
  return { id, messages, broken };
}

export async function appendRoomMessage(
  studioHome: string,
  alias: string,
  id: string,
  message: NewRoomMessage,
  now: Date = new Date(),
): Promise<RoomMessage> {
  const file = roomPath(studioHome, alias, id);
  return serialize(file, async () => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  return withFileLock(file, async () => {
  const existing = await readRoom(studioHome, alias, id);
  const seq = existing ? existing.messages.length + existing.broken.length : 0;
  const full = roomMessageSchema.parse({ ...message, seq, at: now.toISOString() });
  await fs.appendFile(file, `${JSON.stringify(full)}\n`, "utf8");
  return full;
  });
  });
}

/** 한 바퀴의 종류. 어느 쪽이든 Claude · Codex는 요청이 있으면 직접 고친다 (사용자 요청 2026-10-13). */
export type RoundKind = "talk" | "discuss";

/** 이 말 전체가 한 바퀴의 시작이면 그 종류. 앞뒤 공백만 빼고, 다른 글자가 있으면 시작이 아니다. */
export function roundKind(text: string): RoundKind | null {
  const line = text.trim();
  if (line === "대화 시작") return "talk";
  if (line === "토의 시작") return "discuss";
  return null;
}

export function roomStatus(messages: readonly RoomMessage[]): RoomStatus {
  const last = messages[messages.length - 1];
  if (!last) return "empty";
  if (last.role === "user") return roundKind(last.text) ? "waiting" : "idle";
  if (last.role === "speaker") return "idle";
  if (last.role === "operation") return last.status === "started" ? "waiting" : last.status === "failed" ? "failed" : "idle";
  return "failed";
}

export function roomTitle(messages: readonly RoomMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (first && first.role === "user") {
    const line = first.text.replace(/\s+/g, " ").trim();
    return line.length > 28 ? `${line.slice(0, 28)}…` : line;
  }
  const memory = messages.find((m) => m.role === "memory");
  if (memory && memory.role === "memory") {
    const named = memory.text.match(/「([^」]+)」/);
    return named ? `맥락 · ${named[1]}` : "맥락";
  }
  return "새 대화방";
}

export interface RoomSummary {
  preparationStatus?: string;
  id: string;
  title: string;
  status: RoomStatus;
  turns: number;
  updatedAt: string | null;
}

export async function listRooms(studioHome: string, alias: string): Promise<RoomSummary[]> {
  const dir = roomDir(studioHome, alias);
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const rows = await Promise.all(
    names.map(async (name) => {
      const id = name.slice(0, -".jsonl".length);
      const read = await readRoom(studioHome, alias, id);
      const messages = read?.messages ?? [];
      const last = messages[messages.length - 1];
      const meta = await readRoomMeta(studioHome, alias, id);
      return {
        id,
        title: displayRoomTitle(meta.title, messages),
        status: roomStatus(messages),
        turns: messages.filter((m) => m.role === "user").length,
        updatedAt: last?.at ?? null,
      };
    }),
  );
  return rows.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

/**
 * 이번에 답할 모델에게 줄 기록. 앞선 모델의 말이 그대로 들어가서, 한 방에서 서로 이어서 말한다.
 * 호스트 세션을 이어 가지 않는다 — Claude의 세션에는 Grok의 말이 없기 때문이다.
 */
export function roomPrompt(messages: readonly RoomMessage[], speaker: RoomSpeaker, model: string): string {
  const who = ROOM_SPEAKER_LABEL[speaker];
  const lines = messages.map((m) => {
    if (m.role === "user") {
      const to = m.to ? ` → ${ROOM_SPEAKER_LABEL[m.to]}${m.model ? ` · ${m.model}` : ""}` : "";
      return `[사람${to}]\n${m.text}`;
    }
    if (m.role === "speaker") return `[${ROOM_SPEAKER_LABEL[m.speaker]}${m.model ? ` · ${m.model}` : ""}]\n${m.text}`;
    if (m.role === "memory") return `[맥락]\n${m.text}`;
    return `[시스템]\n${m.text}`;
  });
  return [
    `너는 ${who}${model ? ` (${model})` : ""}다. 아래는 여러 모델이 한 대화방을 나눠 쓰는 기록이다.`,
    "맥락이 있으면 그 요구와 이미 나온 말을 알고 있는 것으로 본다.",
    "앞선 말을 읽고, 마지막에 사람에게 묻힌 말에 답한다. 다른 모델의 말을 네가 한 말인 것처럼 짓지 않는다.",
    "",
    ...lines,
  ].join("\n");
}

/**
 * 보내기는 검토로 끝나지 않는다 — 사람이 고치거나 실행해 달라고 했으면 그 LLM이 직접 한다 (사용자 요청 2026-10-13).
 * 파일을 고칠 권한을 제한할 수 있는 Claude · Codex에게만 준다.
 */
const ACT_INSTRUCTIONS = [
  "실행: 사람이 질문만 했으면 답한다. 무언가를 고치거나 만들거나 실행해 달라고 했으면(앞선 대화에서 정한 것을 하라는 말 포함) 검토나 제안으로 끝내지 말고 지금 작업 폴더의 프로젝트에 직접 반영한다.",
  "- 앞에 말한 사람이 이미 반영했으면 같은 일을 다시 하지 말고, 네 역할로 확인하거나 빠진 것만 보완한다.",
  "- 프로젝트 규칙 파일(CLAUDE.md · AGENTS.md와 그 파일이 가리키는 규칙)이 있으면 읽고 따른다.",
  "- 요청에서 직접 이어지는 파일만 고친다. 고친 뒤 형 검사 · 시험을 돌려 확인하고, 화면을 고쳤으면 빌드까지 해서 바로 보이게 한다.",
  "- 커밋은 사람이 요청했을 때만 한다. 푸시 · 파일 삭제 · 서버 재시작은 하지 않는다. 서버를 다시 켜야 반영되는 변경이면 그렇다고 적는다.",
  "- 요청이 모호하거나 사람이 정해야 할 것이 있으면 고치지 말고 질문만 남긴다.",
  "- 끝나면 한국어로 짧게 보고한다: 바꾼 것 · 확인한 결과(통과/실패 그대로) · 못 한 것.",
].join("\n");

const EDIT_INSTRUCTIONS = [
  "문서 · 시안 작성: 요청에 맞는 문서·설계·시안 파일만 작성하거나 고친다. 셸 명령 실행이나 프로젝트 전체 코드 변경은 하지 않는다.",
  "- 앞에 말한 사람이 초안을 이미 썼으면 같은 파일을 덮어쓰지 말고, 네 역할에 맞춰 사실 오류·구조 누락을 점검하거나 보완한다.",
  "- 끝나면 한국어로 짧게 보고한다: 작성·보완한 내용과 남은 쟁점.",
].join("\n");

const READ_INSTRUCTIONS = [
  "읽기 전용 모드: 이번 차례에는 프로젝트 파일을 수정하거나 삭제하지 않는다. 읽기와 분석만으로 답한다.",
].join("\n");

const canAct = (speaker: RoomSpeaker) => speaker === "claude-code" || speaker === "codex";

/** 한 바퀴에서 이 사람에게 주는 기록. 역할은 사람이 적은 문장이고, 모드가 켜져 있으면 모드 규약과 권한을 따른다. */
export function roundPrompt(
  messages: readonly RoomMessage[],
  member: { speaker: RoomSpeaker; model: string; role: string; name?: string },
  kind: RoundKind,
  mode?: Pick<RoomMode, "name" | "prompt" | "execution"> | null,
): string {
  const named = member.name?.trim() ? `역할명: ${member.name.trim()}\n` : "";
  const role = member.role.trim() || "역할이 비어 있다. 짧게 답한다.";
  const how =
    kind === "talk"
      ? "이번은 대화다. 네 역할로 사람이 꺼낸 주제만 답한다. 앞에 말한 사람의 결론을 받아치지 않는다."
      : "이번은 토의다. 네 역할로 답하고, 바로 앞에 말한 사람의 말에서 한 점을 받는다. 앞에 사람이 주제만 말했으면 그 주제만 답한다.";
  const modeBlock = mode
    ? `\n모드: ${mode.name}\n모드 규약: ${mode.prompt.trim() || "주제에 맞게 답한다."}`
    : "";
  const execution = mode?.execution ?? "apply";
  const actBlock =
    execution === "read"
      ? `\n${READ_INSTRUCTIONS}`
      : execution === "edit"
        ? canAct(member.speaker)
          ? `\n${EDIT_INSTRUCTIONS}`
          : ""
        : canAct(member.speaker)
          ? `\n${ACT_INSTRUCTIONS}`
          : "";
  return `${roomPrompt(messages, member.speaker, member.model)}\n\n${named}네 역할: ${role}\n${how}${modeBlock}${actBlock}`;
}

/** `title` 이 null 이면 아직 사람이 고치지 않았다. 빈 문자열이면 사람이 비웠다. */
export interface RoomMeta {
  title: string | null;
  kept: boolean;
  members: RoomMember[];
  /** 현재 이 대화방에 지정된 모드 id. 비어 있거나 null 이면 일반 대화. */
  modeId?: string | null;
  execution?: RoomExecution;
  /** 할일 「대화창 열기」로 만든 방이면 그 할일 id. 할일이 나온 방과 할일 자신의 방을 가른다. */
  todoId?: string;
}

const EMPTY_META: RoomMeta = { title: null, kept: false, members: [], modeId: null };

export function roomMetaPath(studioHome: string, alias: string, id: string): string {
  return path.join(roomDir(studioHome, alias), `${safeRoomId(id)}.meta.json`);
}

export function displayRoomTitle(title: string | null, messages: readonly RoomMessage[]): string {
  if (title === null) return roomTitle(messages);
  const line = title.replace(/\s+/g, " ").trim();
  return line || "제목 없음";
}

export async function readRoomMeta(studioHome: string, alias: string, id: string): Promise<RoomMeta> {
  try {
    const raw = JSON.parse(await fs.readFile(roomMetaPath(studioHome, alias, id), "utf8")) as Partial<RoomMeta>;
    return {
      title: typeof raw.title === "string" ? raw.title : null,
      kept: raw.kept === true,
      members: Array.isArray(raw.members) ? raw.members.flatMap((row, index) => { const member = normalizeMember(row); return member ? [{ ...member, id: member.id ?? `legacy-${index}` }] : []; }) : [],
      modeId: typeof raw.modeId === "string" && raw.modeId.trim() ? raw.modeId.trim() : null,
      ...(raw.execution ? { execution: roomExecutionSchema.parse(raw.execution) } : {}),
      ...(typeof raw.todoId === "string" && raw.todoId ? { todoId: raw.todoId } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY_META, members: [] };
    throw error;
  }
}

/** 대화방 기록과 제목 파일을 프로젝트 휴지통에 4일 보관한 뒤 원래 자리에서 지운다. */
export async function deleteRoom(studioHome: string, alias: string, id: string): Promise<boolean> {
  const payload: { transcript?: string; meta?: string } = {};
  try { payload.transcript = await fs.readFile(roomPath(studioHome, alias, id), "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  try { payload.meta = await fs.readFile(roomMetaPath(studioHome, alias, id), "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (payload.transcript === undefined && payload.meta === undefined) return false;
  await trashRecord(studioHome, alias, { kind: "room", recordId: id, payload });
  for (const file of [roomPath(studioHome, alias, id), roomMetaPath(studioHome, alias, id)]) {
    try { await fs.unlink(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return true;
}

/** 휴지통의 대화방 기록을 원래 자리로 되돌린다. 같은 ID의 대화가 이미 있으면 덮어쓰지 않는다. */
export async function restoreRoom(studioHome: string, alias: string, id: string, payload: { transcript?: string; meta?: string }): Promise<void> {
  const files = [[roomPath(studioHome, alias, id), payload.transcript], [roomMetaPath(studioHome, alias, id), payload.meta]] as const;
  if (files.some(([file]) => existsSync(file))) throw new TrashError("같은 ID의 대화가 이미 있어 되살리지 않았습니다.", 409);
  await fs.mkdir(roomDir(studioHome, alias), { recursive: true });
  for (const [file, text] of files) if (text !== undefined) await fs.writeFile(file, text, { encoding: "utf8", flag: "wx" });
}

export async function writeRoomMeta(studioHome: string, alias: string, id: string, meta: RoomMeta): Promise<void> {
  const file = roomMetaPath(studioHome, alias, id);
  await serialize(file, async () => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await withFileLock(file, async () => {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);
  const transcript = roomPath(studioHome, alias, id);
  try {
    await fs.access(transcript);
  } catch {
    try { await fs.writeFile(transcript, "", { encoding: "utf8", flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  });
  });
}

function normalizeMember(value: unknown): RoomMember | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { id?: unknown; speaker?: unknown; model?: unknown; role?: unknown; name?: unknown; enabled?: unknown; effort?: unknown; color?: unknown; image?: unknown; iconHtml?: unknown };
  const color = roomMemberSchema.shape.color.safeParse(row.color);
  const image = roomMemberSchema.shape.image.safeParse(row.image);
  const iconHtml = roomMemberSchema.shape.iconHtml.safeParse(row.iconHtml);
  if (typeof row.speaker !== "string" || !(ROOM_SPEAKERS as readonly string[]).includes(row.speaker)) return null;
  if (typeof row.model !== "string" || typeof row.role !== "string") return null;
  return {
    ...(typeof row.id === "string" && row.id ? { id: row.id } : {}),
    speaker: row.speaker as RoomMember["speaker"],
    model: row.model,
    role: row.role,
    name: typeof row.name === "string" ? row.name : "",
    enabled: row.enabled !== false,
    ...((row.speaker === "claude-code" || row.speaker === "codex") && (row.effort === "low" || row.effort === "medium" || row.effort === "high") ? { effort: row.effort } : {}),
    // 아이콘: 빠뜨리면 방을 읽을 때마다 색·이미지가 지워진다.
    ...(color.success && color.data ? { color: color.data } : {}),
    ...(image.success && image.data ? { image: image.data } : {}),
    ...(iconHtml.success && iconHtml.data ? { iconHtml: iconHtml.data } : {}),
  };
}

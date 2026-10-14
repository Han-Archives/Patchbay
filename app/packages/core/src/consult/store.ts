import fs from "node:fs/promises";
import path from "node:path";
import { projectStudioDir } from "../studio/studioStore.js";
import {
  consultMessageSchema,
  type ConsultMessage,
  type ConsultMeta,
  type ConsultStatus,
  type NewConsultMessage,
} from "./types.js";

/** 상담이 사는 곳: `~/.patchbay/projects/<alias>/consult/<consultId>.jsonl`. 덧붙이기만 한다 (원칙 16). */
export const CONSULT_DIR_NAME = "consult";
/**
 * 끝낸 대화가 가는 곳: `consult/archive/<consultId>.jsonl` + 색인 `consult/archive/index.jsonl` (사용자 요청 2026-10-08).
 * 한 상담이 호스트 세션 하나를 계속 이어 가면 맥락이 끝없이 길어진다. 끝낸 대화는 여기로 옮기고, 새 대화는
 * 빈 세션으로 연다 — 지금까지의 결과는 초안에 있고, 지난 말은 필요할 때만 여기서 찾아 읽는다.
 */
export const CONSULT_ARCHIVE_DIR_NAME = "archive";
const ARCHIVE_INDEX = "index.jsonl";

export function safeConsultId(id: string): string {
  if (!id || /[\\/]/.test(id) || id === "." || id === "..") throw new Error(`상담: id "${id}" 는 파일 이름이 될 수 없다.`);
  return id;
}

export function consultPath(studioHome: string, alias: string, id: string): string {
  return path.join(projectStudioDir(studioHome, alias), CONSULT_DIR_NAME, `${safeConsultId(id)}.jsonl`);
}

function archiveDir(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), CONSULT_DIR_NAME, CONSULT_ARCHIVE_DIR_NAME);
}

export function archivedConsultPath(studioHome: string, alias: string, id: string): string {
  return path.join(archiveDir(studioHome, alias), `${safeConsultId(id)}.jsonl`);
}

export interface ConsultRead {
  id: string;
  messages: ConsultMessage[];
  broken: { line: number; error: string }[];
  /** 끝내서 보관된 대화 — 읽기만 한다. */
  archived: boolean;
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** 진행 중인 대화를 먼저, 없으면 보관된 대화를 읽는다. */
export async function readConsult(studioHome: string, alias: string, id: string): Promise<ConsultRead | null> {
  let archived = false;
  let text = await readText(consultPath(studioHome, alias, id));
  if (text === null) {
    text = await readText(archivedConsultPath(studioHome, alias, id));
    if (text === null) return null;
    archived = true;
  }
  const messages: ConsultMessage[] = [];
  const broken: ConsultRead["broken"] = [];
  text.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = consultMessageSchema.safeParse(JSON.parse(line));
      if (parsed.success) messages.push(parsed.data);
      else broken.push({ line: index + 1, error: parsed.error.issues[0]?.message ?? "형식이 맞지 않는다" });
    } catch (error) {
      broken.push({ line: index + 1, error: (error as Error).message });
    }
  });
  return { id, messages, broken, archived };
}

export async function appendConsultMessage(
  studioHome: string,
  alias: string,
  id: string,
  message: NewConsultMessage,
  now: Date = new Date(),
): Promise<ConsultMessage> {
  const file = consultPath(studioHome, alias, id);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const existing = await readConsult(studioHome, alias, id);
  if (existing?.archived) throw new Error(`상담 ${id} 는 끝내서 보관됐다 — 새 상담에서 이어 간다.`);
  const seq = existing ? existing.messages.length + existing.broken.length : 0;
  const full = consultMessageSchema.parse({ ...message, seq, at: now.toISOString() });
  await fs.appendFile(file, `${JSON.stringify(full)}\n`, "utf8");
  return full;
}

export function consultStatus(messages: readonly ConsultMessage[]): ConsultStatus {
  const flow = messages.filter((m) => m.role !== "meta" && !(m.role === "system" && m.kind === "host-switch"));
  const last = flow[flow.length - 1];
  if (!last) return "empty";
  if (last.role === "system" && last.kind === "closed") return "closed";
  if (last.role === "user") return "waiting";
  if (last.role === "host") return "idle";
  return "failed";
}

/** 지금 쓰는 호스트 — 마지막 `meta`. 호스트를 바꾸면 새 `meta` 가 붙는다. */
export function currentConsultMeta(messages: readonly ConsultMessage[]): ConsultMeta | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message.role === "meta") return message;
  }
  return null;
}

export interface ConsultSummary {
  id: string;
  title: string;
  status: ConsultStatus;
  host: string | null;
  turns: number;
  updatedAt: string | null;
}

export async function listConsults(studioHome: string, alias: string): Promise<ConsultSummary[]> {
  const dir = path.join(projectStudioDir(studioHome, alias), CONSULT_DIR_NAME);
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const out: ConsultSummary[] = [];
  for (const name of names) {
    const read = await readConsult(studioHome, alias, name.slice(0, -".jsonl".length));
    if (!read) continue;
    const firstUser = read.messages.find((m) => m.role === "user");
    out.push({
      id: read.id,
      title: firstUser && firstUser.role === "user" ? firstUser.text.slice(0, 40) : "(빈 상담)",
      status: consultStatus(read.messages),
      host: currentConsultMeta(read.messages)?.host ?? null,
      turns: read.messages.filter((m) => m.role === "host").length,
      updatedAt: read.messages.at(-1)?.at ?? null,
    });
  }
  return out.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

/** 보관 색인 한 줄 — 호스트가 「열어 볼 만한가」를 이것만 보고 정한다. */
export interface ArchivedConsult {
  id: string;
  title: string;
  startedAt: string | null;
  closedAt: string;
  /** 호스트가 답한 턴 수. */
  turns: number;
  /** 이 대화가 초안에서 고친 칸 — 출처 기록(`consult`)에서. 「이 칸은 왜?」를 어느 대화에서 찾을지 알려 준다. */
  touched: string[];
}

export async function listArchivedConsults(studioHome: string, alias: string): Promise<ArchivedConsult[]> {
  const text = await readText(path.join(archiveDir(studioHome, alias), ARCHIVE_INDEX));
  if (!text) return [];
  const out: ArchivedConsult[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as ArchivedConsult);
    } catch {
      // 깨진 줄은 건너뛴다 — 대화 파일 자체는 그대로 있다.
    }
  }
  return out.sort((a, b) => b.closedAt.localeCompare(a.closedAt));
}

/**
 * 대화를 끝낸다: `closed` 한 줄을 덧붙이고, 파일을 `archive/` 로 옮기고, 색인에 한 줄 남긴다.
 * 지우지 않는다 (원칙 16) — 옮길 뿐이다. `touched` 는 부르는 쪽이 출처 기록에서 넘긴다(core의 ir 층을 여기서 읽지 않는다).
 */
export async function closeConsult(
  studioHome: string,
  alias: string,
  id: string,
  options: { touched?: string[]; now?: Date } = {},
): Promise<{ ok: true; entry: ArchivedConsult } | { ok: false; error: string }> {
  const read = await readConsult(studioHome, alias, id);
  if (!read) return { ok: false, error: `상담 ${id} 가 없다.` };
  if (read.archived) return { ok: false, error: `상담 ${id} 는 이미 끝냈다.` };
  const now = options.now ?? new Date();
  const turns = read.messages.filter((m) => m.role === "host").length;
  await appendConsultMessage(studioHome, alias, id, { role: "system", kind: "closed", text: `대화를 끝냈다 — 턴 ${turns}개를 보관했다.` }, now);
  const firstUser = read.messages.find((m) => m.role === "user");
  const entry: ArchivedConsult = {
    id,
    title: firstUser && firstUser.role === "user" ? firstUser.text.split("\n")[0]!.slice(0, 60) : "(빈 상담)",
    startedAt: read.messages[0]?.at ?? null,
    closedAt: now.toISOString(),
    turns,
    touched: [...new Set(options.touched ?? [])].sort(),
  };
  await fs.mkdir(archiveDir(studioHome, alias), { recursive: true });
  await fs.rename(consultPath(studioHome, alias, id), archivedConsultPath(studioHome, alias, id));
  await fs.appendFile(path.join(archiveDir(studioHome, alias), ARCHIVE_INDEX), `${JSON.stringify(entry)}\n`, "utf8");
  return { ok: true, entry };
}

export interface ConsultHit {
  id: string;
  seq: number;
  role: "user" | "host";
  at: string;
  /** 맞은 곳 앞뒤 — 전문은 `readConsultRange` 로. */
  snippet: string;
}

/** 보관된 대화에서 낱말을 찾는다 (대소문자 무시). 맥락을 아끼려고 조각만 돌려준다. */
export async function searchArchivedConsults(
  studioHome: string,
  alias: string,
  query: string,
  limit = 20,
): Promise<ConsultHit[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: ConsultHit[] = [];
  for (const entry of await listArchivedConsults(studioHome, alias)) {
    const read = await readConsult(studioHome, alias, entry.id);
    for (const m of read?.messages ?? []) {
      if (m.role !== "user" && m.role !== "host") continue;
      const at = m.text.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      const from = Math.max(0, at - 100);
      const snippet = `${from > 0 ? "…" : ""}${m.text.slice(from, at + needle.length + 100)}${at + needle.length + 100 < m.text.length ? "…" : ""}`;
      hits.push({ id: entry.id, seq: m.seq, role: m.role, at: m.at, snippet });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

/** 한 대화의 사람 · 상담자 말을 `fromSeq` 부터 `limit` 개. 긴 말은 자른다. 없으면 마지막 `limit` 개. */
export async function readConsultRange(
  studioHome: string,
  alias: string,
  id: string,
  options: { fromSeq?: number; limit?: number; maxChars?: number } = {},
): Promise<{ id: string; archived: boolean; total: number; messages: { seq: number; role: "user" | "host"; at: string; text: string }[] } | null> {
  const read = await readConsult(studioHome, alias, id);
  if (!read) return null;
  const limit = options.limit ?? 20;
  const maxChars = options.maxChars ?? 1500;
  const flow = read.messages.filter((m): m is Extract<ConsultMessage, { role: "user" | "host" }> => m.role === "user" || m.role === "host");
  const picked = options.fromSeq !== undefined ? flow.filter((m) => m.seq >= options.fromSeq!).slice(0, limit) : flow.slice(-limit);
  return {
    id,
    archived: read.archived,
    total: flow.length,
    messages: picked.map((m) => ({
      seq: m.seq,
      role: m.role,
      at: m.at,
      text: m.text.length > maxChars ? `${m.text.slice(0, maxChars)}… (${m.text.length - maxChars}자 더)` : m.text,
    })),
  };
}

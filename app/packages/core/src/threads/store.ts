import fs from "node:fs/promises";
import path from "node:path";
import { projectStudioDir } from "../studio/studioStore.js";
import {
  threadMessageSchema,
  type NewThreadMessage,
  type ThreadGraphMessage,
  type ThreadMessage,
  type ThreadStatus,
} from "./types.js";

/**
 * 대화가 사는 곳: `~/.patchbay/projects/<alias>/threads/<threadId>.jsonl`.
 * **한 줄 = 메시지 하나, 덧붙이기만 한다** — 고치지도 지우지도 않는다 (원칙 16).
 * 파일 이름이 LangGraph `thread_id`다.
 */

export const THREADS_DIR_NAME = "threads";

/** 호스트 모델이 답하는 데 주는 기본 시간. 노드가 `interrupt` 값에 `timeoutMs`를 실으면 그쪽이 이긴다. */
export const DEFAULT_HOST_TIMEOUT_MS = 10 * 60 * 1000;

export function projectThreadsDir(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), THREADS_DIR_NAME);
}

/** id가 파일 이름이 되므로 구분자 · 상위 참조를 거절한다 (`safeRunId`와 같은 이유). */
export function safeThreadId(threadId: string): string {
  if (!threadId || /[\\/]/.test(threadId) || threadId === "." || threadId === "..") {
    throw new Error(`대화: threadId "${threadId}" 는 파일 이름이 될 수 없다.`);
  }
  return threadId;
}

export function threadPath(studioHome: string, alias: string, threadId: string): string {
  return path.join(projectThreadsDir(studioHome, alias), `${safeThreadId(threadId)}.jsonl`);
}

export interface ThreadRead {
  threadId: string;
  messages: ThreadMessage[];
  /** 읽지 못한 줄. 깨진 줄은 건너뛰되 숨기지 않는다. */
  broken: { line: number; error: string }[];
}

export async function readThread(studioHome: string, alias: string, threadId: string): Promise<ThreadRead | null> {
  let text: string;
  try {
    text = await fs.readFile(threadPath(studioHome, alias, threadId), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const messages: ThreadMessage[] = [];
  const broken: ThreadRead["broken"] = [];
  text.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = threadMessageSchema.safeParse(JSON.parse(line));
      if (parsed.success) messages.push(parsed.data);
      else broken.push({ line: index + 1, error: parsed.error.issues[0]?.message ?? "형식이 맞지 않는다" });
    } catch (error) {
      broken.push({ line: index + 1, error: (error as Error).message });
    }
  });
  return { threadId, messages, broken };
}

/** 메시지 하나를 붙인다. `seq`는 지금까지의 줄 수, `at`은 지금. 붙인 메시지를 돌려준다. */
export async function appendThreadMessage(
  studioHome: string,
  alias: string,
  threadId: string,
  message: NewThreadMessage,
  now: Date = new Date(),
): Promise<ThreadMessage> {
  const file = threadPath(studioHome, alias, threadId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const existing = await readThread(studioHome, alias, threadId);
  const seq = existing ? existing.messages.length + existing.broken.length : 0;
  const full = threadMessageSchema.parse({ ...message, seq, at: now.toISOString() });
  await fs.appendFile(file, `${JSON.stringify(full)}\n`, "utf8");
  return full;
}

/** 아직 답도 시간 초과도 없는 `waiting` — 대화마다 많아야 하나다. */
export function openRequest(messages: readonly ThreadMessage[]): ThreadGraphMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message.role === "host" || message.role === "system") return null;
    if (message.role === "graph") return message.status === "waiting" ? message : null;
  }
  return null;
}

export function threadStatus(messages: readonly ThreadMessage[]): ThreadStatus {
  const flow = messages.filter((message) => message.role !== "feedback");
  const last = flow[flow.length - 1];
  if (!last) return "empty";
  if (last.role === "user") return "sent";
  if (last.role === "host" || last.role === "system") return "resuming";
  if (last.role === "graph") {
    if (last.status === "waiting") return "waiting";
    return last.status === "success" ? "done" : "failed";
  }
  return "empty";
}

export interface ThreadSummary {
  threadId: string;
  /** 첫 사람 메시지의 앞부분 — 목록에서 대화를 알아보는 이름. */
  title: string;
  status: ThreadStatus;
  assistantId: string | null;
  messages: number;
  updatedAt: string | null;
}

export function summarizeThread(read: ThreadRead): ThreadSummary {
  const firstUser = read.messages.find((message) => message.role === "user");
  const graph = read.messages.find((message) => message.role === "graph");
  const last = read.messages[read.messages.length - 1];
  const title = firstUser && firstUser.role === "user" ? firstUser.text.split("\n")[0]!.slice(0, 60) : "(빈 대화)";
  return {
    threadId: read.threadId,
    title,
    status: threadStatus(read.messages),
    assistantId: graph && graph.role === "graph" ? graph.assistantId : null,
    messages: read.messages.length,
    updatedAt: last?.at ?? null,
  };
}

/** 프로젝트의 대화들, 최근 것이 앞. */
export async function listThreads(studioHome: string, alias: string): Promise<ThreadSummary[]> {
  let names: string[];
  try {
    names = await fs.readdir(projectThreadsDir(studioHome, alias));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const summaries: ThreadSummary[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const read = await readThread(studioHome, alias, name.slice(0, -".jsonl".length));
    if (read) summaries.push(summarizeThread(read));
  }
  return summaries.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export interface PendingRequest {
  alias: string;
  threadId: string;
  /** 답할 때 쓰는 번호. */
  seq: number;
  assistantId: string;
  nodeId: string | null;
  request: unknown;
  /** 이 대화에서 사람이 마지막으로 적은 말 — 호스트가 맥락을 다시 읽지 않아도 되게. */
  userText: string | null;
  at: string;
  deadlineAt: string | null;
}

/** 답을 기다리는 요청들. 호스트 모델이 MCP로 읽는다. */
export async function listPendingRequests(studioHome: string, alias: string): Promise<PendingRequest[]> {
  const pending: PendingRequest[] = [];
  for (const summary of await listThreads(studioHome, alias)) {
    if (summary.status !== "waiting") continue;
    const read = await readThread(studioHome, alias, summary.threadId);
    const open = read ? openRequest(read.messages) : null;
    if (!read || !open) continue;
    const lastUser = [...read.messages].reverse().find((message) => message.role === "user");
    pending.push({
      alias,
      threadId: summary.threadId,
      seq: open.seq,
      assistantId: open.assistantId,
      nodeId: open.nodeId ?? null,
      request: open.request ?? null,
      userText: lastUser && lastUser.role === "user" ? lastUser.text : null,
      at: open.at,
      deadlineAt: open.deadlineAt ?? null,
    });
  }
  return pending.sort((a, b) => a.at.localeCompare(b.at));
}

export type AnswerResult = { ok: true; message: ThreadMessage } | { ok: false; error: string };

/**
 * 호스트의 답을 붙인다. 열린 요청이 없거나 번호가 다르면 거절한다 — 이미 닫힌 요청에
 * 답이 두 번 붙으면 그래프가 어느 답으로 재개됐는지 기록이 말하지 못한다.
 * 그래프를 다시 돌리는 일은 여기서 하지 않는다: 이 함수는 파일만 쓰고, 재개는 콘솔이 한다.
 */
export async function answerRequest(
  studioHome: string,
  alias: string,
  threadId: string,
  answer: { seq?: number; text: string; refused?: boolean; model?: string },
  now: Date = new Date(),
): Promise<AnswerResult> {
  const read = await readThread(studioHome, alias, threadId);
  if (!read) return { ok: false, error: `대화 ${threadId} 가 없다.` };
  const open = openRequest(read.messages);
  if (!open) return { ok: false, error: "답을 기다리는 요청이 없다 — 이미 답했거나 시간 초과로 닫혔다." };
  if (answer.seq !== undefined && answer.seq !== open.seq) {
    return { ok: false, error: `열린 요청은 ${open.seq}번이다 (받은 번호 ${answer.seq}).` };
  }
  if (!answer.refused && !answer.text.trim()) return { ok: false, error: "답이 비어 있다. 거절이면 refused 로 보낸다." };
  const ms = Math.max(0, now.getTime() - Date.parse(open.at));
  const message = await appendThreadMessage(
    studioHome,
    alias,
    threadId,
    {
      role: "host",
      replyTo: open.seq,
      outcome: answer.refused ? "refused" : "answered",
      text: answer.text,
      ...(answer.model ? { model: answer.model } : {}),
      ...(Number.isFinite(ms) ? { ms } : {}),
    },
    now,
  );
  return { ok: true, message };
}

/** 한도를 넘긴 열린 요청을 「시간 초과」로 닫는다. 닫았으면 그 메시지를 돌려준다. */
export async function expireRequest(
  studioHome: string,
  alias: string,
  threadId: string,
  now: Date = new Date(),
): Promise<ThreadMessage | null> {
  const read = await readThread(studioHome, alias, threadId);
  const open = read ? openRequest(read.messages) : null;
  if (!open?.deadlineAt || Date.parse(open.deadlineAt) > now.getTime()) return null;
  return appendThreadMessage(
    studioHome,
    alias,
    threadId,
    { role: "system", replyTo: open.seq, outcome: "timeout", text: "한도 시간 안에 호스트의 답이 없었다." },
    now,
  );
}

/**
 * 재개할 때 그래프의 `interrupt()`가 돌려받는 값. 노드는 `status`로 갈래를 고른다 —
 * `answered`면 `text`를 쓰고, `refused` · `timeout`이면 이유를 비우고 오류 갈래로 간다.
 */
export function resumeValueOf(
  messages: readonly ThreadMessage[],
): { status: "answered" | "refused" | "timeout"; text: string; model?: string } | null {
  const last = messages.filter((message) => message.role !== "feedback").at(-1);
  if (!last) return null;
  if (last.role === "host") {
    return { status: last.outcome, text: last.text, ...(last.model ? { model: last.model } : {}) };
  }
  if (last.role === "system") return { status: "timeout", text: last.text };
  return null;
}

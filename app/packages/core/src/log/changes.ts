import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { logPaths } from "./paths.js";

/**
 * 바뀌는 순간 남기는 변동 (사용자 결정 2026-10-15 D6). 할일 · 흐름도 항목의 원문에는 삭제 · 되돌림 ·
 * 고침 시각이 없어서, 저장 함수가 앞뒤를 비교해 `log/events/changes.jsonl` 에 한 줄씩 덧붙인다.
 * 이 기록이 생긴 날부터만 보장한다. 기록에 실패해도 할일 저장은 막지 않는다.
 */
export const logChangeSchema = z.object({
  at: z.string(),
  target: z.enum(["todo", "cycle"]),
  id: z.string().min(1),
  change: z.enum(["add", "done", "undone", "delete", "edit"]),
  title: z.string(),
  tag: z.string().optional(),
  todoId: z.string().optional(),
  roomId: z.string().optional(),
});
export type LogChange = z.infer<typeof logChangeSchema>;

interface TodoLike { id: string; title: string; detail?: string; done: boolean; roomId?: string }
interface CycleLike { id: string; name: string; desc: string; tag: string; todoId?: string }

export function todoChanges(before: readonly TodoLike[], after: readonly TodoLike[], at: string): LogChange[] {
  const old = new Map(before.map((row) => [row.id, row]));
  const now = new Set(after.map((row) => row.id));
  const out: LogChange[] = [];
  const base = (row: TodoLike) => ({ at, target: "todo" as const, id: row.id, title: row.title, ...(row.roomId ? { roomId: row.roomId } : {}) });
  for (const row of after) {
    const prev = old.get(row.id);
    if (!prev) {
      out.push({ ...base(row), change: "add" });
      if (row.done) out.push({ ...base(row), change: "done" });
      continue;
    }
    if (!prev.done && row.done) out.push({ ...base(row), change: "done" });
    if (prev.done && !row.done) out.push({ ...base(row), change: "undone" });
    if (prev.title !== row.title || (prev.detail ?? "") !== (row.detail ?? "")) out.push({ ...base(row), change: "edit" });
  }
  for (const row of before) if (!now.has(row.id)) out.push({ ...base(row), change: "delete" });
  return out;
}

export function cycleChanges(before: readonly CycleLike[], after: readonly CycleLike[], at: string): LogChange[] {
  const old = new Map(before.map((row) => [row.id, row]));
  const now = new Set(after.map((row) => row.id));
  const out: LogChange[] = [];
  const base = (row: CycleLike) => ({ at, target: "cycle" as const, id: row.id, title: row.name, tag: row.tag, ...(row.todoId ? { todoId: row.todoId } : {}) });
  for (const row of after) {
    const prev = old.get(row.id);
    if (!prev) out.push({ ...base(row), change: "add" });
    else if (prev.name !== row.name || prev.desc !== row.desc || prev.tag !== row.tag) out.push({ ...base(row), change: "edit" });
  }
  for (const row of before) if (!now.has(row.id)) out.push({ ...base(row), change: "delete" });
  return out;
}

/** 한 줄씩 덧붙인다 (O_APPEND — 짧은 줄은 프로세스 사이에서도 섞이지 않는다). */
export async function appendLogChanges(studioHome: string, alias: string, changes: readonly LogChange[]): Promise<void> {
  if (!changes.length) return;
  const file = logPaths(studioHome, alias).changes;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, changes.map((row) => `${JSON.stringify(logChangeSchema.parse(row))}\n`).join(""), "utf8");
  } catch {
    /* Log 변동은 덧붙임 기록일 뿐 — 실패해도 할일 · 흐름도 저장을 되돌리지 않는다. */
  }
}

export async function readLogChanges(studioHome: string, alias: string): Promise<{ changes: LogChange[]; broken: number }> {
  let text = "";
  try { text = await fs.readFile(logPaths(studioHome, alias).changes, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { changes: [], broken: 0 }; throw error; }
  const changes: LogChange[] = [];
  let broken = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = logChangeSchema.safeParse(JSON.parse(line));
      if (parsed.success) changes.push(parsed.data); else broken++;
    } catch { broken++; }
  }
  return { changes, broken };
}

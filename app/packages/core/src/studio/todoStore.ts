import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { projectStudioDir } from "./studioStore.js";
import { readRoom, readRoomMeta, withFileLock } from "../rooms/store.js";
import { appendLogChanges, todoChanges } from "../log/changes.js";

/**
 * 프로젝트의 이후 할 일 — 대시보드 오른쪽 「할 일」 칸 (사용자 요청 2026-10-13).
 * 사용자와 Agent가 함께 추가·정렬·완료한다. 배열 순서가 실행 순서다.
 * 화면이 상태를 보고 만드는 막힘 항목(모델 미정 · 자격 증명 · 열린 질문 · 시험)과 따로 둔다.
 * 완료 시각과 연결 대화도 저장하며, 완료 기록은 todo-history에 보관한다.
 */
export const TODOS_FILE_NAME = "todos.json";

/** 시각. Agent가 파일을 직접 고치며 `+09:00` 같은 시간대를 붙여도 읽고, UTC(`Z`)로 맞춰 저장한다. */
const isoTime = z.string().datetime({ offset: true }).transform(value => new Date(value).toISOString());
export const todoItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  /** 펼치면 보이는 설명. */
  detail: z.string().max(2000).optional(),
  done: z.boolean(),
  at: z.string(),
  completedAt: isoTime.optional(),
  roomId: z.string().min(1).refine(id => !/[\\/]/.test(id) && id !== "." && id !== "..").optional(),
  source: z.enum(["stage", "attention"]).optional(),
  inactive: z.boolean().optional(),
  /** 삭제한 자동 추천이 동기화로 다시 나타나지 않게 하는 표시. */
  deletedAt: isoTime.optional(),
});
export type TodoItem = z.infer<typeof todoItemSchema>;
export const TODO_VISIBLE_MS = 3 * 24 * 60 * 60 * 1000;
export const TODO_HISTORY_DIR = "todo-history";

export interface TodoHistoryEntry { id: string; title: string; at: string; completedAt: string; roomId?: string; folder: string; detail?: string }
const writes = new Map<string, Promise<unknown>>();

const todosFileSchema = z.object({ todos: z.array(todoItemSchema) });
// 예전 직접 파일 쓰기가 세부 항목의 출처를 할일에 섞어 적은 경우만 읽기 호환한다.
// 새 저장은 todoItemSchema로 엄격히 검사하며, 알 수 없는 오류나 항목은 버리지 않는다.
const storedTodoSchema = z.preprocess(value => {
  if (value && typeof value === "object" && "source" in value && value.source === "llm") {
    const { source: _source, ...todo } = value;
    return todo;
  }
  return value;
}, todoItemSchema);

export function todosPath(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), TODOS_FILE_NAME);
}

export async function readTodos(studioHome: string, alias: string): Promise<TodoItem[]> {
  return (await readStoredTodos(studioHome, alias)).todos;
}

async function readStoredTodos(studioHome: string, alias: string): Promise<{ todos: TodoItem[]; migrated: boolean }> {
  let text: string;
  try {
    text = await fs.readFile(todosPath(studioHome, alias), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { todos: [], migrated: false };
    throw error;
  }
  const stored = z.object({ todos: z.array(z.unknown()) }).parse(JSON.parse(text));
  const migrated = stored.todos.some(row => row && typeof row === "object" && "source" in row && row.source === "llm");
  return { todos: z.array(storedTodoSchema).parse(stored.todos), migrated };
}

async function atomicWrite(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, text, "utf8");
  await fs.rename(tmp, file);
}

export function todoHistoryDir(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), TODO_HISTORY_DIR);
}

export async function readTodoHistory(studioHome: string, alias: string): Promise<TodoHistoryEntry[]> {
  try { return JSON.parse(await fs.readFile(path.join(todoHistoryDir(studioHome, alias), "index.json"), "utf8")) as TodoHistoryEntry[]; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

async function writeIfChanged(file: string, text: string) {
  try { if (await fs.readFile(file, "utf8") === text) return; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await atomicWrite(file, text);
}

/** 완료 즉시 보관하고, 연결된 대화의 갱신도 반영한다. */
async function archiveTodos(studioHome: string, alias: string, todos: TodoItem[]) {
  const root = todoHistoryDir(studioHome, alias);
  const index = new Map((await readTodoHistory(studioHome, alias)).map(row => [row.id, row]));
  for (const todo of todos.filter(row => row.done && row.completedAt)) {
    const folder = createHash("sha256").update(todo.id).digest("hex").slice(0, 24);
    const dir = path.join(root, folder);
    const summary = `# ${todo.title}\n\nID: ${todo.id}\n등록: ${todo.at}\n완료: ${todo.completedAt}\n대화: ${todo.roomId ?? "없음"}\n\n## 요구사항\n\n${todo.detail ?? todo.title}\n\n## 결과와 대화\n\n${todo.roomId ? "conversations/의 연결 대화 원문에서 수행 과정과 결과를 확인한다." : "사용자가 완료 처리한 할일."}\n`;
    await writeIfChanged(path.join(dir, "task.json"), `${JSON.stringify(todo, null, 2)}\n`);
    await writeIfChanged(path.join(dir, "summary.md"), summary);
    if (todo.roomId) {
      const room = await readRoom(studioHome, alias, todo.roomId);
      if (room) {
        const meta = await readRoomMeta(studioHome, alias, todo.roomId);
        const name = createHash("sha256").update(todo.roomId).digest("hex").slice(0, 24);
        await writeIfChanged(path.join(dir, "conversations", `${name}.json`), `${JSON.stringify({ ...room, meta }, null, 2)}\n`);
        await writeIfChanged(path.join(dir, "conversations", `${name}.md`), `# ${todo.title}\n\n대화 ID: ${room.id}\n\n${room.messages.map(message => `## ${message.at} · ${message.role}${message.role === "speaker" ? ` · ${message.speaker}` : ""}\n\n${message.text}`).join("\n\n")}\n`);
      }
    }
    index.set(todo.id, { id: todo.id, title: todo.title, at: todo.at, completedAt: todo.completedAt!, folder: `${TODO_HISTORY_DIR}/${folder}`, ...(todo.roomId ? { roomId: todo.roomId } : {}), ...(todo.detail ? { detail: todo.detail } : {}) });
  }
  if (!index.size) return;
  const rows = [...index.values()].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  await writeIfChanged(path.join(root, "index.json"), `${JSON.stringify(rows, null, 2)}\n`);
  const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/[\r\n]/g, " ");
  await writeIfChanged(path.join(root, "index.md"), `# 할일 기록\n\n| ID | 제목 | 등록일 | 완료 일시 | 대화 ID | 폴더 |\n| --- | --- | --- | --- | --- | --- |\n${rows.map(row => `| ${[row.id, row.title, row.at, row.completedAt, row.roomId ?? "", row.folder].map(cell).join(" | ")} |`).join("\n")}\n`);
}

/** 서버와 CLI가 같은 파일을 변경해도 유실되지 않도록 큐와 파일 잠금을 함께 쓴다. */
export function updateTodos(studioHome: string, alias: string, change: (fresh: TodoItem[]) => TodoItem[] | Promise<TodoItem[]>, now = new Date()): Promise<TodoItem[]> {
  const file = todosPath(studioHome, alias);
  const next = (writes.get(file) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    return withFileLock(file, async () => {
      const { todos: fresh, migrated } = await readStoredTodos(studioHome, alias);
      const previous = new Map(fresh.map(row => [row.id, row]));
      const todos = todosFileSchema.parse({ todos: await change(fresh) }).todos.map(row => {
        const old = previous.get(row.id);
        const merged = { ...old, ...row };
        if (merged.done) merged.completedAt = row.completedAt ?? (old?.done ? old.completedAt : undefined) ?? now.toISOString();
        else delete merged.completedAt;
        return merged;
      });
      if (new Set(todos.map(row => row.id)).size !== todos.length) throw new Error("할일 ID가 중복된다.");
      if (migrated || JSON.stringify(fresh) !== JSON.stringify(todos)) {
        await atomicWrite(file, `${JSON.stringify({ todos }, null, 2)}\n`);
        // 화면이 상태를 보고 만드는 항목(source)은 사람의 변동이 아니라서 Log에 남기지 않는다.
        const human = (rows: TodoItem[]) => rows.filter(row => !row.source);
        await appendLogChanges(studioHome, alias, todoChanges(human(fresh), human(todos), now.toISOString()));
      }
      await archiveTodos(studioHome, alias, todos);
      return todos;
    });
  });
  writes.set(file, next);
  void next.finally(() => { if (writes.get(file) === next) writes.delete(file); }).catch(() => undefined);
  return next;
}

export async function writeTodos(studioHome: string, alias: string, todos: TodoItem[]): Promise<void> {
  await updateTodos(studioHome, alias, () => todos);
}

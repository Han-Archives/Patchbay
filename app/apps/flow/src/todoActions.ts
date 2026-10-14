import { randomUUID } from "node:crypto";
import { appendRoomMessage, newRoomId, readAgents, readRoom, todoItemSchema, updateTodos, writeRoomMeta, type TodoItem } from "@patchbay/core";

type TodoAction = { action: "add"; title: string; detail?: string } | { action: "sync"; suggestions: TodoItem[] } | { action: "complete" | "room"; id: string } | { action: "move"; id: string; beforeId: string | null };

export class TodoActionError extends Error { constructor(message: string, public status: 400 | 404 | 409 = 400) { super(message); } }

function parseAction(input: unknown): TodoAction {
  const invalid = () => new TodoActionError("할일 요청 형식이 올바르지 않습니다.");
  if (!input || typeof input !== "object") throw invalid();
  const row = input as Record<string, unknown>;
  if (row.action === "add") {
    if (typeof row.title !== "string" || !row.title.trim() || row.title.trim().length > 200 || (row.detail !== undefined && (typeof row.detail !== "string" || row.detail.length > 2000))) throw invalid();
    return { action: "add", title: row.title.trim(), ...(typeof row.detail === "string" ? { detail: row.detail.trim() } : {}) };
  }
  if (row.action === "sync") {
    if (!Array.isArray(row.suggestions)) throw invalid();
    const suggestions = row.suggestions.map(value => { const parsed = todoItemSchema.safeParse(value); if (!parsed.success || !parsed.data.source) throw invalid(); return parsed.data; });
    return { action: "sync", suggestions };
  }
  if (typeof row.id !== "string" || !row.id) throw invalid();
  if (row.action === "complete" || row.action === "room") return { action: row.action, id: row.id };
  if (row.action === "move" && (typeof row.beforeId === "string" || row.beforeId === null)) return { action: "move", id: row.id, beforeId: row.beforeId };
  throw invalid();
}

/** 할일 변경만 수행한다. 대화 생성에서는 LLM을 호출하지 않는다. */
export async function applyTodoAction(home: string, alias: string, input: unknown, isRunning: (id: string) => boolean, now = new Date()) {
  const action = parseAction(input);
  let roomId: string | undefined;
  const running = (todo: TodoItem) => !!todo.roomId && isRunning(todo.roomId);
  const todos = await updateTodos(home, alias, async fresh => {
    if (action.action === "add") return [...fresh, { id: randomUUID(), title: action.title, detail: action.detail, done: false, at: now.toISOString() }];
    if (action.action === "sync") {
      const suggestions = action.suggestions;
      const ids = new Set(suggestions.map(row => row.id));
      const next = fresh.map(row => row.source && !row.done ? { ...row, inactive: !ids.has(row.id) } : row);
      for (const row of suggestions) {
        const old = next.find(item => item.id === row.id);
        if (old) { old.inactive = false; continue; }
        if (!next.some(item => !item.done && item.title === row.title)) next.push({ ...row, at: now.toISOString() });
      }
      return next;
    }
    const todo = fresh.find(row => row.id === action.id);
    if (!todo) throw new TodoActionError("할일을 찾을 수 없습니다.", 404);
    if (action.action === "complete") {
      if (running(todo)) throw new TodoActionError("작업이 실행 중입니다. 실행이 끝난 뒤 완료 처리해주세요.", 409);
      return fresh.map(row => row.id === todo.id ? { ...row, done: true } : row);
    }
    if (action.action === "move") {
      if (todo.done || todo.inactive || running(todo)) throw new TodoActionError("실행 중이거나 완료된 할일은 이동할 수 없습니다.", 409);
      const movable = fresh.filter(row => !row.done && !row.inactive && !running(row));
      const rest = movable.filter(row => row.id !== todo.id);
      const target = action.beforeId === null ? rest.length : rest.findIndex(row => row.id === action.beforeId);
      if (target < 0) throw new TodoActionError("이동할 위치가 바뀌었습니다. 목록을 새로 확인해주세요.", 409);
      rest.splice(target, 0, todo);
      let i = 0;
      return fresh.map(row => movable.includes(row) ? rest[i++]! : row);
    }
    if (todo.roomId && await readRoom(home, alias, todo.roomId)) { roomId = todo.roomId; return fresh; }
    roomId = newRoomId(now);
    const agents = await readAgents(home, alias);
    await writeRoomMeta(home, alias, roomId, { title: todo.title, kept: false, members: agents });
    await appendRoomMessage(home, alias, roomId, { role: "user", text: `${todo.title}${todo.detail ? `\n\n${todo.detail}` : ""}` }, now);
    // API에서 생성한 대화는 기존 대화 UI로 연다. 예시·안내 문구를 추가하지 않는다.
    return fresh.map(row => row.id === todo.id ? { ...row, roomId } : row);
  }, now);
  return { todos, ...(roomId ? { roomId } : {}) };
}

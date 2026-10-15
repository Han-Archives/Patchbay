import { randomUUID } from "node:crypto";
import { cycleItemSchema, readCycleItems, readTodos, updateCycleItems, updateTodos, type CycleItem, type TodoItem } from "@patchbay/core";

export type CycleItemStatus = "wait" | "run" | "done";
/** 화면에 내려보내는 세부 항목 — 상태와 할일에 올라가 있는지를 붙인다. */
export type CycleItemRow = CycleItem & { status: CycleItemStatus; queued: boolean };

type Action =
  | { action: "add"; step: CycleItem["step"]; task: string; name: string; desc: string; tag: CycleItem["tag"] }
  | { action: "del" | "play" | "unplay"; id: string };

const STEP_LABEL: Record<CycleItem["step"], string> = { design: "설계", build: "구현", test: "테스트", review: "Review", result: "결과" };

export class CycleItemActionError extends Error { constructor(message: string, public status: 400 | 404 | 409 = 400) { super(message); } }

function parseAction(input: unknown): Action {
  const invalid = () => new CycleItemActionError("세부 항목 요청 형식이 올바르지 않습니다.");
  if (!input || typeof input !== "object") throw invalid();
  const row = input as Record<string, unknown>;
  if (row.action === "add") {
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const desc = typeof row.desc === "string" ? row.desc.trim() : "";
    const shape = cycleItemSchema.pick({ step: true, task: true, name: true, desc: true, tag: true }).safeParse({ step: row.step, task: row.task, name, desc, tag: row.tag });
    if (!shape.success) throw invalid();
    return { action: "add", ...shape.data };
  }
  if ((row.action === "del" || row.action === "play" || row.action === "unplay") && typeof row.id === "string" && row.id) return { action: row.action, id: row.id };
  throw invalid();
}

/** 연결된 할일이 없으면 대기, 할일이 끝났으면 완료, 그 할일의 대화가 실제로 돌고 있으면 진행. */
export function cycleItemStatus(item: CycleItem, todos: TodoItem[], isRunning: (roomId: string) => boolean): { status: CycleItemStatus; queued: boolean } {
  const todo = item.todoId ? todos.find(row => row.id === item.todoId) : undefined;
  if (!todo) return { status: "wait", queued: false };
  if (todo.done) return { status: "done", queued: false };
  return { status: todo.roomId && isRunning(todo.roomId) ? "run" : "wait", queued: true };
}

export async function listCycleItems(home: string, alias: string, isRunning: (roomId: string) => boolean): Promise<CycleItemRow[]> {
  const [items, todos] = await Promise.all([readCycleItems(home, alias), readTodos(home, alias)]);
  return items.map(item => ({ ...item, ...cycleItemStatus(item, todos, isRunning) }));
}

/** 추가 · 빼기 · 할일로 보내기 · 할일에서 빼기. LLM은 호출하지 않는다. */
export async function applyCycleItemAction(home: string, alias: string, input: unknown, isRunning: (roomId: string) => boolean, now = new Date()): Promise<{ items: CycleItemRow[] }> {
  const action = parseAction(input);
  if (action.action === "add") {
    const { action: _kind, ...fields } = action;
    await updateCycleItems(home, alias, fresh => [...fresh, { id: randomUUID(), ...fields, source: "user", at: now.toISOString() }]);
    return { items: await listCycleItems(home, alias, isRunning) };
  }
  const item = (await readCycleItems(home, alias)).find(row => row.id === action.id);
  if (!item) throw new CycleItemActionError("세부 항목을 찾을 수 없습니다.", 404);
  const state = cycleItemStatus(item, await readTodos(home, alias), isRunning);
  if (action.action === "del") {
    if (state.status === "run") throw new CycleItemActionError("실행 중인 항목은 뺄 수 없습니다.", 409);
    // 이미 할일에 올린 것은 할일에 그대로 둔다.
    await updateCycleItems(home, alias, fresh => fresh.filter(row => row.id !== item.id));
  } else if (action.action === "play") {
    if (state.status === "done") throw new CycleItemActionError("이미 완료된 항목입니다.", 409);
    if (!state.queued) {
      const todoId = randomUUID();
      const detail = [item.desc, `Workflow · ${STEP_LABEL[item.step]} › ${item.task}`].filter(Boolean).join("\n\n");
      await updateTodos(home, alias, fresh => [...fresh, { id: todoId, title: item.name, detail, done: false, at: now.toISOString() }], now);
      await updateCycleItems(home, alias, fresh => fresh.map(row => row.id === item.id ? { ...row, todoId } : row));
    }
  } else {
    if (state.status === "run") throw new CycleItemActionError("실행 중인 할일은 뺄 수 없습니다.", 409);
    if (state.queued) await updateTodos(home, alias, fresh => fresh.filter(row => row.id !== item.todoId), now);
    await updateCycleItems(home, alias, fresh => fresh.map(row => { if (row.id !== item.id) return row; const { todoId: _todo, ...rest } = row; return rest; }));
  }
  return { items: await listCycleItems(home, alias, isRunning) };
}

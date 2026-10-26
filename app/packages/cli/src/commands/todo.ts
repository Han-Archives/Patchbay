import { randomUUID } from "node:crypto";
import { readStudio, readTodos, resolveStudioHome, updateTodos } from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface TodoCommandOptions {
  project?: string; id?: string; title?: string; detail?: string; room?: string;
  done?: boolean; pending?: boolean; first?: boolean; json?: boolean;
  /** order: 앞으로 올릴 미완료 할일 ID를 쉼표로, 원하는 순서대로. */
  ids?: string;
}

/** 부분 변경만 저장해 다른 항목·순서·자동 추천 출처를 보존한다. */
export async function runTodo(action: "list" | "add" | "update" | "order", options: TodoCommandOptions, home = resolveStudioHome()): Promise<number> {
  const json = Boolean(options.json);
  try {
    const alias = options.project;
    if (!alias || !(await readStudio(home)).projects.some(p => p.alias === alias)) throw new Error("등록된 --project가 필요합니다.");
    if (options.done && options.pending) throw new Error("--done과 --pending은 함께 지정할 수 없습니다.");
    const id = options.id ?? randomUUID();
    if (action === "update" && !options.id) throw new Error("수정할 --id가 필요합니다.");
    if (action === "add" && !options.title?.trim()) throw new Error("추가할 --title이 필요합니다.");
    const order = (options.ids ?? "").split(",").map(value => value.trim()).filter(Boolean);
    if (action === "order" && (!order.length || new Set(order).size !== order.length)) throw new Error("순서를 정할 --ids가 필요합니다(중복 없이 쉼표로).");
    const todos = action === "list" ? await readTodos(home, alias) : await updateTodos(home, alias, rows => {
      if (action === "add") {
        if (rows.some(row => row.id === id)) throw new Error("같은 ID의 할일이 있습니다.");
        const todo = { id, title: options.title!.trim(), ...(options.detail !== undefined ? { detail: options.detail } : {}),
          ...(options.room !== undefined ? { roomId: options.room } : {}), done: false, at: new Date().toISOString() };
        const next = [...rows];
        const first = options.first ? rows.findIndex(row => !row.done && !row.inactive) : -1;
        next.splice(first < 0 ? next.length : first, 0, todo);
        return next;
      }
      if (action === "order") {
        // 우선순위 정렬 (사용자 요청 2026-10-26). 미완료 칸 안에서만 바꾸고, 완료 · 숨김 항목은 자리를 지킨다.
        const active = rows.filter(row => !row.done && !row.inactive && !row.deletedAt);
        const picked = order.map(value => active.find(row => row.id === value) ?? (() => { throw new Error(`순서를 바꿀 미완료 할일을 찾을 수 없습니다: ${value}`); })());
        const sorted = [...picked, ...active.filter(row => !order.includes(row.id))];
        let i = 0;
        return rows.map(row => active.includes(row) ? sorted[i++]! : row);
      }
      const todo = rows.find(row => row.id === id);
      if (!todo || todo.deletedAt) throw new Error("수정할 할일을 찾을 수 없습니다.");
      return rows.map(row => row.id !== id ? row : { ...row,
        ...(options.title !== undefined ? { title: options.title.trim() } : {}),
        ...(options.detail !== undefined ? { detail: options.detail } : {}),
        ...(options.room !== undefined ? { roomId: options.room } : {}),
        ...(options.done ? { done: true } : options.pending ? { done: false } : {}),
      });
    });
    printResult(json, { ok: true, todos, ...(action === "add" || action === "update" ? { id } : {}) }, [JSON.stringify(todos, null, 2)]);
    return 0;
  } catch (error) {
    printError(json, error instanceof Error ? error.message : String(error));
    return 1;
  }
}

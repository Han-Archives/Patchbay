import { randomUUID } from "node:crypto";
import { readStudio, readTodos, resolveStudioHome, updateTodos } from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface TodoCommandOptions {
  project?: string; id?: string; title?: string; detail?: string; room?: string;
  done?: boolean; pending?: boolean; first?: boolean; json?: boolean;
}

/** 부분 변경만 저장해 다른 항목·순서·자동 추천 출처를 보존한다. */
export async function runTodo(action: "list" | "add" | "update", options: TodoCommandOptions, home = resolveStudioHome()): Promise<number> {
  const json = Boolean(options.json);
  try {
    const alias = options.project;
    if (!alias || !(await readStudio(home)).projects.some(p => p.alias === alias)) throw new Error("등록된 --project가 필요합니다.");
    if (options.done && options.pending) throw new Error("--done과 --pending은 함께 지정할 수 없습니다.");
    const id = options.id ?? randomUUID();
    if (action === "update" && !options.id) throw new Error("수정할 --id가 필요합니다.");
    if (action === "add" && !options.title?.trim()) throw new Error("추가할 --title이 필요합니다.");
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
      const todo = rows.find(row => row.id === id);
      if (!todo || todo.deletedAt) throw new Error("수정할 할일을 찾을 수 없습니다.");
      return rows.map(row => row.id !== id ? row : { ...row,
        ...(options.title !== undefined ? { title: options.title.trim() } : {}),
        ...(options.detail !== undefined ? { detail: options.detail } : {}),
        ...(options.room !== undefined ? { roomId: options.room } : {}),
        ...(options.done ? { done: true } : options.pending ? { done: false } : {}),
      });
    });
    printResult(json, { ok: true, todos, ...(action !== "list" ? { id } : {}) }, [JSON.stringify(todos, null, 2)]);
    return 0;
  } catch (error) {
    printError(json, error instanceof Error ? error.message : String(error));
    return 1;
  }
}

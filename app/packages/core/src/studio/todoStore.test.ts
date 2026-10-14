import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readTodos, todosPath, writeTodos, updateTodos, readTodoHistory, todoHistoryDir, TODO_VISIBLE_MS } from "./todoStore.js";
import { appendRoomMessage } from "../rooms/store.js";

describe("프로젝트의 이후 할 일", () => {
  it("없으면 빈 목록, 적으면 끝냄까지 그대로 읽힌다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-todos-"));
    expect(await readTodos(home, "demo")).toEqual([]);
    const item = { id: "t1", title: "사이드바 아이콘 커밋", detail: "파일 4개", done: true, at: "2026-10-13T11:00:00.000Z", completedAt: "2026-10-14T11:00:00.000Z" };
    await writeTodos(home, "demo", [item]);
    expect(await readTodos(home, "demo")).toEqual([item]);
    expect(fs.existsSync(todosPath(home, "demo"))).toBe(true);
  });

  it("제목이 빈 할 일은 저장하지 않는다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-todos-"));
    await expect(writeTodos(home, "demo", [{ id: "t1", title: "", done: false, at: "x" }])).rejects.toThrow();
    expect(await readTodos(home, "demo")).toEqual([]);
  });

  it("완료 시각은 재조회에도 유지하며 3일이 지나도 원문과 갱신된 대화를 보관한다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-todos-history-"));
    const registered = "2026-10-10T11:00:00.000Z", finished = new Date("2026-10-14T11:00:00.000Z");
    await appendRoomMessage(home, "demo", "room-1", { role: "user", text: "요구사항 원문" }, finished);
    await writeTodos(home, "demo", [{ id: "../../외부", title: "작업 | 기록", detail: "요구사항", done: false, at: registered, roomId: "room-1" }]);
    await updateTodos(home, "demo", rows => rows.map(row => ({ ...row, done: true })), finished);
    await appendRoomMessage(home, "demo", "room-1", { role: "speaker", speaker: "codex", model: "", text: "수행 결과", ms: 1 }, new Date(finished.getTime() + 1000));
    const later = new Date(finished.getTime() + TODO_VISIBLE_MS + 1);
    const rows = await updateTodos(home, "demo", rows => rows, later);
    expect(rows[0]?.completedAt).toBe(finished.toISOString());
    expect(later.getTime() - Date.parse(rows[0]!.completedAt!)).toBeGreaterThan(TODO_VISIBLE_MS);
    const index = await readTodoHistory(home, "demo");
    expect(index).toHaveLength(1);
    expect(index[0]?.id).toBe("../../외부");
    const folder = path.join(todoHistoryDir(home, "demo"), index[0]!.folder.split("/").at(-1)!);
    expect(JSON.parse(fs.readFileSync(path.join(folder, "task.json"), "utf8")).completedAt).toBe(finished.toISOString());
    const conversation = fs.readdirSync(path.join(folder, "conversations")).find(file => file.endsWith(".md"))!;
    expect(fs.readFileSync(path.join(folder, "conversations", conversation), "utf8")).toContain("수행 결과");
    expect(fs.readFileSync(path.join(todoHistoryDir(home, "demo"), "index.md"), "utf8")).toContain("작업 \\| 기록");
  });

  it("동시에 추가해도 유실되지 않고 이전 기록은 목록에서 빠져도 유지한다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-todos-concurrent-"));
    await Promise.all(["a", "b", "c"].map(id => updateTodos(home, "demo", rows => [...rows, { id, title: id, done: false, at: new Date().toISOString() }])));
    expect((await readTodos(home, "demo")).map(row => row.id)).toEqual(["a", "b", "c"]);
    await updateTodos(home, "demo", rows => rows.map(row => ({ ...row, done: true })));
    await writeTodos(home, "demo", []);
    expect(await readTodoHistory(home, "demo")).toHaveLength(3);
  });
});

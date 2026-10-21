import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readTodos, todosPath, writeTodos, updateTodos, readTodoHistory, todoHistoryDir, TODO_VISIBLE_MS } from "./todoStore.js";
import { appendRoomMessage } from "../rooms/store.js";

describe("프로젝트의 이후 할 일", () => {
  it("이전 LLM 출처만 일반 할일로 복원하고 항목·순서·완료 시각을 보존해 저장한다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-todos-legacy-"));
    const file = todosPath(home, "demo");
    const legacy = { id: "follow-up", title: "후속 작업", done: false, at: "2026-10-20T12:44:08.897Z", roomId: "room-1", source: "llm" };
    const completed = { id: "stage", title: "자동 추천", done: true, at: "earlier", source: "stage", completedAt: "2026-10-20T12:30:00.000Z" };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ todos: [completed, legacy] }));
    expect((await readTodos(home, "demo"))[1]).toEqual({ id: legacy.id, title: legacy.title, done: false, at: legacy.at, roomId: legacy.roomId });
    await updateTodos(home, "demo", rows => rows);
    const stored = JSON.parse(fs.readFileSync(file, "utf8")).todos;
    expect(stored).toHaveLength(2);
    expect(stored[0]).toEqual(completed);
    expect(stored[1]).not.toHaveProperty("source");
    expect(await readTodoHistory(home, "demo")).toHaveLength(1);
  });

  it("새 저장의 잘못된 출처를 거부하고 기존 목록을 덮어쓰지 않는다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-todos-invalid-"));
    const valid = { id: "kept", title: "보존", done: false, at: "x" };
    await writeTodos(home, "demo", [valid]);
    const before = fs.readFileSync(todosPath(home, "demo"), "utf8");
    await expect(writeTodos(home, "demo", [{ ...valid, source: "llm" } as never])).rejects.toThrow();
    expect(fs.readFileSync(todosPath(home, "demo"), "utf8")).toBe(before);
  });

  it.each([{ source: "unknown" }, { title: "" }])("다른 원문 오류는 조용히 버리거나 덮어쓰지 않는다: %j", async invalid => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-todos-broken-"));
    const file = todosPath(home, "demo");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const original = JSON.stringify({ todos: [{ id: "bad", title: "작업", done: false, at: "x", ...invalid }] });
    fs.writeFileSync(file, original);
    await expect(updateTodos(home, "demo", rows => rows)).rejects.toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });

  it("없으면 빈 목록, 적으면 끝냄까지 그대로 읽힌다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-todos-"));
    expect(await readTodos(home, "demo")).toEqual([]);
    const item = { id: "t1", title: "사이드바 아이콘 커밋", detail: "파일 4개", done: true, at: "2026-10-13T11:00:00.000Z", completedAt: "2026-10-14T11:00:00.000Z" };
    await writeTodos(home, "demo", [item]);
    expect(await readTodos(home, "demo")).toEqual([item]);
    expect(fs.existsSync(todosPath(home, "demo"))).toBe(true);
  });

  it("LLM이 시간대(+09:00)를 붙여 적은 완료 · 삭제 시각도 읽고 UTC로 맞춘다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-todos-"));
    fs.mkdirSync(path.dirname(todosPath(home, "demo")), { recursive: true });
    fs.writeFileSync(todosPath(home, "demo"), JSON.stringify({ todos: [
      { id: "t1", title: "끝낸 일", done: true, at: "2026-10-16T20:10:00+09:00", completedAt: "2026-10-16T20:23:13+09:00" },
      { id: "t2", title: "지운 추천", done: false, at: "2026-10-16T20:10:00+09:00", source: "stage", inactive: true, deletedAt: "2026-10-16T20:24:00+09:00" },
    ] }));
    const todos = await readTodos(home, "demo");
    expect(todos.map(t => t.completedAt ?? t.deletedAt)).toEqual(["2026-10-16T11:23:13.000Z", "2026-10-16T11:24:00.000Z"]);
    expect((await updateTodos(home, "demo", rows => rows)).map(t => t.id)).toEqual(["t1", "t2"]);
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

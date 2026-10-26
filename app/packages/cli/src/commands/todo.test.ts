import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readTodos, registerProject, writeTodos } from "@patchbay/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTodo } from "./todo.js";

afterEach(() => vi.restoreAllMocks());
async function setup() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-todo-cli-"));
  await registerProject(home, { alias: "demo", kind: "local_repo", path: home });
  await writeTodos(home, "demo", [{ id: "suggestion", title: "자동 추천", done: false, at: "original", source: "stage", roomId: "existing-room" }]);
  return home;
}
describe("검증된 할일 CLI", () => {
  it("일반 할일 추가와 완료가 다른 항목·출처·순서를 보존한다", async () => {
    const home = await setup();
    const original = (await readTodos(home, "demo"))[0];
    expect(await runTodo("add", { project: "demo", id: "new", title: "후속 작업", room: "room-1", first: true, json: true }, home)).toBe(0);
    const added = await readTodos(home, "demo");
    expect(added.map(row => row.id)).toEqual(["new", "suggestion"]);
    expect(added[0]).not.toHaveProperty("source");
    expect(added[1]).toEqual(original);
    expect(await runTodo("update", { project: "demo", id: "new", done: true }, home)).toBe(0);
    const completed = (await readTodos(home, "demo"))[0]!;
    expect(completed).toMatchObject({ done: true, roomId: "room-1", at: added[0]!.at });
    expect(completed.completedAt).toBeTruthy();
    expect(await runTodo("update", { project: "demo", id: "new", detail: "검증 결과" }, home)).toBe(0);
    expect((await readTodos(home, "demo"))[0]!.completedAt).toBe(completed.completedAt);
    expect(await runTodo("list", { project: "demo", json: true }, home)).toBe(0);
  });
  it("order는 고른 미완료 할일을 그 순서로 앞에 두고 완료 항목 자리는 지킨다", async () => {
    const home = await setup();
    await writeTodos(home, "demo", ["a", "b", "c", "d"].map(id => ({ id, title: id, done: id === "b", at: "t" })));
    expect(await runTodo("order", { project: "demo", ids: "d, c", json: true }, home)).toBe(0);
    expect((await readTodos(home, "demo")).map(row => row.id)).toEqual(["d", "b", "c", "a"]);
    const before = await readTodos(home, "demo");
    for (const ids of ["b", "x", "a,a", ""]) expect(await runTodo("order", { project: "demo", ids }, home)).toBe(1);
    expect(await readTodos(home, "demo")).toEqual(before);
  });
  it("유효하지 않은 변경이나 다른 프로젝트는 원문을 변경하지 않는다", async () => {
    const home = await setup();
    const before = await readTodos(home, "demo");
    for (const options of [{ title: "x".repeat(201) }, { title: "x", room: "../outside" }, { title: "x", id: "suggestion" }, { title: " " }]) {
      expect(await runTodo("add", { project: "demo", ...options }, home)).toBe(1);
    }
    expect(await runTodo("update", { project: "demo", id: "missing", done: true }, home)).toBe(1);
    expect(await runTodo("update", { project: "demo", id: "suggestion", done: true, pending: true }, home)).toBe(1);
    expect(await runTodo("add", { project: "missing", title: "x" }, home)).toBe(1);
    expect(await readTodos(home, "demo")).toEqual(before);
  });
});

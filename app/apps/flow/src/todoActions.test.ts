import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readRoom, readRoomMeta, readTodos, readTodoHistory, todosPath, registerProject, writeTodos } from "@patchbay/core";
import { applyTodoAction } from "./todoActions.js";
import { createFlowApp } from "./server.js";
import { saveRoomCast, sendRoomTurn } from "./roomHost.js";

async function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-todo-actions-"));
  await registerProject(home, { alias: "demo", kind: "local_repo", path: fs.mkdtempSync(path.join(os.tmpdir(), "pb-todo-repo-")) });
  return home;
}
const now = new Date("2026-10-14T09:30:00.000Z");

describe("할일 변경", () => {
  it("연결된 할일은 위에서 아래 순서로 실행하고 재정렬하면 실행할 수 있다", async () => {
    const home = await setup();
    const room = await saveRoomCast(home, { alias: "demo", members: [{ speaker: "codex", model: "", role: "작업한다" }] });
    if (!room.ok) throw new Error(room.error);
    await writeTodos(home, "demo", [{ id: "first", title: "먼저 할일", done: false, at: now.toISOString() }, { id: "second", title: "뒤의 할일", done: false, at: now.toISOString(), roomId: room.roomId }]);
    let calls = 0;
    const deps = { bin: "mock", snapshot: async () => null, runner: async () => { calls++; return { ok: true as const, text: "작업 결과", ms: 1 }; } };
    const blocked = await sendRoomTurn(home, { alias: "demo", roomId: room.roomId, text: "실행", round: "talk" }, deps);
    expect(blocked).toMatchObject({ ok: false, status: 409 });
    expect(calls).toBe(0);
    await applyTodoAction(home, "demo", { action: "move", id: "second", beforeId: "first" }, () => false);
    const sent = await sendRoomTurn(home, { alias: "demo", roomId: room.roomId, text: "실행", round: "talk" }, deps);
    if (!sent.ok) throw new Error(sent.error);
    await sent.done;
    expect(calls).toBe(1);
  });
  it("화면이 닫혀 있어도 Agent 완료 파일과 마지막 응답을 즉시 보관한다", async () => {
    const home = await setup();
    const room = await saveRoomCast(home, { alias: "demo", members: [{ speaker: "codex", model: "", role: "작업한다" }] });
    if (!room.ok) throw new Error(room.error);
    await writeTodos(home, "demo", [{ id: "background", title: "백그라운드 작업", done: false, at: now.toISOString(), roomId: room.roomId }]);
    const sent = await sendRoomTurn(home, { alias: "demo", roomId: room.roomId, text: "작업", round: "talk" }, { bin: "mock", now: () => now, snapshot: async () => null, runner: async () => {
      const file = todosPath(home, "demo");
      const raw = JSON.parse(fs.readFileSync(file, "utf8")); raw.todos[0].done = true;
      fs.writeFileSync(file, JSON.stringify(raw));
      return { ok: true, text: "작업 완료 결과", ms: 1 };
    } });
    if (!sent.ok) throw new Error(sent.error);
    await sent.done;
    expect((await readTodoHistory(home, "demo"))[0]).toMatchObject({ id: "background", completedAt: now.toISOString(), roomId: room.roomId });
  });
  it("대화는 해당 요구사항만 담고 중복 생성하지 않으며 호출하지 않는다", async () => {
    const home = await setup();
    const added = await applyTodoAction(home, "demo", { action: "add", title: "실제 사용자 제목", detail: "실제 요구사항" }, () => false, now);
    const id = added.todos[0]!.id;
    const room = await applyTodoAction(home, "demo", { action: "room", id }, () => false, now);
    expect((await readRoom(home, "demo", room.roomId!))?.messages.map(row => row.text)).toEqual(["실제 사용자 제목\n\n실제 요구사항"]);
    expect((await readRoomMeta(home, "demo", room.roomId!)).title).toBe("실제 사용자 제목");
    expect((await applyTodoAction(home, "demo", { action: "room", id }, () => false)).roomId).toBe(room.roomId);
    await applyTodoAction(home, "demo", { action: "complete", id }, () => false, now);
    const app = createFlowApp({ studioHome: home });
    const history = await (await app.request("/api/todos/history?alias=demo")).json() as { entries: { id: string }[] };
    expect(history.entries[0]?.id).toBe(id);
    const detail = await (await app.request(`/api/todos/history?alias=demo&id=${id}`)).json() as { conversation: string };
    expect(detail.conversation).toContain("실제 요구사항");
    expect((await app.request("/api/todos/history?alias=unknown")).status).toBe(404);
    await app.close();
  });

  it("동시 추가를 보존하며 실행 중인 항목을 고정하고 대기 순서를 저장한다", async () => {
    const home = await setup();
    const seeds = ["a", "b", "c", "d"].map(id => ({ id, title: id, at: now.toISOString(), done: false, ...(id === "b" ? { roomId: "busy" } : {}) }));
    await writeTodos(home, "demo", seeds);
    const running = (id: string) => id === "busy";
    await applyTodoAction(home, "demo", { action: "move", id: "d", beforeId: "a" }, running);
    expect((await readTodos(home, "demo")).map(row => row.id)).toEqual(["d", "b", "a", "c"]);
    await expect(applyTodoAction(home, "demo", { action: "move", id: "b", beforeId: "c" }, running)).rejects.toThrow("이동");
    await expect(applyTodoAction(home, "demo", { action: "complete", id: "b" }, running)).rejects.toThrow("실행 중");
    await Promise.all(["e", "f"].map(title => applyTodoAction(home, "demo", { action: "add", title }, running)));
    expect((await readTodos(home, "demo")).slice(-2).map(row => row.title)).toEqual(["e", "f"]);
  });

  it("자동 항목을 중복 없이 통합하고 사라진 항목은 비활성화하며 완료 기록은 유지한다", async () => {
    const home = await setup();
    const suggestion = { id: "stage-1", title: "현재 단계", source: "stage", done: false, at: "" };
    await applyTodoAction(home, "demo", { action: "sync", suggestions: [suggestion] }, () => false, now);
    await applyTodoAction(home, "demo", { action: "sync", suggestions: [suggestion] }, () => false, now);
    expect(await readTodos(home, "demo")).toHaveLength(1);
    await applyTodoAction(home, "demo", { action: "sync", suggestions: [] }, () => false);
    expect((await readTodos(home, "demo"))[0]?.inactive).toBe(true);
    await applyTodoAction(home, "demo", { action: "sync", suggestions: [suggestion] }, () => false);
    await applyTodoAction(home, "demo", { action: "complete", id: suggestion.id }, () => false, now);
    await applyTodoAction(home, "demo", { action: "sync", suggestions: [suggestion] }, () => false);
    expect((await readTodos(home, "demo"))[0]).toMatchObject({ done: true, completedAt: now.toISOString(), at: now.toISOString() });
  });
});

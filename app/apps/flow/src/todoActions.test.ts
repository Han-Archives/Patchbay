import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readAgents, readRoom, readRoomMeta, readTodos, readTodoHistory, readTrash, todosPath, registerProject, writeAgents, writeProjectRule, writeTodos } from "@patchbay/core";
import { applyTodoAction } from "./todoActions.js";
import { createFlowApp } from "./server.js";
import { completeRoomTodo, roomReadView, saveRoomCast, sendRoomTurn } from "./roomHost.js";

async function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-todo-actions-"));
  await registerProject(home, { alias: "demo", kind: "local_repo", path: fs.mkdtempSync(path.join(os.tmpdir(), "pb-todo-repo-")) });
  return home;
}
const now = new Date("2026-10-14T09:30:00.000Z");

describe("할일 변경", () => {
  it("삭제는 완료 기록을 만들지 않고 연결된 대화와 다른 할일을 보존한다", async () => {
    const home = await setup();
    const added = await applyTodoAction(home, "demo", { action: "add", title: "삭제할 작업" }, () => false, now);
    const id = added.todos[0]!.id;
    const room = await applyTodoAction(home, "demo", { action: "room", id }, () => false, now);
    await applyTodoAction(home, "demo", { action: "add", title: "유지할 작업" }, () => false, now);
    const app = createFlowApp({ studioHome: home });
    try {
      const response = await app.request("/api/todos/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: "demo", action: "delete", id }) });
      expect(response.status).toBe(200);
      expect((await readTodos(home, "demo")).map(row => row.title)).toEqual(["유지할 작업"]);
      expect((await readTrash(home, "demo", now))[0]).toMatchObject({ kind: "todo", recordId: id });
      expect(await readTodoHistory(home, "demo")).toEqual([]);
      expect((await readRoom(home, "demo", room.roomId!))?.messages[0]?.text).toBe("삭제할 작업");
      const changes = fs.readFileSync(path.join(home, "projects/demo/log/events/changes.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
      expect(changes.filter(row => row.id === id).map(row => row.change)).toEqual(["add", "delete"]);
      await expect(applyTodoAction(home, "demo", { action: "delete", id }, () => false)).rejects.toMatchObject({ status: 404 });
    } finally { await app.close(); }
  });

  it("삭제한 자동 추천은 다시 동기화해도 활성화하거나 완료로 보관하지 않는다", async () => {
    const home = await setup();
    const suggestion = { id: "stage-delete", title: "삭제할 추천", source: "stage", done: false, at: "" };
    await applyTodoAction(home, "demo", { action: "sync", suggestions: [suggestion] }, () => false, now);
    await applyTodoAction(home, "demo", { action: "delete", id: suggestion.id }, () => false, now);
    await applyTodoAction(home, "demo", { action: "sync", suggestions: [] }, () => false, now);
    const result = await applyTodoAction(home, "demo", { action: "sync", suggestions: [suggestion] }, () => false, now);
    expect(result.todos).toHaveLength(1);
    expect(result.todos[0]).toMatchObject({ done: false, inactive: true, deletedAt: now.toISOString() });
    expect(result.todos[0]?.completedAt).toBeUndefined();
    expect(await readTodoHistory(home, "demo")).toEqual([]);
    await expect(applyTodoAction(home, "demo", { action: "room", id: suggestion.id }, () => false)).rejects.toMatchObject({ status: 404 });
  });

  it("채팅으로 맡긴 일이 최우선이다 — 대화의 할일을 Tasks 맨 위로 올리고 바로 실행한다", async () => {
    const home = await setup();
    const room = await saveRoomCast(home, { alias: "demo", members: [{ speaker: "codex", model: "", role: "작업한다" }] });
    if (!room.ok) throw new Error(room.error);
    await writeTodos(home, "demo", [{ id: "done", title: "끝난 할일", done: true, at: now.toISOString() }, { id: "first", title: "먼저 할일", done: false, at: now.toISOString() }, { id: "second", title: "뒤의 할일", done: false, at: now.toISOString(), roomId: room.roomId }]);
    const calls: { execution?: string; prompt: string }[] = [];
    const deps = { bin: "mock", snapshot: async () => null, runner: async (req: { execution?: string; prompt: string }) => { calls.push(req); return { ok: true as const, text: "작업 결과", ms: 1 }; } };
    const sent = await sendRoomTurn(home, { alias: "demo", roomId: room.roomId, text: "실행", round: "talk" }, deps);
    if (!sent.ok) throw new Error(sent.error);
    await sent.done;
    expect(calls[0]?.execution).toBe("apply");
    expect(calls[0]?.prompt).not.toContain("연결된 할일이 없다");
    expect((await readTodos(home, "demo")).map(row => row.id)).toEqual(["done", "second", "first"]);
  });

  it("할일이 없는 대화에서 맡긴 일은 LLM이 Tasks 맨 위에 이 대화로 등록하게 한다", async () => {
    const home = await setup();
    const room = await saveRoomCast(home, { alias: "demo", members: [{ speaker: "codex", model: "", role: "작업한다" }] });
    if (!room.ok) throw new Error(room.error);
    await writeTodos(home, "demo", [{ id: "first", title: "먼저 할일", done: false, at: now.toISOString() }]);
    const calls: { prompt: string }[] = [];
    const sent = await sendRoomTurn(home, { alias: "demo", roomId: room.roomId, text: "이거 고쳐줘", round: "talk" }, { bin: "mock", snapshot: async () => null, runner: async (req: { prompt: string }) => { calls.push(req); return { ok: true as const, text: "작업 결과", ms: 1 }; } });
    if (!sent.ok) throw new Error(sent.error);
    await sent.done;
    expect(calls[0]?.prompt).toContain("add 명령에 --first를 붙여 첫 미완료 할일 앞에 추가");
    expect(calls[0]?.prompt).toContain(`--room '${room.roomId}'`);
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
  it("대화에서 할일을 끝내면 완료 안내와 다음 할일의 대화방을 남긴다", async () => {
    const home = await setup();
    const room = await saveRoomCast(home, { alias: "demo", members: [{ speaker: "codex", model: "", role: "작업한다" }] });
    if (!room.ok) throw new Error(room.error);
    await writeTodos(home, "demo", [{ id: "a", title: "지금 할일", done: false, at: now.toISOString(), roomId: room.roomId }, { id: "b", title: "다음 할일", done: false, at: now.toISOString() }]);
    const sent = await sendRoomTurn(home, { alias: "demo", roomId: room.roomId, text: "작업", round: "talk" }, { bin: "mock", now: () => now, snapshot: async () => null, runner: async () => {
      const file = todosPath(home, "demo");
      const raw = JSON.parse(fs.readFileSync(file, "utf8")); raw.todos[0].done = true;
      fs.writeFileSync(file, JSON.stringify(raw));
      return { ok: true, text: "끝냈습니다", ms: 1 };
    } });
    if (!sent.ok) throw new Error(sent.error);
    await sent.done;
    const next = (await readTodos(home, "demo")).find(row => row.id === "b")!;
    expect(next.roomId).toBeTruthy();
    expect((await readRoom(home, "demo", room.roomId))?.messages.at(-1)).toMatchObject({ role: "system", kind: "done", next: { roomId: next.roomId, title: "다음 할일" } });
    expect((await readRoomMeta(home, "demo", next.roomId!)).members).toMatchObject([{ speaker: "codex" }]);
  });

  it("대화창 「완료」는 완료 안내와 다음 할일 링크를 남긴 뒤 할일을 완료로 옮긴다", async () => {
    const home = await setup();
    await writeTodos(home, "demo", [{ id: "a", title: "이야기한 주제", done: false, at: now.toISOString() }, { id: "b", title: "다음 주제", done: false, at: now.toISOString() }]);
    const own = await applyTodoAction(home, "demo", { action: "room", id: "a" }, () => false, now);
    expect((await roomReadView(home, "demo", own.roomId!))?.todo).toEqual({ id: "a", title: "이야기한 주제" });
    expect(await completeRoomTodo(home, { alias: "demo", roomId: own.roomId! }, now)).toEqual({ ok: true });
    const todos = await readTodos(home, "demo");
    expect(todos.find(row => row.id === "a")).toMatchObject({ done: true });
    expect((await readRoom(home, "demo", own.roomId!))?.messages.at(-1)).toMatchObject({ role: "system", kind: "done", next: { roomId: todos.find(row => row.id === "b")!.roomId, title: "다음 주제" } });
    expect((await roomReadView(home, "demo", own.roomId!))?.todo).toBeNull();
    expect(await completeRoomTodo(home, { alias: "demo", roomId: own.roomId! }, now)).toMatchObject({ ok: false, status: 404 });
  });

  it("대화방은 어떤 LLM이든 프로젝트 규칙을 프롬프트로 받고, 이름을 댄 요청 규칙은 본문까지 받는다", async () => {
    const home = await setup();
    await writeProjectRule(home, "demo", { name: "tone", description: "짧게", apply: "always", body: "늘 세 문장 이내로 답한다." });
    await writeProjectRule(home, "demo", { name: "deck", description: "덱 만들 때", apply: "request", body: "덱은 끝난 뒤에 만든다." });
    const room = await saveRoomCast(home, { alias: "demo", members: [{ speaker: "local", model: "qwen", role: "답한다" }] });
    if (!room.ok) throw new Error(room.error);
    const calls: { prompt: string }[] = [];
    const deps = { bin: "mock", snapshot: async () => null, runner: async (req: { prompt: string }) => { calls.push(req); return { ok: true as const, text: "답", ms: 1 }; } };
    const first = await sendRoomTurn(home, { alias: "demo", roomId: room.roomId, text: "안녕", round: "talk" }, deps);
    if (!first.ok) throw new Error(first.error);
    await first.done;
    expect(calls[0]?.prompt).toContain("늘 세 문장 이내로 답한다.");
    expect(calls[0]?.prompt).toContain("규칙 deck: 덱 만들 때");
    expect(calls[0]?.prompt).not.toContain("덱은 끝난 뒤에 만든다.");
    const second = await sendRoomTurn(home, { alias: "demo", roomId: room.roomId, text: "deck 규칙대로 해줘", round: "talk" }, deps);
    if (!second.ok) throw new Error(second.error);
    await second.done;
    expect(calls[1]?.prompt).toContain("덱은 끝난 뒤에 만든다.");
  });

  it("새 대화는 등록된 LLM 없이 시작하고 선택한 참여자는 다시 열어도 유지한다", async () => {
    const home = await setup();
    const agents = [
      { id: "codex", speaker: "codex" as const, model: "", role: "구현" },
      { id: "claude", speaker: "claude-code" as const, model: "", role: "검토" },
    ];
    await writeAgents(home, "demo", agents);
    const added = await applyTodoAction(home, "demo", { action: "add", title: "LLM 직접 선택" }, () => false, now);
    const id = added.todos[0]!.id;
    const room = await applyTodoAction(home, "demo", { action: "room", id }, () => false, now);
    expect((await readRoomMeta(home, "demo", room.roomId!)).members).toEqual([]);
    expect(await readAgents(home, "demo")).toEqual(agents);

    const cast = await saveRoomCast(home, { alias: "demo", roomId: room.roomId!, members: [agents[0]!] });
    expect(cast.ok).toBe(true);
    expect((await applyTodoAction(home, "demo", { action: "room", id }, () => false)).roomId).toBe(room.roomId);
    expect((await readRoomMeta(home, "demo", room.roomId!)).members).toMatchObject([{ ...agents[0], enabled: true }]);
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

  it("다른 대화에서 나온 할일은 자기 대화를 새로 만들고 나온 방의 참여자를 잇는다", async () => {
    const home = await setup();
    const origin = await saveRoomCast(home, { alias: "demo", members: [{ speaker: "claude-code", model: "", role: "브리핑" }] });
    if (!origin.ok) throw new Error(origin.error);
    await writeTodos(home, "demo", ["a", "b"].map(id => ({ id, title: `할일 ${id}`, done: false, at: now.toISOString(), roomId: origin.roomId })));
    const a = await applyTodoAction(home, "demo", { action: "room", id: "a" }, () => false, now);
    const b = await applyTodoAction(home, "demo", { action: "room", id: "b" }, () => false, now);
    expect(new Set([origin.roomId, a.roomId, b.roomId]).size).toBe(3);
    expect(await readRoomMeta(home, "demo", a.roomId!)).toMatchObject({ title: "할일 a", todoId: "a", members: [{ speaker: "claude-code", role: "브리핑" }] });
    expect((await readRoom(home, "demo", a.roomId!))?.messages.map(row => row.text)).toEqual(["할일 a"]);
    expect((await readTodos(home, "demo")).map(row => row.roomId)).toEqual([a.roomId, b.roomId]);
    expect((await applyTodoAction(home, "demo", { action: "room", id: "a" }, () => false)).roomId).toBe(a.roomId);
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
    await expect(applyTodoAction(home, "demo", { action: "delete", id: "b" }, running)).rejects.toThrow("실행 중");
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

describe("후속 작업 백로그와 완료 기록", () => {
  it("자동 추천을 모으고, 순서를 바꾸고, 할일마다 전용 대화를 열고, 완료는 기록으로 · 삭제는 휴지통으로 남긴다", async () => {
    const home = await setup();
    const auto = (id: string, title: string) => ({ id, title, source: "attention" as const, done: false, at: "" });
    // 요구사항 · 실행에서 생긴 후속 작업이 동기화로 모인다 — 같은 제목은 한 번만.
    await applyTodoAction(home, "demo", { action: "sync", suggestions: [auto("a1", "설계 칸 채우기"), auto("a2", "테스트 보완")] }, () => false, now);
    const manual = await applyTodoAction(home, "demo", { action: "add", title: "설계 칸 채우기" }, () => false, now);
    expect(manual.todos.filter(row => row.title === "설계 칸 채우기")).toHaveLength(2);
    const synced = await applyTodoAction(home, "demo", { action: "sync", suggestions: [auto("a1", "설계 칸 채우기"), auto("a2", "테스트 보완"), auto("a3", "테스트 보완")] }, () => false, now);
    expect(synced.todos.filter(row => row.title === "테스트 보완")).toHaveLength(1);
    // 우선순위 재정렬
    const moved = await applyTodoAction(home, "demo", { action: "move", id: "a2", beforeId: "a1" }, () => false, now);
    expect(moved.todos.filter(row => !row.done).map(row => row.id).slice(0, 2)).toEqual(["a2", "a1"]);
    // 태스크별 전용 대화 — 다시 열어도 같은 대화
    const room = await applyTodoAction(home, "demo", { action: "room", id: "a2" }, () => false, now);
    expect((await applyTodoAction(home, "demo", { action: "room", id: "a2" }, () => false, now)).roomId).toBe(room.roomId);
    expect((await readRoomMeta(home, "demo", room.roomId!))?.title).toBe("테스트 보완");
    // 실행 중인 할일은 삭제 · 완료 불가
    await expect(applyTodoAction(home, "demo", { action: "delete", id: "a2" }, id => id === room.roomId, now)).rejects.toMatchObject({ status: 409 });
    // 완료 → 제목 · 등록일 · 완료 일시 · 연결 대화가 기록으로
    await applyTodoAction(home, "demo", { action: "complete", id: "a2" }, () => false, now);
    expect((await readTodoHistory(home, "demo"))[0]).toMatchObject({ id: "a2", title: "테스트 보완", at: now.toISOString(), roomId: room.roomId });
    expect((await readTodoHistory(home, "demo"))[0]!.completedAt).toBeTruthy();
    await expect(applyTodoAction(home, "demo", { action: "delete", id: "a2" }, () => false, now)).rejects.toMatchObject({ status: 409 });
    // 삭제한 자동 추천은 휴지통으로 가고 다시 동기화해도 나타나지 않는다
    await applyTodoAction(home, "demo", { action: "delete", id: "a1" }, () => false, now);
    expect((await readTrash(home, "demo", now)).map(row => row.recordId)).toContain("a1");
    const again = await applyTodoAction(home, "demo", { action: "sync", suggestions: [auto("a1", "설계 칸 채우기")] }, () => false, now);
    expect(again.todos.find(row => row.id === "a1")).toMatchObject({ inactive: true });
  });
});

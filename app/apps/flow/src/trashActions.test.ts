import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendRoomMessage, deleteRoom, readRoom, readRoomMeta, readTodos, registerProject, writeRoomMeta, writeTodos } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { createFlowApp } from "./server.js";
import { applyTodoAction } from "./todoActions.js";

async function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-trash-api-"));
  for (const alias of ["demo", "other"]) await registerProject(home, { alias, kind: "local_repo", path: fs.mkdtempSync(path.join(os.tmpdir(), `pb-trash-${alias}-`)) });
  const app = createFlowApp({ studioHome: home });
  const post = (url: string, body: unknown) => app.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { home, app, post };
}
type Row = { id: string; kind: string; recordId: string; title: string };

describe("프로젝트별 휴지통 확인", () => {
  it("프로젝트마다 지운 할일 · 대화를 제목 · 지운 때 · 비워지는 때와 함께 보이고, 다른 프로젝트에는 보이지 않는다", async () => {
    const { home, app } = await setup();
    try {
      const added = await applyTodoAction(home, "demo", { action: "add", title: "지울 할일" }, () => false);
      await applyTodoAction(home, "demo", { action: "delete", id: added.todos[0]!.id }, () => false);
      await writeRoomMeta(home, "demo", "2026-10-21-aaaa0001", { title: "지울 대화", kept: false, members: [] });
      await appendRoomMessage(home, "demo", "2026-10-21-aaaa0001", { role: "user", text: "안녕" });
      await deleteRoom(home, "demo", "2026-10-21-aaaa0001");
      const body = (await (await app.request("/api/trash?alias=demo")).json()) as { entries: (Row & { deletedAt: string; expiresAt: string })[] };
      expect(body.entries.map(row => [row.kind, row.title]).sort()).toEqual([["room", "지울 대화"], ["todo", "지울 할일"]]);
      expect(body.entries.every(row => Date.parse(row.expiresAt) - Date.parse(row.deletedAt) === 4 * 24 * 60 * 60 * 1000)).toBe(true);
      expect(JSON.stringify(body)).not.toContain("안녕");
      expect(((await (await app.request("/api/trash?alias=other")).json()) as { entries: Row[] }).entries).toEqual([]);
      expect((await app.request("/api/trash?alias=nope")).status).toBe(404);
    } finally { await app.close(); }
  });
});

describe("휴지통 기록 되살리기", () => {
  it("되살리면 할일은 Tasks로 · 대화는 원문 그대로 돌아오고, 같은 ID가 살아 있으면 막고 휴지통에 남긴다", async () => {
    const { home, app, post } = await setup();
    try {
      const added = await applyTodoAction(home, "demo", { action: "add", title: "되살릴 할일", detail: "본문" }, () => false);
      const todoId = added.todos[0]!.id;
      await applyTodoAction(home, "demo", { action: "delete", id: todoId }, () => false);
      await applyTodoAction(home, "demo", { action: "sync", suggestions: [{ id: "auto-1", title: "자동 추천", source: "stage", done: false, at: "" }] }, () => false);
      await applyTodoAction(home, "demo", { action: "delete", id: "auto-1" }, () => false);
      await writeRoomMeta(home, "demo", "2026-10-21-aaaa0002", { title: "되살릴 대화", kept: true, members: [] });
      await appendRoomMessage(home, "demo", "2026-10-21-aaaa0002", { role: "user", text: "원문 그대로" });
      await deleteRoom(home, "demo", "2026-10-21-aaaa0002");
      const entries = ((await (await app.request("/api/trash?alias=demo")).json()) as { entries: Row[] }).entries;
      const of = (recordId: string) => entries.find(row => row.recordId === recordId)!.id;

      expect((await post("/api/trash/restore", { alias: "demo", id: of(todoId) })).status).toBe(200);
      expect((await readTodos(home, "demo")).find(row => row.id === todoId)).toMatchObject({ title: "되살릴 할일", detail: "본문", done: false });
      expect((await post("/api/trash/restore", { alias: "demo", id: of(todoId) })).status).toBe(404);

      expect((await post("/api/trash/restore", { alias: "demo", id: of("auto-1") })).status).toBe(200);
      const auto = (await readTodos(home, "demo")).find(row => row.id === "auto-1")!;
      expect(auto.deletedAt).toBeUndefined();
      expect(auto.inactive).toBe(false);

      expect((await post("/api/trash/restore", { alias: "demo", id: of("2026-10-21-aaaa0002") })).status).toBe(200);
      expect((await readRoom(home, "demo", "2026-10-21-aaaa0002"))!.messages[0]!.text).toBe("원문 그대로");
      expect((await readRoomMeta(home, "demo", "2026-10-21-aaaa0002")).title).toBe("되살릴 대화");

      // 지운 뒤 같은 ID가 다시 생겼으면 덮어쓰지 않는다.
      await applyTodoAction(home, "demo", { action: "delete", id: todoId }, () => false);
      const again = ((await (await app.request("/api/trash?alias=demo")).json()) as { entries: Row[] }).entries.find(row => row.recordId === todoId)!;
      await writeTodos(home, "demo", [...await readTodos(home, "demo"), { id: todoId, title: "새로 만든 같은 ID", done: false, at: new Date().toISOString() }]);
      expect((await post("/api/trash/restore", { alias: "demo", id: again.id })).status).toBe(409);
      expect(((await (await app.request("/api/trash?alias=demo")).json()) as { entries: Row[] }).entries.map(row => row.id)).toContain(again.id);
    } finally { await app.close(); }
  });
});

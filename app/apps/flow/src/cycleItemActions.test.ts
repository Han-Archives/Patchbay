import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCycleItems, readTodos, updateCycleItems, updateTodos } from "@patchbay/core";
import { applyCycleItemAction, listCycleItems } from "./cycleItemActions.js";

const idle = () => false;
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), "pb-cycle-act-"));
const add = { action: "add", step: "design", task: "사용자 흐름", name: "오류가 났을 때 흐름 그리기", desc: "실패 안내와 다시 시도 경로", tag: "UI" };

describe("흐름도 세부 항목 동작", () => {
  it("+ 로 넣은 항목은 직접 추가 · 대기 중이다", async () => {
    const dir = home();
    const { items } = await applyCycleItemAction(dir, "demo", add, idle);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: add.name, tag: "UI", source: "user", status: "wait", queued: false });
  });

  it("형식이 틀린 추가는 거절한다", async () => {
    const dir = home();
    await expect(applyCycleItemAction(dir, "demo", { ...add, name: "  " }, idle)).rejects.toThrow("형식");
    await expect(applyCycleItemAction(dir, "demo", { ...add, tag: "기타" }, idle)).rejects.toThrow("형식");
    await expect(applyCycleItemAction(dir, "demo", { ...add, step: "plan" }, idle)).rejects.toThrow("형식");
  });

  it("▶ 는 할일 맨 아래에 한 번만 올리고, 할일에서 빼면 다시 올릴 수 있다", async () => {
    const dir = home();
    await updateTodos(dir, "demo", () => [{ id: "old", title: "기존 할일", done: false, at: "2026-10-14T00:00:00.000Z" }]);
    const id = (await applyCycleItemAction(dir, "demo", add, idle)).items[0]!.id;
    await applyCycleItemAction(dir, "demo", { action: "play", id }, idle);
    await applyCycleItemAction(dir, "demo", { action: "play", id }, idle);
    const todos = await readTodos(dir, "demo");
    expect(todos.map(row => row.title)).toEqual(["기존 할일", add.name]);
    expect(todos[1]!.detail).toContain("Workflow · 설계 › 사용자 흐름");
    expect((await listCycleItems(dir, "demo", idle))[0]).toMatchObject({ status: "wait", queued: true, todoId: todos[1]!.id });

    await applyCycleItemAction(dir, "demo", { action: "unplay", id }, idle);
    expect((await readTodos(dir, "demo")).map(row => row.id)).toEqual(["old"]);
    expect((await readCycleItems(dir, "demo"))[0]!.todoId).toBeUndefined();
  });

  it("연결된 할일의 대화가 실행 중이면 진행 중, 할일이 끝나면 완료다", async () => {
    const dir = home();
    const id = (await applyCycleItemAction(dir, "demo", add, idle)).items[0]!.id;
    await applyCycleItemAction(dir, "demo", { action: "play", id }, idle);
    await updateTodos(dir, "demo", rows => rows.map(row => ({ ...row, roomId: "room-1" })));
    const running = (roomId: string) => roomId === "room-1";
    expect((await listCycleItems(dir, "demo", running))[0]).toMatchObject({ status: "run", queued: true });
    await expect(applyCycleItemAction(dir, "demo", { action: "del", id }, running)).rejects.toThrow("실행 중");
    await expect(applyCycleItemAction(dir, "demo", { action: "unplay", id }, running)).rejects.toThrow("실행 중");

    await updateTodos(dir, "demo", rows => rows.map(row => ({ ...row, done: true })));
    expect((await listCycleItems(dir, "demo", idle))[0]).toMatchObject({ status: "done", queued: false });
    await expect(applyCycleItemAction(dir, "demo", { action: "play", id }, idle)).rejects.toThrow("완료");
  });

  it("− 로 빼도 이미 올린 할일은 남는다", async () => {
    const dir = home();
    await updateCycleItems(dir, "demo", () => [{ id: "llm-1", step: "build", task: "화면 연결", name: "트리 표 그리기", desc: "", tag: "UI", source: "llm", at: "2026-10-15T00:00:00.000Z" }]);
    await applyCycleItemAction(dir, "demo", { action: "play", id: "llm-1" }, idle);
    const { items } = await applyCycleItemAction(dir, "demo", { action: "del", id: "llm-1" }, idle);
    expect(items).toEqual([]);
    expect((await readTodos(dir, "demo")).map(row => row.title)).toEqual(["트리 표 그리기"]);
    await expect(applyCycleItemAction(dir, "demo", { action: "del", id: "llm-1" }, idle)).rejects.toThrow("찾을 수 없습니다");
  });
});

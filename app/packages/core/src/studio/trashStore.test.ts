import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readTrash, trashRecord, TRASH_RETENTION_MS } from "./trashStore.js";

describe("프로젝트 휴지통", () => {
  it("삭제 기록을 프로젝트별로 4일 보관하고 기한이 지나면 없앤다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-trash-")); const now = new Date("2026-10-20T00:00:00Z");
    const entry = await trashRecord(home, "demo", { kind: "todo", recordId: "t1", payload: { title: "할일" } }, now);
    expect(Date.parse(entry.expiresAt) - now.getTime()).toBe(TRASH_RETENTION_MS);
    expect((await readTrash(home, "demo", new Date(now.getTime() + TRASH_RETENTION_MS - 1))).map(v => v.recordId)).toEqual(["t1"]);
    expect(await readTrash(home, "demo", new Date(now.getTime() + TRASH_RETENTION_MS))).toEqual([]);
    expect(await readTrash(home, "other", now)).toEqual([]);
  });
  it("대화방 원문도 휴지통 항목 안에 보존한다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-trash-"));
    await trashRecord(home, "demo", { kind: "room", recordId: "r1", payload: { transcript: "사람의 말", meta: "제목" } });
    expect((await readTrash(home, "demo"))[0]).toMatchObject({ kind: "room", recordId: "r1", payload: { transcript: "사람의 말", meta: "제목" } });
  });
});

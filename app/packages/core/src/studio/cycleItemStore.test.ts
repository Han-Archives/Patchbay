import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cycleItemsPath, readCycleItems, updateCycleItems, type CycleItem } from "./cycleItemStore.js";

const item = (id: string, name = "첫 실행 흐름 그리기"): CycleItem => ({ id, step: "design", task: "사용자 흐름", name, desc: "처음 연 사람이 거치는 화면 순서", tag: "UI", source: "llm", at: "2026-10-15T09:00:00.000Z" });

describe("흐름도 세부 항목", () => {
  it("없으면 빈 목록, 적으면 그대로 읽힌다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-cycle-"));
    expect(await readCycleItems(home, "demo")).toEqual([]);
    await updateCycleItems(home, "demo", () => [item("a")]);
    expect(await readCycleItems(home, "demo")).toEqual([item("a")]);
    expect(fs.existsSync(cycleItemsPath(home, "demo"))).toBe(true);
  });

  it("태그 목록 밖의 값과 중복 ID는 저장하지 않는다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-cycle-"));
    await expect(updateCycleItems(home, "demo", () => [{ ...item("a"), tag: "기타" as CycleItem["tag"] }])).rejects.toThrow();
    await expect(updateCycleItems(home, "demo", () => [item("a"), item("a", "다른 이름")])).rejects.toThrow("중복");
    expect(await readCycleItems(home, "demo")).toEqual([]);
  });

  it("동시에 추가해도 서로의 변경을 덮어쓰지 않는다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-cycle-"));
    await Promise.all(["a", "b", "c"].map(id => updateCycleItems(home, "demo", fresh => [...fresh, item(id)])));
    expect((await readCycleItems(home, "demo")).map(row => row.id).sort()).toEqual(["a", "b", "c"]);
  });
});

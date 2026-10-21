import { describe, expect, it } from "vitest";
import { lastWorkKey, readLastWork, readRoomLink, rememberWork, resolveResume, workLocation, type NavigationStorage } from "./workspaceNavigation.js";

function memory() {
  const values = new Map<string, string>();
  const storage: NavigationStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  return { values, storage };
}
describe("dashboard resume navigation", () => {
  it("keeps per-project work destinations across dashboard visits and never records an empty alias", () => {
    const { storage, values } = memory();
    rememberWork(workLocation("a", "docs")!, storage); rememberWork(workLocation("b", "files")!, storage);
    expect(workLocation("a", "dashboard")).toBeNull(); expect(workLocation("a", "home")).toBeNull(); expect(workLocation("", "docs")).toBeNull();
    expect(readLastWork("a", storage)?.place).toBe("docs"); expect(readLastWork("b", storage)?.place).toBe("files");
    expect(values.has(lastWorkKey(""))).toBe(false);
  });
  it("rejects broken, future, cross-project and unsupported saved locations", () => {
    const { storage, values } = memory();
    for (const raw of ["{bad", "[]", "null", '{"version":2,"alias":"a","place":"docs"}', '{"version":1,"alias":"b","place":"docs"}', '{"version":1,"alias":"a","place":"dashboard"}', '{"version":1,"alias":"a","place":"toString"}']) {
      values.set(lastWorkKey("a"), raw); expect(readLastWork("a", storage)).toBeNull();
    }
    const blocked: NavigationStorage = { getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("blocked"); } };
    expect(readLastWork("a", blocked)).toBeNull(); expect(() => rememberWork(workLocation("a", "docs")!, blocked)).not.toThrow();
  });
  it("restores only a valid Log date and excludes date context from unrelated screens", () => {
    const { storage, values } = memory();
    rememberWork(workLocation("a", "log", "2026-10-16")!, storage);
    expect(readLastWork("a", storage)?.logDate).toBe("2026-10-16");
    expect(workLocation("b", "docs", "2026-10-16")?.logDate).toBeUndefined();
    expect(workLocation("a", "log", "2026-02-30")?.logDate).toBeUndefined();
    values.set(lastWorkKey("a"), '{"version":1,"alias":"a","place":"log","logDate":"2026-02-30"}');
    expect(readLastWork("a", storage)).toBeNull();
  });
  it("derives label, destination and title from the same resolver and prioritizes work over chat", () => {
    const saved = workLocation("a", "docs")!;
    for (const hasRooms of [false, true]) expect(resolveResume("a", saved, hasRooms)).toMatchObject({ kind: "place", label: "이어하기", title: "최근 작업 화면 · RAG", location: saved });
    expect(resolveResume("b", saved, true)).toEqual({ kind: "chat", label: "이어하기", title: "현재 프로젝트의 대화 이어하기" });
    expect(resolveResume("a", null, false)).toEqual({ kind: "start", label: "시작하기", title: "현재 프로젝트의 대화 시작하기" });
  });
  it("decodes initial deep links without crashing on invalid percent encoding", () => {
    expect(readRoomLink("#room/demo/room-1")).toEqual({ alias: "demo", id: "room-1" });
    expect(readRoomLink("#room/" + encodeURIComponent("가상") + "/room-1")?.alias).toBe("가상");
    for (const hash of ["", "#other", "#room/a/", "#room/%E0%A4%A/room", "#room/a/%00"]) expect(readRoomLink(hash)).toBeNull();
  });
});

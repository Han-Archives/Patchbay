import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseStudioEvent, STUDIO_EVENT_NAMES } from "./eventsContract.js";

describe("STUDIO_EVENT_NAMES", () => {
  it("spec 3.2의 네 이름에 대화(thread) 하나를 더한다 — 대화 기록 결정 2026-10-05", () => {
    expect(STUDIO_EVENT_NAMES).toEqual(["progress", "inferred", "overlay", "board", "thread", "consult"]);
  });
});

describe("parseStudioEvent", () => {
  it("대화방 기록 · 제목 파일은 room 이벤트이고, 잠금 · 임시 파일은 아니다", () => {
    expect(parseStudioEvent("projects/demo/chats/2026-10-11-1a2b3c4d.jsonl")).toEqual({ event: "room", alias: "demo", roomId: "2026-10-11-1a2b3c4d" });
    expect(parseStudioEvent("projects/demo/chats/r1.meta.json")).toEqual({ event: "room", alias: "demo", roomId: "r1" });
    expect(parseStudioEvent("projects/demo/rooms/r1.jsonl")).toEqual({ event: "room", alias: "demo", roomId: "r1" });
    expect(parseStudioEvent("projects/demo/chats/r1.jsonl.lock")).toBeNull();
    expect(parseStudioEvent("projects/demo/chats/r1.meta.json.abc.tmp")).toBeNull();
  });

  it("maps each watched filename onto its event and alias", () => {
    expect(parseStudioEvent("projects/demo/progress.yaml")).toEqual({ event: "progress", alias: "demo" });
    expect(parseStudioEvent("projects/demo/inferred.json")).toEqual({ event: "inferred", alias: "demo" });
    expect(parseStudioEvent("projects/demo/overlay.yaml")).toEqual({ event: "overlay", alias: "demo" });
    expect(parseStudioEvent("projects/notes/board.yaml")).toEqual({ event: "board", alias: "notes" });
  });

  it("strips studioHome from an absolute path", () => {
    const home = path.join("/tmp", "patchbay-home");
    expect(parseStudioEvent(path.join(home, "projects", "demo", "progress.yaml"), home)).toEqual({
      event: "progress",
      alias: "demo",
    });
  });

  it("ignores nested extra segments, sibling markdown, and the studio rollup", () => {
    expect(parseStudioEvent("projects/demo/nested/progress.yaml")).toBeNull();
    expect(parseStudioEvent("projects/demo/PROGRESS.md")).toBeNull();
    expect(parseStudioEvent("progress.md")).toBeNull();
    expect(parseStudioEvent("projects/demo/ATLAS.md")).toBeNull();
  });

  it("accepts backslash separators", () => {
    expect(parseStudioEvent("projects\\demo\\overlay.yaml")).toEqual({ event: "overlay", alias: "demo" });
  });
});

describe("ir.proposed.yaml", () => {
  it("요구사항 검토 저장은 설계 갱신을 알린다", () => {
    expect(parseStudioEvent("projects/demo/ir.requirement-review.json")).toEqual({ event: "overlay", alias: "demo" });
  });
  it("overlay 로 보고한다 — 초안 하나 때문에 이벤트 이름을 만들지 않는다", () => {
    expect(parseStudioEvent("projects/demo/ir.proposed.yaml")).toEqual({ event: "overlay", alias: "demo" });
  });

  it("초안이 아닌 ir.yaml 은 이벤트가 아니다 — 보관본은 바뀌지 않는다", () => {
    expect(parseStudioEvent("projects/demo/versions/1/ir.yaml")).toBeNull();
  });
});

describe("대화 파일", () => {
  it("threads/<thread_id>.jsonl 은 thread 이벤트이고 어느 대화인지 싣는다", () => {
    expect(parseStudioEvent("projects/demo/threads/019a-2b.jsonl")).toEqual({
      event: "thread",
      alias: "demo",
      threadId: "019a-2b",
    });
  });

  it("threads 안의 다른 파일이나 더 깊은 곳은 이벤트가 아니다", () => {
    expect(parseStudioEvent("projects/demo/threads/notes.md")).toBeNull();
    expect(parseStudioEvent("projects/demo/threads/x/y.jsonl")).toBeNull();
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { roomMemory } from "./memory.js";
import { DEFAULT_ROOM_MODES, readModes, writeModes } from "./modes.js";
import { appendRoomMessage, displayRoomTitle, listRooms, migrateLegacyRoomDirs, readRoom, readRoomMeta, roomPath, roomPrompt, roomStatus, roomTitle, roundKind, roundPrompt, writeRoomMeta } from "./store.js";

describe("대화방 폴더 chats/ 이전", () => {
  it("새 방은 chats/ 에 쓴다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-chats-"));
    await appendRoomMessage(home, "demo", "r1", { role: "user", text: "안녕", to: "claude-code", model: "" });
    expect(fs.existsSync(path.join(home, "projects/demo/chats/r1.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(home, "projects/demo/rooms"))).toBe(false);
  });

  it("옮기기 전에는 rooms/ 를 그대로 읽고 쓰고, 옮긴 뒤에는 같은 기록을 chats/ 에서 읽는다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-chats-"));
    fs.mkdirSync(path.join(home, "projects/demo/rooms"), { recursive: true });
    await appendRoomMessage(home, "demo", "r1", { role: "user", text: "옛 방", to: "claude-code", model: "" });
    expect(roomPath(home, "demo", "r1")).toBe(path.join(home, "projects/demo/rooms/r1.jsonl"));
    expect(fs.existsSync(path.join(home, "projects/demo/chats"))).toBe(false);

    fs.mkdirSync(path.join(home, "projects/other/chats"), { recursive: true });
    expect(migrateLegacyRoomDirs(home)).toEqual(["demo"]);
    expect(fs.existsSync(path.join(home, "projects/demo/rooms"))).toBe(false);
    expect((await readRoom(home, "demo", "r1"))?.messages[0]?.text).toBe("옛 방");
    expect((await listRooms(home, "demo")).map((room) => room.id)).toEqual(["r1"]);
    expect(migrateLegacyRoomDirs(home)).toEqual([]);
  });

  it("chats/ 가 이미 있으면 rooms/ 를 덮지 않는다", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-chats-"));
    fs.mkdirSync(path.join(home, "projects/demo/rooms"), { recursive: true });
    fs.mkdirSync(path.join(home, "projects/demo/chats"), { recursive: true });
    expect(migrateLegacyRoomDirs(home)).toEqual([]);
    expect(fs.existsSync(path.join(home, "projects/demo/rooms"))).toBe(true);
  });
});

describe("대화방 기록", () => {
  it("담당의 아이콘(색 · 이미지 · HTML)은 다시 읽어도 남는다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-room-meta-"));
    const member = { id: "a1", speaker: "claude-code" as const, model: "claude-opus-5-5", role: "이끈다.", name: "수리", enabled: true, effort: "medium" as const, color: "#8e2e75", image: "data:image/png;base64,AAAA", iconHtml: "<b>수</b>" };
    await writeRoomMeta(home, "demo", "r1", { title: null, kept: false, members: [member] });
    expect((await readRoomMeta(home, "demo", "r1")).members[0]).toEqual(member);
  });

  it("덧붙이고 다시 읽고, 제목은 첫 말이다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-room-"));
    fs.mkdirSync(path.join(home, "projects", "demo"), { recursive: true });
    await appendRoomMessage(home, "demo", "r1", { role: "user", text: "이 설계의 구멍을 봐 줘", to: "claude-code", model: "" });
    await appendRoomMessage(home, "demo", "r1", {
      role: "speaker",
      speaker: "claude-code",
      model: "sonnet",
      text: "1.0이 비었다.",
      ms: 10,
    });
    const read = await readRoom(home, "demo", "r1");
    expect(read?.messages).toHaveLength(2);
    expect(roomStatus(read!.messages)).toBe("idle");
    const list = await listRooms(home, "demo");
    expect(list[0]?.title).toBe("이 설계의 구멍을 봐 줘");
    await writeRoomMeta(home, "demo", "r1", { title: "노드 읽기", kept: false, members: [] });
    const renamed = await listRooms(home, "demo");
    expect(renamed[0]?.title).toBe("노드 읽기");
    expect(displayRoomTitle("", [])).toBe("제목 없음");
    expect(roundKind(" 토의 시작 ")).toBe("discuss");
    expect(roundKind("토의 시작하자")).toBeNull();
    expect(roundKind("실행 시작")).toBeNull();
  });

  it("보내기는 검토로 끝나지 않는다 — Claude · Codex에게는 요청이면 직접 고치라고 넘긴다", () => {
    const messages = [{ seq: 0, at: "t", role: "user" as const, text: "할 일 칸을 고쳐 줘" }, { seq: 1, at: "t", role: "user" as const, text: "대화 시작" }];
    const codex = roundPrompt(messages, { speaker: "codex", model: "gpt-5.6-terra", role: "구현한다.", name: "팍스" }, "talk");
    expect(codex).toContain("할 일 칸을 고쳐 줘");
    expect(codex).toContain("직접 반영한다");
    expect(codex).toContain("푸시 · 파일 삭제 · 서버 재시작은 하지 않는다");
    const local = roundPrompt(messages, { speaker: "local", model: "qwen", role: "말한다." }, "discuss");
    expect(local).not.toContain("직접 반영한다");
  });

  it("다음 모델에게 앞 모델의 말을 그대로 넘긴다", async () => {
    const prompt = roomPrompt(
      [
        { seq: 0, at: "t", role: "user", text: "요약해 줘", to: "claude-code", model: "" },
        { seq: 1, at: "t", role: "speaker", speaker: "claude-code", model: "sonnet", text: "세 줄이다.", ms: 1 },
        { seq: 2, at: "t", role: "user", text: "그 요약에 반박해 줘", to: "grok", model: "grok-3" },
      ],
      "grok",
      "grok-3",
    );
    expect(prompt).toContain("너는 Grok");
    expect(prompt).toContain("[Claude · sonnet]\n세 줄이다.");
    expect(prompt).toContain("[사람 → Grok · grok-3]\n그 요약에 반박해 줘");
  });

  it("맥락은 요구와 나온 말만 짧게 모은다", () => {
    const text = roomMemory(
      [
        { seq: 0, at: "t", role: "user", text: "설계의 구멍을 봐 줘", to: "claude-code", model: "" },
        { seq: 1, at: "t", role: "speaker", speaker: "claude-code", model: "sonnet", text: "1.0이 비었다.", ms: 1 },
        { seq: 2, at: "t", role: "memory", text: "옛 맥락", sourceId: "older" },
      ],
      "설계의 구멍을 봐 줘",
    );
    expect(text).toContain("요구:");
    expect(text).toContain("- 설계의 구멍을 봐 줘");
    expect(text).toContain("- Claude: 1.0이 비었다.");
    expect(text).not.toContain("옛 맥락");
  });

  it("맥락만 있는 방의 제목은 옮겨 온 대화 이름이다", () => {
    const title = roomTitle([
      { seq: 0, at: "t", role: "memory", text: "맥락. 이전 대화 「구멍을 봐 줘」에서 옮긴 요약이다.", sourceId: "older" },
    ]);
    expect(title).toBe("맥락 · 구멍을 봐 줘");
  });

  it("모드 목록은 기본 6종으로 시작하고 저장 · 방 메타데이터 · 프롬프트 규약에 반영된다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-room-modes-"));
    const defaults = await readModes(home, "demo");
    expect(defaults.map((m) => m.id)).toEqual(["discuss", "report", "planning", "design", "study", "coding"]);
    const custom = [...DEFAULT_ROOM_MODES, { id: "arch", name: "아키텍처 점검", icon: "planning" as const, color: "#123456", execution: "read" as const, prompt: "경계 위반만 찾는다.", agentIds: ["a1", "a2"] }];
    await writeModes(home, "demo", custom);
    expect((await readModes(home, "demo")).at(-1)).toMatchObject({ id: "arch", name: "아키텍처 점검", agentIds: ["a1", "a2"] });

    await writeRoomMeta(home, "demo", "r1", { title: null, kept: false, modeId: "planning", members: [] });
    expect((await readRoomMeta(home, "demo", "r1")).modeId).toBe("planning");

    const messages = [{ seq: 0, at: "t", role: "user" as const, text: "단계별로 쪼개 줘" }];
    const member = { speaker: "claude-code" as const, model: "opus", role: "설계한다.", name: "수리" };
    const readPrompt = roundPrompt(messages, member, "talk", defaults.find((m) => m.id === "planning"));
    expect(readPrompt).toContain("모드: 플래닝");
    expect(readPrompt).toContain("읽기 전용 모드:");

    const editPrompt = roundPrompt(messages, member, "talk", defaults.find((m) => m.id === "report"));
    expect(editPrompt).toContain("모드: 보고서 작성");
    expect(editPrompt).toContain("문서 · 시안 작성:");
  });
});

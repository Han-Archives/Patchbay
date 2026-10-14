import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { mirrorSession } from "./mirror.js";
import { appendRoomMessage, readRoom, roomPath, writeRoomMeta } from "./store.js";

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-mirror-"));
  fs.mkdirSync(path.join(dir, "projects", "demo"), { recursive: true });
  return dir;
}

const human = (text: string, at = "2026-10-11T00:00:00.000Z") => ({ type: "user", origin: { kind: "human" }, timestamp: at, message: { role: "user", content: text } });
const said = (text: string) => ({ type: "assistant", message: { model: "claude-opus-5-5", content: [{ type: "text", text }] } });
const bindCall = (id: string) => ({ type: "assistant", message: { model: "m", content: [{ type: "tool_use", id, name: "mcp__patchbay__room_bind", input: { alias: "demo" } }] } });
const bindResult = (id: string, roomId: string) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text: JSON.stringify({ bound: true, alias: "demo", roomId }) }] }] } });
const tool = () => ({ type: "assistant", message: { model: "m", content: [{ type: "tool_use", id: "x", name: "Bash", input: {} }] } });
const toolResult = () => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] } });

function writeTranscript(file: string, rows: unknown[]) {
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

describe("세션 → 대화방 옮겨 적기", () => {
  it("묶기 전에는 아무것도 적지 않고, 묶이면 처음 요청부터 옮긴다", async () => {
    const dir = home();
    await writeRoomMeta(dir, "demo", "r1", { title: "폰", kept: false, members: [] });
    const transcript = path.join(dir, "t.jsonl");
    writeTranscript(transcript, [human("demo 프로젝트 진행해 줘")]);
    expect((await mirrorSession(dir, { sessionId: "s1", transcriptPath: transcript, event: "UserPromptSubmit", prompt: "demo 프로젝트 진행해 줘" })).bound).toBeNull();

    writeTranscript(transcript, [human("demo 프로젝트 진행해 줘"), said("확인할게요."), bindCall("b1"), bindResult("b1", "r1"), tool(), toolResult(), said("ready")]);
    const result = await mirrorSession(dir, { sessionId: "s1", transcriptPath: transcript, event: "Stop" });
    expect(result).toEqual({ bound: { alias: "demo", roomId: "r1" }, appended: 2 });
    const room = await readRoom(dir, "demo", "r1");
    expect(room?.messages.map((m) => [m.role, "text" in m ? m.text : ""])).toEqual([
      ["user", "demo 프로젝트 진행해 줘"],
      ["speaker", "확인할게요.\n\nready"],
    ]);
    expect(room?.messages.every((m) => (m as { via?: string }).via === "claude-session")).toBe(true);
  });

  it("다음 요청은 훅에서 바로 적고, 세션 기록에 나와도 두 번 적지 않는다", async () => {
    const dir = home();
    await writeRoomMeta(dir, "demo", "r1", { title: "폰", kept: false, members: [] });
    const transcript = path.join(dir, "t.jsonl");
    const rows: unknown[] = [human("시작"), bindCall("b1"), bindResult("b1", "r1"), said("ready")];
    writeTranscript(transcript, rows);
    await mirrorSession(dir, { sessionId: "s2", transcriptPath: transcript, event: "Stop" });

    await mirrorSession(dir, { sessionId: "s2", transcriptPath: transcript, event: "UserPromptSubmit", prompt: "테스트 돌려 줘" });
    expect((await readRoom(dir, "demo", "r1"))?.messages.at(-1)).toMatchObject({ role: "user", text: "테스트 돌려 줘" });

    writeTranscript(transcript, [...rows, human("테스트 돌려 줘"), tool(), toolResult(), said("3개 실패. 계속할까요?")]);
    await mirrorSession(dir, { sessionId: "s2", transcriptPath: transcript, event: "Stop" });
    const texts = (await readRoom(dir, "demo", "r1"))?.messages.map((m) => ("text" in m ? m.text : ""));
    expect(texts).toEqual(["시작", "ready", "테스트 돌려 줘", "3개 실패. 계속할까요?"]);
  });

  it("세션 기록이 먼저 말을 썼으면 훅의 말을 다시 적지 않는다", async () => {
    const dir = home();
    await writeRoomMeta(dir, "demo", "r1", { title: "", kept: false, members: [] });
    const transcript = path.join(dir, "t.jsonl");
    writeTranscript(transcript, [human("시작"), bindCall("b1"), bindResult("b1", "r1"), said("ready"), human("다음")]);
    await mirrorSession(dir, { sessionId: "s3", transcriptPath: transcript, event: "UserPromptSubmit", prompt: "다음" });
    expect((await readRoom(dir, "demo", "r1"))?.messages.map((m) => ("text" in m ? m.text : ""))).toEqual(["시작", "ready", "다음"]);
  });

  it("슬래시 명령·시스템 말·쓰다 만 줄은 옮기지 않는다", async () => {
    const dir = home();
    await writeRoomMeta(dir, "demo", "r1", { title: "", kept: false, members: [] });
    const transcript = path.join(dir, "t.jsonl");
    const body = [human("시작"), bindCall("b1"), bindResult("b1", "r1"), human("/compact"), human("<command-name>/x</command-name>"),
      { type: "user", isMeta: true, message: { content: "meta" } }, said("ready")].map((r) => JSON.stringify(r)).join("\n");
    fs.writeFileSync(transcript, `${body}\n{"type":"assistant","message":{"content":[{"type":"text","text":"반쯤`);
    await mirrorSession(dir, { sessionId: "s4", transcriptPath: transcript, event: "Stop" });
    expect((await readRoom(dir, "demo", "r1"))?.messages.map((m) => ("text" in m ? m.text : ""))).toEqual(["시작", "ready"]);
  });

  it("읽기 전용 방에는 적지 않는다", async () => {
    const dir = home();
    await writeRoomMeta(dir, "demo", "r1", { title: "", kept: true, members: [] });
    const transcript = path.join(dir, "t.jsonl");
    writeTranscript(transcript, [human("시작"), bindCall("b1"), bindResult("b1", "r1"), said("ready")]);
    expect((await mirrorSession(dir, { sessionId: "s5", transcriptPath: transcript, event: "Stop" })).appended).toBe(0);
  });
});

describe("대화방 쓰기 잠금", () => {
  it("남은 잠금이 오래됐으면 걷고 쓴다", async () => {
    const dir = home();
    await appendRoomMessage(dir, "demo", "r1", { role: "user", text: "하나" });
    const lock = `${roomPath(dir, "demo", "r1")}.lock`;
    fs.writeFileSync(lock, "");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, old, old);
    await appendRoomMessage(dir, "demo", "r1", { role: "user", text: "둘" });
    expect((await readRoom(dir, "demo", "r1"))?.messages.map((m) => m.seq)).toEqual([0, 1]);
    expect(fs.existsSync(lock)).toBe(false);
  });

  // 빌드된 store 를 두 node 프로세스가 같이 부른다 (dist 가 없으면 건너뛴다).
  const built = path.resolve(__dirname, "../../dist/rooms/store.js");
  it.skipIf(!fs.existsSync(built))("두 프로세스가 같은 방에 동시에 써도 seq 가 겹치지 않는다", async () => {
    const dir = home();
    const store = built;
    const script = `import { appendRoomMessage } from ${JSON.stringify(store)};
      await Promise.all(Array.from({ length: 15 }, (_, i) => appendRoomMessage(${JSON.stringify(dir)}, "demo", "r1", { role: "user", text: process.argv[1] + i })));`;
    const runs = await Promise.all(["a", "b"].map((tag) => new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, ["--input-type=module", "--eval", script, tag], { stdio: "inherit" });
      child.on("close", resolve);
    })));
    expect(runs).toEqual([0, 0]);
    const seqs = (await readRoom(dir, "demo", "r1"))!.messages.map((m) => m.seq);
    expect(seqs).toHaveLength(30);
    expect(new Set(seqs).size).toBe(30);
  }, 30_000);
});


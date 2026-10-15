import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRoom, registerProject, roomMemberSchema } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import {
  attachRoomMemory,
  changedFiles,
  changeNote,
  claudeRoomArgs,
  codexRoomArgs,
  gitDirtySnapshot,
  grokRoomArgs,
  lmsRoomArgs,
  loadAgents,
  parseRoomStdout,
  removeRoom,
  roomListView,
  saveAgents,
  saveRoomCast,
  saveRoomTitle,
  sendRoomTurn,
  stopRoomTurn,
  type RoomRunner,
} from "./roomHost.js";
import { createFlowApp } from "./server.js";

async function setup() {
  const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-room-"));
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-room-repo-"));
  await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectPath });
  return { studioHome, projectPath };
}

describe("대화방", () => {
  it("Agent 아이콘 이미지는 http(s) 주소나 data:image 만 받는다", () => {
    const base = { speaker: "claude-code" as const, model: "", role: "" };
    expect(roomMemberSchema.safeParse({ ...base, image: "https://example.com/a.png" }).success).toBe(true);
    expect(roomMemberSchema.safeParse({ ...base, image: "data:image/png;base64,AAAA" }).success).toBe(true);
    expect(roomMemberSchema.safeParse({ ...base, image: "javascript:alert(1)" }).success).toBe(false);
    expect(roomMemberSchema.safeParse({ ...base, iconHtml: "<svg viewBox=\"0 0 8 8\"><circle cx=\"4\" cy=\"4\" r=\"4\"/></svg>" }).success).toBe(true);
    expect(roomMemberSchema.safeParse({ ...base, iconHtml: "x".repeat(100_001) }).success).toBe(false);
  });

  it("Agents 목록은 프로젝트에 남고, 같은 모델이라도 이름이 다르면 따로 등록된다", async () => {
    const { studioHome } = await setup();
    expect(await loadAgents(studioHome, "demo")).toEqual({ ok: true, agents: [] });
    const saved = await saveAgents(studioHome, {
      alias: "demo",
      agents: [
        { speaker: "claude-code", model: "claude-opus-5-5", effort: "medium", name: "수리", role: "이끈다.", color: "#2f3f8f" },
        { speaker: "claude-code", model: "claude-opus-5-5", effort: "medium", name: "검토", role: "검토한다." },
      ],
    });
    if (!saved.ok) throw new Error(saved.error);
    const loaded = await loadAgents(studioHome, "demo");
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.agents.map(a => a.name)).toEqual(["수리", "검토"]);
    expect(loaded.agents[0]?.color).toBe("#2f3f8f");
    expect(loaded.agents.every(a => a.id)).toBe(true);
    const twice = await saveAgents(studioHome, { alias: "demo", agents: [loaded.agents[0]!, loaded.agents[0]!] });
    expect(twice.ok).toBe(false);
    expect((await saveAgents(studioHome, { alias: "nope", agents: [] })).ok).toBe(false);
  });

  it("시작 버튼은 입력을 먼저 기록하고 같은 요청에서 호출하며 빈 입력으로도 이어간다", async () => {
    const { studioHome } = await setup();
    const seen: string[] = [];
    const runner: RoomRunner = async req => {
      seen.push(req.prompt);
      return { ok: true, text: "연결 확인", ms: 1 };
    };
    const cast = await saveRoomCast(studioHome, { alias: "demo", members: [{ speaker: "codex", model: "", role: "답한다." }] });
    if (!cast.ok) throw new Error(cast.error);
    for (const input of [{ text: "휴대폰 연결을 설명해줘", round: "talk" as const }, { text: "", round: "discuss" as const }]) {
      const sent = await sendRoomTurn(studioHome, { alias: "demo", roomId: cast.roomId, ...input }, { runner, bin: "codex" });
      if (!sent.ok) throw new Error(sent.error);
      await sent.done;
    }
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain("휴대폰 연결을 설명해줘");
    expect(seen[1]).toContain("연결 확인");
    expect((await readRoom(studioHome, "demo", cast.roomId))?.messages.map(m => m.role)).toEqual(["user", "user", "speaker", "user", "speaker"]);
  });

  it("방 목록은 LLM이 답하는 중인 방을 알려 준다", async () => {
    const { studioHome } = await setup();
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runner: RoomRunner = async () => {
      await gate;
      return { ok: true, text: "끝", ms: 1 };
    };
    const busy = await saveRoomCast(studioHome, { alias: "demo", members: [{ speaker: "grok", model: "", role: "답한다." }] });
    const idle = await saveRoomCast(studioHome, { alias: "demo", members: [{ speaker: "grok", model: "", role: "답한다." }] });
    if (!busy.ok || !idle.ok) throw new Error("cast");
    const sent = await sendRoomTurn(studioHome, { alias: "demo", roomId: busy.roomId, text: "", round: "talk" }, { runner, bin: "grok" });
    if (!sent.ok) throw new Error(sent.error);
    const during = await roomListView(studioHome, "demo");
    expect(during.find((row) => row.id === busy.roomId)?.running).toBe(true);
    expect(during.find((row) => row.id === idle.roomId)?.running).toBe(false);
    // 레일 불빛 — 프로젝트 단위로도 보인다.
    const app = createFlowApp({ studioHome });
    expect((await (await app.request("/api/running")).json()).aliases).toEqual(["demo"]);
    release();
    await sent.done;
    expect((await roomListView(studioHome, "demo")).every((row) => !row.running)).toBe(true);
    expect((await (await app.request("/api/running")).json()).aliases).toEqual([]);
  });

  it("중단하기는 지금 답하는 LLM을 끊고 남은 사람은 부르지 않는다", async () => {
    const { studioHome } = await setup();
    const called: string[] = [];
    const runner: RoomRunner = async (req) => {
      called.push(req.role);
      await new Promise<void>((resolve) => req.signal?.addEventListener("abort", () => resolve(), { once: true }));
      return { ok: false, kind: "stopped", text: "사람이 중단했다.", ms: 1 };
    };
    const cast = await saveRoomCast(studioHome, { alias: "demo", members: [{ speaker: "grok", model: "", role: "첫째" }, { speaker: "local", model: "qwen", role: "둘째" }] });
    if (!cast.ok) throw new Error(cast.error);
    expect(stopRoomTurn({ alias: "demo", roomId: cast.roomId }).ok).toBe(false);
    const sent = await sendRoomTurn(studioHome, { alias: "demo", roomId: cast.roomId, text: "", round: "talk" }, { runner, bin: "grok" });
    if (!sent.ok) throw new Error(sent.error);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopRoomTurn({ alias: "demo", roomId: cast.roomId }).ok).toBe(true);
    await sent.done;
    expect(called).toEqual(["첫째"]);
    const last = (await readRoom(studioHome, "demo", cast.roomId))?.messages.at(-1);
    expect(last).toMatchObject({ role: "system", kind: "stopped" });
    expect((await roomListView(studioHome, "demo")).every((row) => !row.running)).toBe(true);
  });

  it("토의 시작이면 부른 순서대로 한 바퀴 말하고 멈춘다", async () => {
    const { studioHome } = await setup();
    const seen: string[] = [];
    const runner: RoomRunner = async (req) => {
      seen.push(`${req.speaker}:${req.prompt}`);
      return { ok: true, text: req.speaker === "claude-code" ? "세 줄이다." : "그 세 줄은 빠졌다.", ms: 4 };
    };
    const cast = await saveRoomCast(studioHome, {
      alias: "demo",
      members: [
        { speaker: "claude-code", model: "sonnet", role: "짧게 요약한다." },
        { speaker: "grok", model: "grok-3", role: "빠진 점을 짚는다." },
      ],
    });
    if (!cast.ok) throw new Error(cast.error);
    const said = await sendRoomTurn(studioHome, { alias: "demo", roomId: cast.roomId, text: "요약해 줘" }, { runner, bin: "claude" });
    if (!said.ok) throw new Error(said.error);
    await said.done;
    expect(seen).toHaveLength(0);
    const round = await sendRoomTurn(studioHome, { alias: "demo", roomId: cast.roomId, text: "토의 시작" }, { runner, bin: "claude" });
    if (!round.ok) throw new Error(round.error);
    await round.done;
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain("짧게 요약한다.");
    expect(seen[0]).toContain("한 점을 받는다");
    expect(seen[1]).toContain("세 줄이다.");
    expect(seen[1]).toContain("한 점을 받는다");
    const read = await readRoom(studioHome, "demo", cast.roomId);
    expect(read?.messages.map((m) => m.role)).toEqual(["user", "user", "speaker", "speaker"]);
  });

  it("붙인 맥락은 하나이고, 다음 한 바퀴가 읽는다", async () => {
    const { studioHome } = await setup();
    const seen: string[] = [];
    const runner: RoomRunner = async (req) => {
      seen.push(req.prompt);
      return { ok: true, text: "이었다.", ms: 1 };
    };
    const pinned = await attachRoomMemory(studioHome, {
      alias: "demo",
      text: "맥락. 이전 대화에서 1.0이 비었다.",
      sourceId: "older",
    });
    if (!pinned.ok) throw new Error(pinned.error);
    const again = await attachRoomMemory(studioHome, {
      alias: "demo",
      roomId: pinned.roomId,
      text: "두 번째 맥락",
      sourceId: "other",
    });
    expect(again.ok).toBe(false);
    const cast = await saveRoomCast(studioHome, {
      alias: "demo",
      roomId: pinned.roomId,
      members: [{ speaker: "claude-code", model: "", role: "구멍을 메운다." }],
    });
    if (!cast.ok) throw new Error(cast.error);
    const sent = await sendRoomTurn(studioHome, { alias: "demo", roomId: pinned.roomId, text: "대화 시작" }, { runner, bin: "claude" });
    if (!sent.ok) throw new Error(sent.error);
    await sent.done;
    expect(seen[0]).toContain("[맥락]");
    expect(seen[0]).toContain("1.0이 비었다");
    expect(seen[0]).toContain("받아치지 않는다");
  });

  it("실행 파일이 없으면 그 차례는 없음이고 다음 사람으로 간다", async () => {
    const { studioHome } = await setup();
    const runner: RoomRunner = async () => ({ ok: true, text: "있다.", ms: 1 });
    const cast = await saveRoomCast(studioHome, {
      alias: "demo",
      members: [
        { speaker: "codex", model: "", role: "검토한다." },
        { speaker: "claude-code", model: "", role: "요약한다." },
      ],
    });
    if (!cast.ok) throw new Error(cast.error);
    const result = await sendRoomTurn(studioHome, { alias: "demo", roomId: cast.roomId, text: "대화 시작" }, { runner, bin: null });
    if (!result.ok) throw new Error(result.error);
    await result.done;
    const read = await readRoom(studioHome, "demo", cast.roomId);
    expect(read?.messages.map((m) => (m.role === "system" ? m.text : m.role))).toEqual(["user", "Codex 없음", "Claude 없음"]);
  });

  it("꺼진 사람은 한 바퀴에 끼지 않는다", async () => {
    const { studioHome } = await setup();
    const seen: string[] = [];
    const runner: RoomRunner = async (req) => {
      seen.push(req.speaker);
      return { ok: true, text: "있다.", ms: 1 };
    };
    const cast = await saveRoomCast(studioHome, {
      alias: "demo",
      members: [
        { speaker: "claude-code", model: "", role: "요약한다.", name: "요약", enabled: false },
        { speaker: "grok", model: "", role: "반박한다.", name: "반박", enabled: true },
      ],
    });
    if (!cast.ok) throw new Error(cast.error);
    const round = await sendRoomTurn(studioHome, { alias: "demo", roomId: cast.roomId, text: "대화 시작" }, { runner, bin: "claude" });
    if (!round.ok) throw new Error(round.error);
    await round.done;
    expect(seen).toEqual(["grok"]);
  });

  it("제목을 고쳐도 방 주소는 그대로다", async () => {
    const { studioHome } = await setup();
    const cast = await saveRoomCast(studioHome, {
      alias: "demo",
      members: [],
    });
    if (!cast.ok) throw new Error(cast.error);
    const titled = await saveRoomTitle(studioHome, { alias: "demo", roomId: cast.roomId, title: "노드 읽기" });
    expect(titled.ok).toBe(true);
    const sent = await sendRoomTurn(studioHome, { alias: "demo", roomId: cast.roomId, text: "다른 첫 말" }, { bin: "claude" });
    if (!sent.ok) throw new Error(sent.error);
    expect(sent.roomId).toBe(cast.roomId);
  });

  it("POST /api/room/send 는 시작 뒤에 기록을 남긴다", async () => {
    const { studioHome } = await setup();
    const runner: RoomRunner = async () => ({ ok: true, text: "여기 있다.", ms: 1 });
    const app = createFlowApp({ studioHome, roomRunner: runner, roomBin: "claude" });
    const cast = await app.request("/api/room/cast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        alias: "demo",
        members: [{ speaker: "claude-code", model: "", role: "짧게 답한다." }],
      }),
    });
    expect(cast.status).toBe(200);
    const made = (await cast.json()) as { roomId: string };
    const res = await app.request("/api/room/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: "demo", roomId: made.roomId, text: "휴대폰에서 확인한다", round: "talk" }),
    });
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 30));
    const got = await app.request(`/api/room?alias=demo&id=${made.roomId}`);
    const room = (await got.json()) as { messages: { role: string; text?: string }[]; displayTitle: string };
    expect(room.messages.at(-1)?.text).toBe("여기 있다.");
    expect(room.messages[0]?.text).toBe("휴대폰에서 확인한다");
    const invalid = await app.request("/api/room/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: "demo", roomId: made.roomId, text: "", round: "invalid" }) });
    expect(invalid.status).toBe(400);
    expect(lmsRoomArgs("안녕", "짧게 답한다.", "qwen2.5-14b-instruct-mlx")).toEqual([
      "chat",
      "-p",
      "안녕",
      "--system-prompt",
      "짧게 답한다.",
      "qwen2.5-14b-instruct-mlx",
    ]);
    expect(parseRoomStdout('{"result":"답","usage":{"input_tokens":3,"output_tokens":5}}')).toEqual({
      text: "답",
      usage: { input: 3, output: 5 },
    });
    expect(parseRoomStdout("평문")).toEqual({ text: "평문" });
    expect(parseRoomStdout("\x1b[K\x1b[?25h로컬 답")).toEqual({ text: "로컬 답" });
    expect(claudeRoomArgs("안녕", "sonnet", "high")).toEqual(["-p", "안녕", "--output-format", "json", "--model", "sonnet", "--effort", "high"]);
    expect(grokRoomArgs("안녕", "grok-4.7")).toEqual([
      "--no-auto-update",
      "-p",
      "안녕",
      "--output-format",
      "json",
      "-m",
      "grok-4.7",
    ]);
    await app.close();
  });

  it("보내기면 Claude · Codex는 편집 권한으로 직접 고치고, Patchbay가 바뀐 파일을 센다 — 로컬 모델은 말만 한다", async () => {
    const { studioHome, projectPath } = await setup();
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["init", "-q"], { cwd: projectPath });
    const seen: { speaker: string; execution?: string; prompt: string; timeoutMs: number; writeDirs?: string[] }[] = [];
    const runner: RoomRunner = async (req) => {
      seen.push({ speaker: req.speaker, execution: req.execution, prompt: req.prompt, timeoutMs: req.timeoutMs, writeDirs: req.writeDirs });
      if (req.speaker === "codex") fs.writeFileSync(path.join(projectPath, "todo.md"), "- 할 일");
      return { ok: true, text: req.speaker === "codex" ? "할 일 칸을 고쳤다." : "확인했다.", ms: 3 };
    };
    const cast = await saveRoomCast(studioHome, {
      alias: "demo",
      members: [
        { id: "maker", speaker: "codex", model: "terra", role: "구현한다.", name: "팍스" },
        { id: "local", speaker: "local", model: "qwen", role: "말한다." },
        { id: "lead", speaker: "claude-code", model: "opus", role: "이끈다.", name: "수리" },
      ],
    });
    if (!cast.ok) throw new Error(cast.error);
    const sent = await sendRoomTurn(studioHome, { alias: "demo", roomId: cast.roomId, text: "할 일 칸을 고쳐 줘", round: "talk" }, { runner, bin: "x" });
    if (!sent.ok) throw new Error(sent.error);
    await sent.done;
    expect(seen.map((s) => [s.speaker, s.execution ?? "-"])).toEqual([["codex", "apply"], ["local", "-"], ["claude-code", "apply"]]);
    expect(seen[0]?.timeoutMs).toBe(900_000);
    expect(seen[0]?.prompt).toContain("직접 반영한다");
    expect(seen[0]?.prompt).toContain(path.join(studioHome, "projects", "demo", "todos.json"));
    expect(seen[0]?.prompt).toContain("방금 끝낸 항목은 done=true");
    expect(seen[0]?.writeDirs).toEqual([path.join(studioHome, "projects", "demo")]);
    expect(seen[1]?.prompt).not.toContain("직접 반영한다");
    expect(seen[1]?.prompt).not.toContain("todos.json");
    const read = await readRoom(studioHome, "demo", cast.roomId);
    const said = read?.messages.filter((m) => m.role === "speaker").map((m) => (m.role === "speaker" ? m.text : ""));
    expect(said?.[0]).toContain("할 일 칸을 고쳤다.");
    expect(said?.[0]).toContain("바뀐 파일 1개");
    expect(said?.[0]).toContain("`todo.md`");
    // 아무것도 안 바꾼 차례에는 붙이지 않는다.
    expect(said?.[2]).toBe("확인했다.");
  });

  it("바뀐 파일은 새로 손댄 것 · 다시 고친 것 · 되돌린 것을 센다", async () => {
    const before = new Map([["a", 1], ["b", 2]]);
    const after = new Map([["a", 1], ["c", 3], ["b", 5]]);
    expect(changedFiles(before, after)).toEqual(["b", "c"]);
    expect(changedFiles(new Map([["gone", 1]]), new Map())).toEqual(["gone"]);
    expect(changeNote(null)).toBe("");
    expect(changeNote([])).toBe("");
    expect(await gitDirtySnapshot(fs.mkdtempSync(path.join(os.tmpdir(), "pb-nogit-")))).toBeNull();
    expect(codexRoomArgs("p", "m", undefined, "apply")).toContain("workspace-write");
    expect(codexRoomArgs("p", "m", undefined, "apply", "/repo/.git")).toEqual(expect.arrayContaining(["sandbox_workspace_write.network_access=true", "--add-dir", "/repo/.git"]));
    expect(codexRoomArgs("p", "m", undefined, "apply", "/repo/.git", ["/studio/projects/demo"])).toEqual(expect.arrayContaining(["--add-dir", "/studio/projects/demo"]));
    expect(codexRoomArgs("p", "m", undefined, "read")).not.toContain("sandbox_workspace_write.network_access=true");
  });

  it("할 일은 프로젝트에 남고 끝냄도 그대로 읽힌다", async () => {
    const { studioHome } = await setup();
    const app = createFlowApp({ studioHome });
    expect(await (await app.request("/api/todos?alias=demo")).json()).toEqual({ todos: [] });
    const item = { id: "t1", title: "사이드바 아이콘 커밋", done: false, at: "2026-10-13T11:00:00.000Z" };
    const saved = await app.request("/api/todos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: "demo", todos: [{ ...item, done: true }] }) });
    expect(saved.status).toBe(200);
    expect(await (await app.request("/api/todos?alias=demo")).json()).toEqual({ todos: [{ ...item, done: true, completedAt: expect.any(String) }] });
    const bad = await app.request("/api/todos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: "demo", todos: [{ id: "t2", title: "" }] }) });
    expect(bad.status).toBe(400);
    expect((await app.request("/api/todos?alias=nope")).status).toBe(404);
    await app.close();
  });

  it("삭제한 대화방은 다시 읽히지 않는다", async () => {
    const { studioHome } = await setup();
    const cast = await saveRoomCast(studioHome, { alias: "demo", members: [] });
    if (!cast.ok) throw new Error(cast.error);
    expect(await removeRoom(studioHome, { alias: "demo", roomId: cast.roomId })).toEqual({ ok: true });
    expect(await readRoom(studioHome, "demo", cast.roomId)).toBeNull();
    const missing = await removeRoom(studioHome, { alias: "demo", roomId: cast.roomId });
    expect(missing.ok).toBe(false);
  });

  it("모드를 고르면 연결된 Agent 조합이 켜지고, 보내기에서 해당 모드의 권한과 규약으로 실행된다", async () => {
    const { studioHome } = await setup();
    const seen: { speaker: string; execution?: string; prompt: string }[] = [];
    const runner: RoomRunner = async (req) => {
      seen.push({ speaker: req.speaker, execution: req.execution, prompt: req.prompt });
      return { ok: true, text: "계획 세 줄", ms: 2 };
    };
    const app = createFlowApp({ studioHome, roomRunner: runner, roomBin: "claude" });

    const savedAgents = await saveAgents(studioHome, {
      alias: "demo",
      agents: [
        { id: "lead", speaker: "claude-code", model: "opus", name: "수리", role: "이끈다." },
        { id: "critic", speaker: "grok", model: "grok-4", name: "비평", role: "반박한다." },
      ],
    });
    if (!savedAgents.ok) throw new Error(savedAgents.error);

    const modesRes = await app.request("/api/modes?alias=demo");
    expect(modesRes.status).toBe(200);
    const { modes } = (await modesRes.json()) as { modes: { id: string; name: string }[] };
    expect(modes.length).toBeGreaterThanOrEqual(6);

    const nextModes = modes.map((m) => (m.id === "planning" ? { ...m, icon: "planning", color: "#3b82f6", execution: "read", prompt: "목표와 검증 기준을 적는다.", agentIds: ["lead", "critic"] } : m));
    const postModes = await app.request("/api/modes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: "demo", modes: nextModes }),
    });
    expect(postModes.status).toBe(200);

    const pickMode = await app.request("/api/room/mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: "demo", modeId: "planning" }),
    });
    expect(pickMode.status).toBe(200);
    const picked = (await pickMode.json()) as { roomId: string; modeId: string | null; members: { id?: string; enabled?: boolean }[] };
    expect(picked.modeId).toBe("planning");
    expect(picked.members.filter((m) => m.enabled !== false).map((m) => m.id)).toEqual(["lead", "critic"]);

    const sent = await sendRoomTurn(studioHome, { alias: "demo", roomId: picked.roomId, text: "모드 기능 설계를 쪼개 줘", round: "talk" }, { runner, bin: "claude" });
    if (!sent.ok) throw new Error(sent.error);
    await sent.done;

    expect(seen).toHaveLength(2);
    expect(seen[0]?.execution).toBe("read");
    expect(seen[0]?.prompt).toContain("모드: 플래닝");
    expect(seen[0]?.prompt).toContain("목표와 검증 기준을 적는다.");

    const room = await readRoom(studioHome, "demo", picked.roomId);
    const userMsg = room?.messages.find((m) => m.role === "user" && m.text.includes("모드 기능 설계를 쪼개 줘"));
    expect(userMsg).toMatchObject({
      role: "user",
      modeId: "planning",
      modeName: "플래닝",
      modeIcon: "planning",
    });
    await app.close();
  });
});

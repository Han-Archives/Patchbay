import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readRoomMeta, registerProject, writeRoomMeta } from "@patchbay/core";
import { connectInProcess, callTool, resultJson } from "../testSupport.js";
import { llmStatus, type LlmRun } from "./session.js";

describe("세션 도구", () => {
  it("room_bind 는 등록된 프로젝트에만 새 방을 열고, 읽기 전용 방은 거절한다", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "pb-mcp-bind-"));
    await registerProject(home, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    const { client, close } = await connectInProcess(home);
    try {
      const made = resultJson(await callTool(client, "room_bind", { alias: "demo", title: "폰 작업" })) as any;
      expect(made).toMatchObject({ bound: true, alias: "demo", title: "폰 작업" });
      expect(made.roomId).toMatch(/^\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/);
      expect((await readRoomMeta(home, "demo", made.roomId)).title).toBe("폰 작업");
      const again = resultJson(await callTool(client, "room_bind", { alias: "demo", roomId: made.roomId })) as any;
      expect(again).toMatchObject({ bound: true, roomId: made.roomId, title: "폰 작업" });

      expect((await callTool(client, "room_bind", { alias: "nope" })).isError).toBe(true);
      expect((await callTool(client, "room_bind", { alias: "demo", roomId: "missing" })).isError).toBe(true);
      await writeRoomMeta(home, "demo", "kept", { title: null, kept: true, members: [] });
      expect((await callTool(client, "room_bind", { alias: "demo", roomId: "kept" })).isError).toBe(true);
    } finally { await close(); }
  });

  it("서버 안내에 세션 규칙이 실린다", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "pb-mcp-inst-"));
    const { client, close } = await connectInProcess(home);
    try {
      const text = client.getInstructions() ?? "";
      expect(text).toContain("room_bind");
      expect(text).toContain("PushNotification");
      expect(text).toContain("세 줄 안으로");
    } finally { await close(); }
  });

  it("llm_status 는 설치 · 로그인을 보고, probe 를 고른 공급자만 실제로 부른다", async () => {
    const calls: string[][] = [];
    const runner: LlmRun = async (bin, args) => {
      calls.push([bin, ...args]);
      if (args[0] === "auth") return { code: 0, stdout: '{"loggedIn":true}', stderr: "", timedOut: false };
      if (args[0] === "login") return { code: 1, stdout: "", stderr: "Not logged in", timedOut: false };
      return { code: 0, stdout: '{"type":"result","is_error":true,"result":"weekly limit reached"}', stderr: "", timedOut: false };
    };
    const rows = await llmStatus({ runner, probe: ["claude-code"], bins: { "claude-code": "/x/claude", codex: "/x/codex", grok: null, local: null } });
    expect(rows.find((r) => r.host === "claude-code")).toMatchObject({ installed: true, loggedIn: true, probe: { ok: false } });
    expect(rows.find((r) => r.host === "claude-code")?.probe?.detail).toContain("weekly limit");
    expect(rows.find((r) => r.host === "codex")).toMatchObject({ loggedIn: false, probe: null, hint: "codex login" });
    expect(rows.find((r) => r.host === "grok")).toMatchObject({ installed: false });
    expect(calls.filter((c) => c.includes("-p"))).toHaveLength(1);
  });
});

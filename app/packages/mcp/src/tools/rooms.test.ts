import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { appendRoomMessage, registerProject, writeRoomMeta } from "@patchbay/core";
import { connectInProcess, callTool, resultJson } from "../testSupport.js";

describe("테스트 대화 MCP 원문 조회", () => {
  it("증분 조회와 원문 순번을 제공하고 상담을 섞거나 재개하지 않는다", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "pb-mcp-room-"));
    await registerProject(home, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    await writeRoomMeta(home, "demo", "r1", { title: "테스트", kept: false, members: [] });
    await Promise.all(Array.from({ length: 5 }, (_, n) => appendRoomMessage(home, "demo", "r1", { role: "user", text: `메모 ${n}` })));
    const { client, close } = await connectInProcess(home);
    try {
      const page = resultJson(await callTool(client, "get_room", { alias: "demo", roomId: "r1", limit: 2 })) as any;
      expect(page.messages.map((m: any) => m.seq)).toEqual([0, 1]); expect(page.hasMore).toBe(true);
      const next = resultJson(await callTool(client, "get_room", { alias: "demo", roomId: "r1", afterSeq: page.nextSeq, limit: 10 })) as any;
      expect(next.messages.map((m: any) => m.seq)).toEqual([2, 3, 4]); expect(next.hasMore).toBe(false);
      expect(next.consultation).toContain("별도 조회");
      await expect(fs.access(path.join(home, "projects/demo/threads"))).rejects.toThrow();
      expect((await callTool(client, "get_room", { alias: "demo", roomId: "../bad" })).isError).toBe(true);
      expect((await callTool(client, "get_room", { alias: "../demo" })).isError).toBe(true);
    } finally { await close(); }
  });
});

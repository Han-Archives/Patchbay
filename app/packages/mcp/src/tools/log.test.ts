import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerProject, updateTodos, zonedParts } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { callTool, connectInProcess, resultJson } from "../testSupport.js";

describe("log_build · log_read (in-process MCP)", () => {
  it("정리한 뒤 그날 기록과 기간 색인을 태그 · 종류로 걸러 읽는다", async () => {
    const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-mcp-log-"));
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: path.join(studioHome, "nope") });
    const now = new Date();
    await updateTodos(studioHome, "demo", () => [{ id: "t1", title: "화면 버튼 고치기", done: false, at: now.toISOString() }], now);
    const today = zonedParts(now, "Asia/Seoul")!.date;
    const { client, close } = await connectInProcess(studioHome);
    try {
      const built = resultJson(await callTool(client, "log_build", { alias: "demo" })) as { written: string[] };
      expect(built.written).toContain(today);
      const day = resultJson(await callTool(client, "log_read", { alias: "demo", date: today })) as { state: string; record: string };
      expect(day.state).toBe("잠정");
      expect(day.record).toContain("**화면 버튼 고치기** · 추가 · #UI");
      const range = resultJson(await callTool(client, "log_read", { alias: "demo", from: today, to: today, tag: "UI", kind: "할일" })) as { entries: { title: string }[] };
      expect(range.entries.map((e) => e.title)).toEqual(["화면 버튼 고치기"]);
      const none = resultJson(await callTool(client, "log_read", { alias: "demo", from: today, to: today, tag: "문서" })) as { entries: unknown[] };
      expect(none.entries).toEqual([]);
      expect((await callTool(client, "log_read", { alias: "else", date: today })).isError).toBe(true);
    } finally {
      await close();
    }
  });
});

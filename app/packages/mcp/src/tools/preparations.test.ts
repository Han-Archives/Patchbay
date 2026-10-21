import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { callTool, connectInProcess, resultJson } from "../testSupport.js";
import type { ConsoleFetch } from "./preparations.js";

const home = () => fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-mcp-prep-"));
const item = { id: "p1", todoId: "t1", title: "보고서 쓰기", status: "ready", plan: ["자료 확인", "초안 작성"], completion: ["필수 내용 포함"], artifacts: [], roomId: "r1" };

describe("폰 · PC 어디서나 승인 · 반려", () => {
  it("폰 세션이 준비본을 보고, 사람이 말한 승인 · 보류 · 수정 요청을 콘솔의 같은 API로 넘긴다 — 콘솔의 거절도 그대로 돌려준다", async () => {
    const calls: { path: string; body?: unknown }[] = [];
    const consoleFetch: ConsoleFetch = async (pathAndQuery, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { action?: string } : undefined;
      calls.push({ path: pathAndQuery, ...(body ? { body } : {}) });
      if (pathAndQuery.startsWith("/api/todo-preparations?")) return Response.json({ items: [item], running: false });
      if (body?.action === "approve") return Response.json({ error: "기준 입력이 변경되어 다시 준비해야 합니다." }, { status: 409 });
      return Response.json({ ok: true, result: null });
    };
    const { client, close } = await connectInProcess(home(), { consoleFetch });
    try {
      expect(client.getInstructions()).toContain("decide_preparation");
      const listed = resultJson(await callTool(client, "list_preparations", { alias: "demo" })) as { items: { id: string; plan: string[] }[] };
      expect(listed.items).toEqual([{ id: "p1", todoId: "t1", title: "보고서 쓰기", status: "ready", plan: ["자료 확인", "초안 작성"], completion: ["필수 내용 포함"] }]);

      const held = await callTool(client, "decide_preparation", { alias: "demo", id: "p1", decision: "hold" });
      expect(held.isError).toBeFalsy();
      const revised = await callTool(client, "decide_preparation", { alias: "demo", id: "p1", decision: "revise", note: "표를 넣어줘" });
      expect(revised.isError).toBeFalsy();
      expect((await callTool(client, "decide_preparation", { alias: "demo", id: "p1", decision: "revise" })).isError).toBe(true);
      const refused = await callTool(client, "decide_preparation", { alias: "demo", id: "p1", decision: "approve" });
      expect(refused.isError).toBe(true);
      expect(JSON.stringify(resultJson(refused))).toContain("기준 입력이 변경");

      expect(calls.slice(1)).toEqual([
        { path: "/api/todo-preparations/action", body: { alias: "demo", id: "p1", action: "hold" } },
        { path: "/api/todo-preparations/action", body: { alias: "demo", id: "p1", action: "revise", note: "표를 넣어줘" } },
        { path: "/api/todo-preparations/action", body: { alias: "demo", id: "p1", action: "approve" } },
      ]);
    } finally { await close(); }
  });

  it("콘솔이 꺼져 있으면 결정을 넘기지 않고 알린다", async () => {
    const { client, close } = await connectInProcess(home(), { consoleFetch: async () => null });
    try {
      const result = await callTool(client, "decide_preparation", { alias: "demo", id: "p1", decision: "approve" });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(resultJson(result))).toContain("콘솔이 꺼져");
    } finally { await close(); }
  });
});

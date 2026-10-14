import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendThreadMessage, readThread, registerProject } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { callTool, connectInProcess, resultJson } from "../testSupport.js";

/** 호스트 모델이 MCP로 멈춘 노드에 답하는 길. 가상 대화 하나로 본다. */
async function setup() {
  const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-mcp-threads-"));
  await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
  await appendThreadMessage(studioHome, "demo", "th-1", { role: "user", text: "Q3 오답: 보기 B" });
  await appendThreadMessage(studioHome, "demo", "th-1", {
    role: "graph",
    status: "waiting",
    assistantId: "asst-1",
    nodeId: "explain",
    request: { question: "Q3" },
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
  });
  return studioHome;
}

describe("대화 도구 (in-process MCP)", () => {
  it("대기 요청을 읽고, 답을 붙이면 대기 목록에서 빠진다", async () => {
    const studioHome = await setup();
    const { client, close } = await connectInProcess(studioHome);
    try {
      const listed = resultJson(await callTool(client, "list_pending_requests", {})) as {
        count: number;
        pending: Array<{ threadId: string; seq: number; userText: string }>;
      };
      expect(listed.count).toBe(1);
      expect(listed.pending[0]).toMatchObject({ threadId: "th-1", seq: 1, userText: "Q3 오답: 보기 B" });

      const answered = await callTool(client, "answer_request", {
        alias: "demo",
        threadId: "th-1",
        seq: 1,
        text: "지문은 원인을 셋으로 든다",
        model: "claude-code",
      });
      expect(answered.isError).toBeFalsy();
      const read = (await readThread(studioHome, "demo", "th-1"))!;
      expect(read.messages.at(-1)).toMatchObject({ role: "host", outcome: "answered", model: "claude-code" });

      const after = resultJson(await callTool(client, "list_pending_requests", { alias: "demo" })) as { count: number };
      expect(after.count).toBe(0);
    } finally {
      await close();
    }
  });

  it("닫힌 요청에 다시 답하면 오류다", async () => {
    const studioHome = await setup();
    const { client, close } = await connectInProcess(studioHome);
    try {
      await callTool(client, "answer_request", { alias: "demo", threadId: "th-1", text: "첫 답" });
      const again = await callTool(client, "answer_request", { alias: "demo", threadId: "th-1", text: "둘째" });
      expect(again.isError).toBe(true);
    } finally {
      await close();
    }
  });

  it("get_thread 는 대화 목록과 한 대화를 준다", async () => {
    const studioHome = await setup();
    const { client, close } = await connectInProcess(studioHome);
    try {
      const list = resultJson(await callTool(client, "get_thread", { alias: "demo" })) as {
        threads: Array<{ threadId: string; status: string }>;
      };
      expect(list.threads).toEqual([expect.objectContaining({ threadId: "th-1", status: "waiting" })]);
      const one = resultJson(await callTool(client, "get_thread", { alias: "demo", threadId: "th-1" })) as {
        status: string;
        messages: unknown[];
      };
      expect(one.status).toBe("waiting");
      expect(one.messages).toHaveLength(2);
    } finally {
      await close();
    }
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { answerRequest, readThread } from "@patchbay/core";
import { beforeEach, describe, expect, it } from "vitest";
import type { LangGraphPort } from "./langgraphAdapter.js";
import { expireOverdue, finalText, findInterrupt, resumeThread, sendThreadMessage } from "./threadView.js";

/**
 * 가짜 LangGraph — 첫 실행은 `explain` 에서 멈추고, 재개되면 받은 값으로 끝난다.
 * 실물 그래프나 외부 레포를 쓰지 않는다 (고정 자료 원칙).
 */
function fakePort(opts: { connected?: boolean; failRun?: boolean } = {}) {
  const calls: Array<{ input: unknown; command?: unknown }> = [];
  let interrupted = false;
  let resumed: unknown = null;
  const port: LangGraphPort = {
    url: "http://fake",
    probe: async () => opts.connected ?? true,
    listAssistants: async () => [{ id: "asst-1", name: "오답", graphId: "wrong" }],
    getGraph: async () => null,
    listThreads: async () => [],
    getState: async () =>
      interrupted
        ? { values: {}, tasks: [{ name: "explain", interrupts: [{ value: { question: "Q3", timeoutMs: 1000 } }] }] }
        : { values: { messages: [{ type: "ai", content: `이유: ${JSON.stringify(resumed)}` }] }, tasks: [] },
    // dev 서버처럼 오래된 순으로 준다.
    listRuns: async () => calls.map((_, i) => ({ run_id: `run-${i + 1}`, created_at: `2026-10-05T00:00:0${i}Z` })),
    listHistory: async () => [],
    createThread: async () => "th-1",
    waitRun: async ({ input, command }) => {
      calls.push({ input, ...(command ? { command } : {}) });
      if (opts.failRun) return { status: "error", error: "graph blew up" };
      if (command) {
        interrupted = false;
        resumed = command.resume;
      } else {
        interrupted = true;
      }
      return { status: "ok", body: {} };
    },
  };
  return { port, calls };
}

let home: string;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-threadview-"));
});

const clock = (s: number) => () => new Date(Date.UTC(2026, 9, 5, 0, 0, s));

describe("findInterrupt · finalText", () => {
  it("tasks[].interrupts 와 맨 위 interrupts 둘 다 읽는다", () => {
    expect(findInterrupt({ tasks: [{ name: "n", interrupts: [{ value: 1 }] }] })).toEqual({ nodeId: "n", value: 1 });
    expect(findInterrupt({ tasks: [], interrupts: { t1: [{ value: "x" }] } })).toEqual({ nodeId: null, value: "x" });
    expect(findInterrupt({ tasks: [{ name: "n", interrupts: [] }] })).toBeNull();
  });

  it("마지막 AI 메시지, 없으면 summary", () => {
    expect(finalText({ messages: [{ type: "human", content: "q" }, { type: "ai", content: "a" }] })).toBe("a");
    expect(finalText({ summary: "요약" })).toBe("요약");
  });
});

describe("대화 한 바퀴 — 같은 thread_id", () => {
  it("보내면 멈추고, 호스트가 답하면 같은 스레드로 재개해 끝난다", async () => {
    const { port, calls } = fakePort();
    const sent = await sendThreadMessage(home, port, { alias: "demo", assistantId: "asst-1", text: "Q3 오답" }, clock(0));
    expect(sent).toMatchObject({ ok: true, threadId: "th-1", status: "waiting" });

    let read = (await readThread(home, "demo", "th-1"))!;
    expect(read.messages[1]).toMatchObject({
      role: "graph",
      status: "waiting",
      nodeId: "explain",
      deadlineAt: "2026-10-05T00:00:01.000Z",
    });

    await answerRequest(home, "demo", "th-1", { text: "단서 셋", model: "claude-code" });
    const resumed = await resumeThread(home, port, "demo", "th-1", clock(5));
    expect(resumed).toMatchObject({ ok: true, status: "done" });
    expect(calls[1]).toEqual({ input: null, command: { resume: { status: "answered", text: "단서 셋", model: "claude-code" } } });

    read = (await readThread(home, "demo", "th-1"))!;
    expect(read.messages.at(-1)).toMatchObject({ role: "graph", status: "success", runId: "run-2" });
    expect((read.messages.at(-1) as { text: string }).text).toContain("단서 셋");
  });

  it("멈춘 대화에는 새 말을 넣지 않는다", async () => {
    const { port } = fakePort();
    await sendThreadMessage(home, port, { alias: "demo", assistantId: "asst-1", text: "Q3" });
    const again = await sendThreadMessage(home, port, { alias: "demo", threadId: "th-1", assistantId: "asst-1", text: "또" });
    expect(again).toMatchObject({ ok: false, status: 409 });
  });

  it("한도가 지나면 시간 초과로 닫고 재개한다 — 그래프는 timeout 을 받는다", async () => {
    const { port, calls } = fakePort();
    await sendThreadMessage(home, port, { alias: "demo", assistantId: "asst-1", text: "Q3" }, clock(0));
    expect(await expireOverdue(home, port, "demo", clock(0))).toBe(0);
    expect(await expireOverdue(home, port, "demo", clock(2))).toBe(1);
    expect(calls[1]?.command).toEqual({ resume: { status: "timeout", text: "한도 시간 안에 호스트의 답이 없었다." } });
    const read = (await readThread(home, "demo", "th-1"))!;
    expect(read.messages.map((m) => m.role)).toEqual(["user", "graph", "system", "graph"]);
  });

  it("LangGraph가 꺼져 있으면 아무것도 쓰지 않고 거절한다", async () => {
    const { port } = fakePort({ connected: false });
    const sent = await sendThreadMessage(home, port, { alias: "demo", assistantId: "asst-1", text: "Q3" });
    expect(sent).toMatchObject({ ok: false, status: 503 });
    expect(await readThread(home, "demo", "th-1")).toBeNull();
  });

  it("실행 오류는 대화에 error 로 남는다", async () => {
    const { port } = fakePort({ failRun: true });
    const sent = await sendThreadMessage(home, port, { alias: "demo", assistantId: "asst-1", text: "Q3" });
    expect(sent).toMatchObject({ ok: true, status: "failed" });
    const read = (await readThread(home, "demo", "th-1"))!;
    expect(read.messages.at(-1)).toMatchObject({ role: "graph", status: "error", text: "graph blew up" });
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  answerRequest,
  appendThreadMessage,
  expireRequest,
  listPendingRequests,
  listThreads,
  readThread,
  resumeValueOf,
  safeThreadId,
  threadPath,
  threadStatus,
} from "./store.js";

/**
 * 대화 한 건이 사람 → 그래프(멈춤) → 호스트 → 그래프(끝)로 지나가는 길.
 * 고정 자료는 가상 대화다 — 실물 프로젝트를 끌어오지 않는다.
 */

let home: string;
const T = "thread-a1";

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-threads-"));
});

const at = (s: number) => new Date(Date.UTC(2026, 9, 5, 0, 0, s));

async function waitingThread() {
  await appendThreadMessage(home, "demo", T, { role: "user", text: "Q3 오답: 보기 B" }, at(0));
  return appendThreadMessage(
    home,
    "demo",
    T,
    {
      role: "graph",
      status: "waiting",
      assistantId: "asst-1",
      nodeId: "explain",
      request: { question: "Q3", chosen: "B" },
      deadlineAt: at(60).toISOString(),
    },
    at(1),
  );
}

describe("대화 파일", () => {
  it("한 줄에 메시지 하나, seq는 줄 순번이다", async () => {
    await waitingThread();
    const text = await fs.readFile(threadPath(home, "demo", T), "utf8");
    expect(text.trim().split("\n")).toHaveLength(2);
    const read = (await readThread(home, "demo", T))!;
    expect(read.messages.map((m) => m.seq)).toEqual([0, 1]);
    expect(read.broken).toEqual([]);
  });

  it("깨진 줄은 건너뛰되 숨기지 않는다 — 다음 seq도 그 줄을 센다", async () => {
    await appendThreadMessage(home, "demo", T, { role: "user", text: "하나" });
    await fs.appendFile(threadPath(home, "demo", T), "{not json\n", "utf8");
    const next = await appendThreadMessage(home, "demo", T, { role: "user", text: "둘" });
    expect(next.seq).toBe(2);
    expect((await readThread(home, "demo", T))!.broken).toHaveLength(1);
  });

  it("threadId는 파일 이름이 될 수 있어야 한다", () => {
    expect(() => safeThreadId("../x")).toThrow();
    expect(safeThreadId("019a-2b")).toBe("019a-2b");
  });

  it("없는 대화는 null, 대화가 없는 프로젝트는 빈 목록", async () => {
    expect(await readThread(home, "demo", "none")).toBeNull();
    expect(await listThreads(home, "demo")).toEqual([]);
  });
});

describe("멈춤 → 답 → 재개", () => {
  it("멈춘 대화는 waiting이고 대기 요청 목록에 맥락과 함께 나온다", async () => {
    await waitingThread();
    expect(threadStatus((await readThread(home, "demo", T))!.messages)).toBe("waiting");
    const pending = await listPendingRequests(home, "demo");
    expect(pending).toEqual([
      expect.objectContaining({ threadId: T, seq: 1, nodeId: "explain", userText: "Q3 오답: 보기 B" }),
    ]);
  });

  it("호스트가 답하면 resuming, 재개 값은 답이다", async () => {
    await waitingThread();
    const result = await answerRequest(home, "demo", T, { seq: 1, text: "지문은 원인을 셋으로 든다", model: "claude-code" }, at(9));
    expect(result.ok).toBe(true);
    const messages = (await readThread(home, "demo", T))!.messages;
    expect(threadStatus(messages)).toBe("resuming");
    expect(messages[2]).toMatchObject({ role: "host", replyTo: 1, outcome: "answered", ms: 8000 });
    expect(resumeValueOf(messages)).toEqual({ status: "answered", text: "지문은 원인을 셋으로 든다", model: "claude-code" });
    expect(await listPendingRequests(home, "demo")).toEqual([]);
  });

  it("거절도 답이다 — 빈 답은 거절로 보내야 받는다", async () => {
    await waitingThread();
    expect(await answerRequest(home, "demo", T, { text: "  " })).toMatchObject({ ok: false });
    const refused = await answerRequest(home, "demo", T, { text: "판단할 근거가 없다", refused: true });
    expect(refused.ok).toBe(true);
    expect(resumeValueOf((await readThread(home, "demo", T))!.messages)).toMatchObject({ status: "refused" });
  });

  it("닫힌 요청이나 다른 번호에는 답이 붙지 않는다", async () => {
    await waitingThread();
    expect(await answerRequest(home, "demo", T, { seq: 0, text: "x" })).toMatchObject({ ok: false });
    await answerRequest(home, "demo", T, { text: "첫 답" });
    expect(await answerRequest(home, "demo", T, { text: "두 번째" })).toMatchObject({ ok: false });
  });

  it("한도가 지나야만 시간 초과로 닫는다", async () => {
    await waitingThread();
    expect(await expireRequest(home, "demo", T, at(30))).toBeNull();
    const closed = await expireRequest(home, "demo", T, at(61));
    expect(closed).toMatchObject({ role: "system", outcome: "timeout", replyTo: 1 });
    expect(resumeValueOf((await readThread(home, "demo", T))!.messages)).toMatchObject({ status: "timeout" });
    expect(await answerRequest(home, "demo", T, { text: "늦은 답" })).toMatchObject({ ok: false });
  });

  it("피드백은 대화의 상태를 바꾸지 않는다", async () => {
    await waitingThread();
    await appendThreadMessage(home, "demo", T, { role: "feedback", target: 1, value: "down", note: "단서 인용 없음" });
    expect(threadStatus((await readThread(home, "demo", T))!.messages)).toBe("waiting");
  });

  it("목록은 최근 것이 앞이고 첫 사람 말이 이름이다", async () => {
    await appendThreadMessage(home, "demo", "old", { role: "user", text: "예전 질문" }, at(0));
    await waitingThread();
    const list = await listThreads(home, "demo");
    expect(list.map((t) => t.threadId)).toEqual([T, "old"]);
    expect(list[0]).toMatchObject({ title: "Q3 오답: 보기 B", status: "waiting", assistantId: "asst-1" });
  });
});

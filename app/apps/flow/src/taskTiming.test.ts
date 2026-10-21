import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendRoomMessage, registerProject, type RoomMessage } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { createFlowApp } from "./server.js";
import { alertOverdueTasks, sessionTurns, TASK_LIMIT_MS } from "./taskTiming.js";

const t = (minute: number) => new Date(Date.UTC(2026, 9, 21, 0, 0) + minute * 60_000).toISOString();
const user = (seq: number, minute: number, via = true): RoomMessage => ({ seq, at: t(minute), role: "user", text: "일", ...(via ? { via: "claude-session" as const } : {}) });
const reply = (seq: number, minute: number): RoomMessage => ({ seq, at: t(minute), role: "speaker", speaker: "claude-code", model: "", text: "답", ms: 1 });

describe("맡긴 일은 1시간 안에 결과", () => {
  it("맡긴 때부터 마지막 답까지 재고, 사람이 답한 뒤에는 시계를 다시 시작해 기다린 시간을 빼며, 60분을 넘긴 일을 가른다", () => {
    const now = new Date(t(400));
    const turns = sessionTurns("r1", "방", [
      user(0, 0), reply(1, 20), reply(2, 50),        // 50분 — 안
      user(3, 200), reply(4, 230),                    // 사람이 150분 뒤 답함 — 기다린 시간은 빠지고 30분
      user(5, 240), reply(6, 310),                    // 70분 — 넘김
      user(7, 320, false), reply(8, 330),             // 콘솔에서 쓴 말은 재지 않는다
      user(9, 335),                                   // 답 없이 65분째 — 넘김 · 진행 중
    ], now);
    expect(turns.map(turn => [turn.seq, Math.round(turn.ms / 60_000), turn.endAt === null])).toEqual([[0, 50, false], [3, 30, false], [5, 70, false], [9, 65, true]]);
    expect(turns.filter(turn => turn.ms > TASK_LIMIT_MS).map(turn => turn.seq)).toEqual([5, 9]);
  });

  it("대시보드 API로 넘긴 일을 보이고, 답 없이 넘긴 일은 폰 알림 채널로 한 번만 알린다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-task-timing-"));
    await registerProject(home, { alias: "demo", kind: "local_repo", path: fs.mkdtempSync(path.join(os.tmpdir(), "pb-task-timing-repo-")) });
    const start = new Date(Date.now() - 70 * 60_000);
    await appendRoomMessage(home, "demo", "2026-10-21-cccc0001", { role: "user", text: "폰에서 맡긴 일", via: "claude-session" }, start);
    const app = createFlowApp({ studioHome: home });
    try {
      const body = (await (await app.request("/api/task-timing?alias=demo")).json()) as { measured: number; over: { roomId: string; endAt: string | null }[] };
      expect(body.measured).toBe(1);
      expect(body.over).toMatchObject([{ roomId: "2026-10-21-cccc0001", endAt: null }]);
    } finally { await app.close(); }
    const posts: { url: string; body: { content: string } }[] = [];
    const options = { discordWebhook: "https://discord.com/api/webhooks/1/x", fetch: (async (url: string, init?: RequestInit) => { posts.push({ url, body: JSON.parse(String(init?.body)) }); return new Response("", { status: 204 }); }) as typeof fetch };
    const sent = new Set<string>();
    expect(await alertOverdueTasks(home, options, sent)).toHaveLength(1);
    expect(await alertOverdueTasks(home, options, sent)).toHaveLength(0);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body.content).toContain("맡긴 일이 1시간을 넘겼다");
  });
});

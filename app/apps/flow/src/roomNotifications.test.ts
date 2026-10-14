import { describe, expect, it } from "vitest";
import { notifyRoom, roomNotificationChannels } from "./roomNotifications.js";
import type { RoomExecution } from "@patchbay/core";

describe("선택한 메신저의 상태 알림", () => {
  it("원문은 포함하지 않고 연결 URL과 단계만 보내며 실패 결과를 보존한다", async () => {
    const sent: { url: string; body: any }[] = [];
    const fetcher = (async (url, init) => { sent.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return new Response(null, { status: sent.length === 1 ? 204 : 429 }); }) as typeof fetch;
    const ex = { phase: "deploy_approval", plan: { version: 3, goal: "secret requirement text" } } as RoomExecution;
    const options = { discordWebhook: "https://discord.com/api/webhooks/test/key", telegramToken: "test-token", telegramChatId: "chat", publicUrl: "https://patchbay.test/", fetch: fetcher };
    const results = await notifyRoom(options, "demo", "room", ex);
    expect(roomNotificationChannels(options)).toEqual({ discord: true, telegram: true });
    expect(JSON.stringify(sent)).not.toContain("secret requirement text");
    expect(sent[0]?.body.content).toContain("https://patchbay.test#room/demo/room");
    expect(sent[0]?.body.allowed_mentions.parse).toEqual([]);
    expect(results).toEqual([{ channel: "discord", sent: true }, { channel: "telegram", sent: false, error: "HTTP 429" }]);
  });
  it("설정이 없으면 외부 요청을 만들지 않는다", async () => {
    expect(await notifyRoom({ fetch: async () => { throw new Error("must not call"); } }, "demo", "room", {} as RoomExecution)).toEqual([]);
  });
});

import type { RoomExecution } from "@patchbay/core";
export interface RoomNotificationOptions {
  discordWebhook?: string; telegramToken?: string; telegramChatId?: string; publicUrl?: string; fetch?: typeof fetch;
}
export function roomNotificationChannels(options: RoomNotificationOptions) {
  return { discord: !!options.discordWebhook, telegram: !!(options.telegramToken && options.telegramChatId) };
}
export async function notifyRoom(options: RoomNotificationOptions, alias: string, roomId: string, execution: RoomExecution) {
  if (!options.discordWebhook && !(options.telegramToken && options.telegramChatId)) return [];
  const request = options.fetch ?? fetch;
  const link = options.publicUrl ? `${options.publicUrl.replace(/\/$/, "")}#room/${encodeURIComponent(alias)}/${encodeURIComponent(roomId)}` : "";
  const text = `Patchbay · ${alias}\n채택본 v${execution.plan.version} · 실행 상태 ${execution.phase}${link ? `\n${link}` : ""}`;
  const results: { channel: string; sent: boolean; error?: string }[] = [];
  const send = async (channel: string, url: string, body: unknown) => {
    try {
      const res = await request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      results.push({ channel, sent: res.ok, ...(!res.ok ? { error: `HTTP ${res.status}` } : {}) });
    } catch { results.push({ channel, sent: false, error: "전송 연결을 확인하지 못했다." }); }
  };
  if (options.discordWebhook) {
    const url = new URL(options.discordWebhook);
    if (url.protocol !== "https:" || !["discord.com", "discordapp.com"].includes(url.hostname) || !url.pathname.startsWith("/api/webhooks/")) throw new Error("Discord webhook 주소를 확인한다.");
    await send("discord", url.href, { content: text, allowed_mentions: { parse: [] } });
  }
  if (options.telegramToken && options.telegramChatId) await send("telegram", `https://api.telegram.org/bot${options.telegramToken}/sendMessage`, { chat_id: options.telegramChatId, text, link_preview_options: { is_disabled: true } });
  return results;
}

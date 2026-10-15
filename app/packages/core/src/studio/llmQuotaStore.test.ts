import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendConsultMessage,
  appendRoomMessage,
  clearLlmQuotaExhausted,
  loadLlmQuotaSnapshot,
  recordClaudeRateLimits,
  recordLlmQuotaExhausted,
  updateLlmQuotaConfig,
  writeStudio,
} from "../index.js";

const dirs: string[] = [];

async function makeHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-quota-"));
  dirs.push(dir);
  await writeStudio(dir, {
    name: "test-studio",
    projects: [{ alias: "demo", kind: "local_repo", path: dir }],
  });
  return dir;
}

afterEach(async () => {
  while (dirs.length) {
    const dir = dirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("llmQuotaStore", () => {
  it("computes 5-hour session and 7-day weekly remaining HP from room and consult logs", async () => {
    const home = await makeHome();
    const now = new Date("2026-10-15T12:00:00.000Z");

    // 2 hours ago (inside 5h session window)
    await appendRoomMessage(
      home,
      "demo",
      "2026-10-15-room1",
      {
        role: "speaker",
        speaker: "claude-code",
        model: "opus",
        text: "안녕하세요",
        ms: 1000,
        usage: { input: 30_000, output: 25_000 },
      },
      new Date("2026-10-15T10:00:00.000Z"),
    );

    // 2 days ago (outside 5h session window, inside 7d weekly window)
    await appendConsultMessage(
      home,
      "demo",
      "2026-10-13-con1",
      { role: "meta", host: "claude-code", model: "sonnet" },
      new Date("2026-10-13T10:00:00.000Z"),
    );
    await appendConsultMessage(
      home,
      "demo",
      "2026-10-13-con1",
      {
        role: "host",
        text: "설계 초안입니다",
        model: "sonnet",
        ms: 1200,
        costUsd: 0.45,
        usage: { input: 100_000, output: 45_000 },
      },
      new Date("2026-10-13T10:01:00.000Z"),
    );

    const snap = await loadLlmQuotaSnapshot(home, now);
    const claude = snap.providers.find((p) => p.provider === "claude-code")!;
    expect(claude.session.usedTokens).toBe(55_000);
    expect(claude.weekly.usedTokens).toBe(200_000);
    // Claude는 서버 사용률이 없어 퍼센트를 매기지 않고 사용량만 낸다.
    expect(claude.estimated).toBe(true);
    expect(claude.session.remainingPct).toBeNull();
    expect(claude.weekly.remainingPct).toBeNull();
    expect(claude.hpPct).toBeNull();
    expect(claude.tone).toBe("ok");
  });

  it("locks HP at 0% when quota limit error is recorded and restores on clear", async () => {
    const home = await makeHome();
    const now = new Date("2026-10-15T12:00:00.000Z");

    const matched = await recordLlmQuotaExhausted(
      home,
      "codex",
      "You have hit your usage limit. Resets 5pm.",
      now,
    );
    expect(matched).toBe(true);

    const locked = await loadLlmQuotaSnapshot(home, now);
    const codex = locked.providers.find((p) => p.provider === "codex")!;
    expect(codex.hpPct).toBe(0);
    expect(codex.tone).toBe("bad");
    expect(codex.exhausted?.resetHint).toBe("5pm");

    await clearLlmQuotaExhausted(home, "codex");
    const restored = await loadLlmQuotaSnapshot(home, now);
    const codexAfter = restored.providers.find((p) => p.provider === "codex")!;
    expect(codexAfter.hpPct).toBe(100);
    expect(codexAfter.exhausted).toBeNull();
  });

  it("updates preset and custom caps", async () => {
    const home = await makeHome();
    await updateLlmQuotaConfig(home, (cur) => ({
      ...cur,
      preset: "custom",
      caps: {
        ...cur.caps,
        codex: { sessionTokens: 50_000, weeklyTokens: 250_000 },
      },
    }));

    const snap = await loadLlmQuotaSnapshot(home);
    expect(snap.preset).toBe("custom");
    expect(snap.caps.codex).toEqual({ sessionTokens: 50_000, weeklyTokens: 250_000 });
  });

  it("reads host ~/.claude/projects and ~/.codex/sessions excluding cached tokens and applying rate_limits", async () => {
    const home = await makeHome();
    const fakeHostHome = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-host-"));
    dirs.push(fakeHostHome);
    const now = new Date("2026-10-15T12:00:00.000Z");

    const claudeProjDir = path.join(fakeHostHome, ".claude", "projects", "demo");
    await fs.mkdir(claudeProjDir, { recursive: true });
    await fs.writeFile(
      path.join(claudeProjDir, "session-1.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-10-15T10:30:00.000Z",
          message: { id: "msg_1", usage: { input_tokens: 1000, output_tokens: 200 } },
        }),
        JSON.stringify({
          timestamp: "2026-10-15T10:30:05.000Z",
          message: { id: "msg_1", usage: { input_tokens: 1000, output_tokens: 43000 } },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const codexSessDir = path.join(fakeHostHome, ".codex", "sessions", "2026");
    await fs.mkdir(codexSessDir, { recursive: true });
    await fs.writeFile(
      path.join(codexSessDir, "rollout-1.jsonl"),
      JSON.stringify({
        timestamp: "2026-10-15T11:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 45000,
              cached_input_tokens: 40000,
              output_tokens: 1000,
            },
          },
          rate_limits: {
            primary: { used_percent: 4, resets_at: Math.floor(now.getTime() / 1000) + 7200 },
            secondary: { used_percent: 15, resets_at: Math.floor(now.getTime() / 1000) + 86400 },
          },
        },
      }) + "\n",
      "utf8",
    );

    const snap = await loadLlmQuotaSnapshot(home, now, { hostHome: fakeHostHome });
    const claude = snap.providers.find((p) => p.provider === "claude-code")!;
    expect(claude.session.usedTokens).toBe(44_000);
    expect(claude.hpPct).toBeNull();

    const codex = snap.providers.find((p) => p.provider === "codex")!;
    expect(codex.session.usedTokens).toBe(6_000);
    expect(codex.session.remainingPct).toBe(96);
    expect(codex.weekly.remainingPct).toBe(85);
    expect(codex.hpPct).toBe(85);
    expect(codex.estimated).toBe(false);
  });

  it("uses the server rate limits Claude Code hands its status line", async () => {
    const home = await makeHome();
    const now = new Date("2026-10-15T12:00:00.000Z");
    const nowSec = Math.floor(now.getTime() / 1000);
    expect(await recordClaudeRateLimits(home, { rate_limits: null }, now)).toBeNull();
    await recordClaudeRateLimits(home, {
      rate_limits: { five_hour: { used_percentage: 28.4, resets_at: nowSec + 5400 }, seven_day: { used_percentage: 61, resets_at: nowSec + 86400 } },
    }, now);

    const claude = (await loadLlmQuotaSnapshot(home, now)).providers.find((p) => p.provider === "claude-code")!;
    expect(claude.estimated).toBe(false);
    expect(claude.session.remainingPct).toBe(72);
    expect(claude.weekly.remainingPct).toBe(39);
    expect(claude.hpPct).toBe(39);
    expect(claude.session.recoverInMinutes).toBe(90);

    // 5시간 창이 지나면 세션은 다시 100%.
    const later = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const after = (await loadLlmQuotaSnapshot(home, later)).providers.find((p) => p.provider === "claude-code")!;
    expect(after.session.remainingPct).toBe(100);
    expect(after.hpPct).toBe(39);
  });

  it("locks Claude at 0% only when the host records a real limit rejection", async () => {
    const home = await makeHome();
    const fakeHostHome = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-host-"));
    dirs.push(fakeHostHome);
    const now = new Date("2026-10-15T12:00:00.000Z");
    const dir = path.join(fakeHostHome, ".claude", "projects", "demo");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "session-1.jsonl"),
      JSON.stringify({
        timestamp: "2026-10-15T11:50:00.000Z",
        quotaLimits: { status: "rejected", resetsAt: Math.floor(now.getTime() / 1000) + 3600, rateLimitType: "five_hour" },
      }) + "\n",
      "utf8",
    );

    const claude = (await loadLlmQuotaSnapshot(home, now, { hostHome: fakeHostHome })).providers.find((p) => p.provider === "claude-code")!;
    expect(claude.hpPct).toBe(0);
    expect(claude.session.remainingPct).toBe(0);
    expect(claude.tone).toBe("bad");
    expect(claude.exhausted?.reason).toContain("5시간");
  });
});

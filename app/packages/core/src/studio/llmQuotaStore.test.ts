import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendConsultMessage,
  appendRoomMessage,
  loadLlmQuotaSnapshot,
  recordClaudeRateLimits,
  readClaudeRateLimits,
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

  it("locks HP at 0% when quota limit error is recorded and lifts once Codex reports session room", async () => {
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

    const fakeHostHome = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-host-"));
    dirs.push(fakeHostHome);
    const codexSessDir = path.join(fakeHostHome, ".codex", "sessions", "2026");
    await fs.mkdir(codexSessDir, { recursive: true });
    const rollout = (timestamp: string, usedPercent: number) =>
      JSON.stringify({
        timestamp,
        type: "event_msg",
        payload: {
          type: "token_count",
          rate_limits: {
            primary: { used_percent: usedPercent, resets_at: Math.floor(now.getTime() / 1000) + 7200 },
            secondary: { used_percent: 15, resets_at: Math.floor(now.getTime() / 1000) + 86400 },
          },
        },
      }) + "\n";
    // 잠금 전 관측은 잠금을 풀지 않는다.
    await fs.writeFile(path.join(codexSessDir, "rollout-1.jsonl"), rollout("2026-10-15T11:59:00.000Z", 10), "utf8");
    const before = (await loadLlmQuotaSnapshot(home, now, { hostHome: fakeHostHome })).providers.find((p) => p.provider === "codex")!;
    expect(before.hpPct).toBe(0);

    const later = new Date("2026-10-15T13:00:00.000Z");
    await fs.appendFile(path.join(codexSessDir, "rollout-1.jsonl"), rollout("2026-10-15T12:30:00.000Z", 4), "utf8");
    const lifted = (await loadLlmQuotaSnapshot(home, later, { hostHome: fakeHostHome })).providers.find((p) => p.provider === "codex")!;
    expect(lifted.exhausted).toBeNull();
    expect(lifted.hpPct).toBe(85);
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

    // 재조회 없이 시간이 지나면 리셋됐다고 100%를 만들어 내지 않는다.
    const later = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const after = (await loadLlmQuotaSnapshot(home, later)).providers.find((p) => p.provider === "claude-code")!;
    expect(after.session.remainingPct).toBeNull();
    expect(after.hpPct).toBeNull();
    expect(after.rateStatus).toBe("stale");
    expect(after.weekly.observation?.remainingPct).toBe(39);
  });

  it("preserves each window and its observation time across concurrent partial updates", async () => {
    const home = await makeHome();
    const first = new Date("2026-10-19T01:00:00Z"), later = new Date("2026-10-19T01:02:00Z");
    await Promise.all([
      recordClaudeRateLimits(home, { rate_limits: { five_hour: { used_percentage: 28, resets_at: "2026-10-19T05:00:00Z" } } }, first),
      recordClaudeRateLimits(home, { rate_limits: { seven_day: { used_percentage: 8, resets_at: "2026-10-24T13:00:00Z" } } }, later),
    ]);
    const saved = await readClaudeRateLimits(home);
    expect(saved?.session?.at).toBe(first.toISOString());
    expect(saved?.weekly?.at).toBe(later.toISOString());
    const fresh = (await loadLlmQuotaSnapshot(home, later)).providers[0]!;
    expect(fresh.hpPct).toBe(72);
    expect(fresh.rateStatus).toBe("fresh");
    await recordClaudeRateLimits(home, { rate_limits: { five_hour: { used_percentage: 99, resets_at: "2026-10-19T05:00:00Z" } } }, new Date(first.getTime() - 1000));
    expect((await readClaudeRateLimits(home))?.session?.usedPct).toBe(28);
    expect(await recordClaudeRateLimits(home, {})).toBeNull();
    expect(await readClaudeRateLimits(home)).toEqual(saved);
  });

  it("shows the known window with an explicit partial status, while stale observations stay historical", async () => {
    const home = await makeHome();
    const now = new Date("2026-10-19T01:00:00Z");
    await recordClaudeRateLimits(home, { rate_limits: { seven_day: { used_percentage: 8, resets_at: "2026-10-24T13:00:00Z" } } }, now);
    const partial = (await loadLlmQuotaSnapshot(home, now)).providers[0]!;
    expect(partial.hpPct).toBe(92);
    expect(partial.estimated).toBe(true);
    expect(partial.rateStatus).toBe("partial");
    const stale = (await loadLlmQuotaSnapshot(home, new Date(now.getTime() + 6 * 60_000))).providers[0]!;
    expect(stale.hpPct).toBeNull();
    expect(stale.rateStatus).toBe("stale");
    expect(stale.weekly.observation).toMatchObject({ remainingPct: 92, observedAt: now.toISOString(), stale: true });
  });

  it("reads legacy observations without refreshing the missing window timestamp on a partial write", async () => {
    const home = await makeHome();
    const first = "2026-10-19T01:00:00.000Z";
    await fs.writeFile(path.join(home, "llm-quota-claude.json"), JSON.stringify({ at: first, session: { usedPct: 30, resetsAt: "2026-10-19T02:00:00Z" } }));
    await recordClaudeRateLimits(home, { rate_limits: { seven_day: { used_percentage: 8, resets_at: "2026-10-24T13:00:00Z" } } }, new Date("2026-10-19T01:10:00Z"));
    const result = (await loadLlmQuotaSnapshot(home, new Date("2026-10-19T01:10:00Z"))).providers[0]!;
    expect(result.session.observation).toMatchObject({ observedAt: first, stale: true });
    expect(result.session.remainingPct).toBeNull();
    expect(result.weekly.remainingPct).toBe(92);
    expect(result.hpPct).toBe(92);
    expect(result.rateStatus).toBe("stale");
  });

  it("lifts a Claude limit lock once the status line reports session room after it", async () => {
    const home = await makeHome();
    const lockedAt = new Date("2026-10-19T04:30:00Z");
    await recordLlmQuotaExhausted(home, "claude-code", "You've hit your session limit · resets 3pm (Asia/Seoul)", lockedAt);
    const before = new Date("2026-10-19T04:31:00Z");
    await recordClaudeRateLimits(home, { rate_limits: { five_hour: { used_percentage: 100, resets_at: "2026-10-19T06:00:00Z" }, seven_day: { used_percentage: 27, resets_at: "2026-10-24T13:00:00Z" } } }, before);
    const stillLocked = (await loadLlmQuotaSnapshot(home, before, { hostHome: null })).providers[0]!;
    expect(stillLocked.hpPct).toBe(0);
    expect(stillLocked.exhausted).not.toBeNull();

    const after = new Date("2026-10-19T06:21:00Z");
    await recordClaudeRateLimits(home, { rate_limits: { five_hour: { used_percentage: 6, resets_at: "2026-10-19T11:00:00Z" }, seven_day: { used_percentage: 27, resets_at: "2026-10-24T13:00:00Z" } } }, after);
    const lifted = (await loadLlmQuotaSnapshot(home, after, { hostHome: null })).providers[0]!;
    expect(lifted.exhausted).toBeNull();
    expect(lifted.session.remainingPct).toBe(94);
    expect(lifted.hpPct).toBe(73);

    // 그 관측이 오래돼도 잠금이 되살아나지 않는다 — 최신 값을 기다린다.
    const idle = (await loadLlmQuotaSnapshot(home, new Date("2026-10-19T06:40:00Z"), { hostHome: null })).providers[0]!;
    expect(idle.exhausted).toBeNull();
    expect(idle.hpPct).toBeNull();
    expect(idle.rateStatus).toBe("stale");
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

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureStudioInitialized, loadLlmQuotaSnapshot, readClaudeRateLimits } from "@patchbay/core";
import { createClaudeQuotaRefresh, readClaudeQuota } from "./claudeQuotaHost.js";
import { createFlowApp } from "./server.js";

const dirs: string[] = [];
async function home() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-claude-quota-test-")); dirs.push(dir); await ensureStudioInitialized(dir); return dir; }
afterEach(async () => { for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
const usage = (session: number, weekly: number) => ({ rate_limits_available: true, rate_limits: {
  five_hour: { utilization: session, resets_at: "2026-10-19T05:00:00Z" },
  seven_day: { utilization: weekly, resets_at: "2026-10-24T13:00:00Z" },
} });

describe("Claude quota host", () => {
  it("deduplicates concurrent reads, throttles for one minute, and persists native percentages", async () => {
    const dir = await home(); let now = Date.parse("2026-10-19T01:00:00Z"), calls = 0;
    const refresh = createClaudeQuotaRefresh(dir, async () => { calls++; return usage(calls === 1 ? 35 : 42, 21); }, () => now);
    await Promise.all(Array.from({ length: 8 }, () => refresh()));
    expect(calls).toBe(1);
    expect((await loadLlmQuotaSnapshot(dir, new Date(now))).providers[0]).toMatchObject({ hpPct: 65, rateStatus: "fresh" });
    await refresh(); expect(calls).toBe(1);
    now += 60_000; await refresh();
    expect(calls).toBe(2);
    expect((await loadLlmQuotaSnapshot(dir, new Date(now))).providers[0]?.hpPct).toBe(58);
  });

  it("preserves valid observations on failure, unavailable limits, and malformed payloads", async () => {
    const dir = await home(); let now = Date.parse("2026-10-19T01:00:00Z");
    let result: unknown = usage(35, 21), fail = false;
    const refresh = createClaudeQuotaRefresh(dir, async () => { if (fail) throw Error("offline"); return result; }, () => now);
    await refresh(); const saved = await readClaudeRateLimits(dir);
    for (result of [{ rate_limits_available: false }, { rate_limits_available: true, rate_limits: { five_hour: { utilization: 999, resets_at: "bad" } } }]) { now += 60_000; await refresh(); expect(await readClaudeRateLimits(dir)).toEqual(saved); }
    fail = true; now += 6 * 60_000; await refresh();
    expect(await readClaudeRateLimits(dir)).toEqual(saved);
    expect((await loadLlmQuotaSnapshot(dir, new Date(now))).providers[0]).toMatchObject({ hpPct: null, rateStatus: "stale" });
  });

  it("refreshes before serving the quota API without enabling native calls in ordinary apps", async () => {
    const dir = await home(); let calls = 0;
    const app = createFlowApp({ studioHome: dir, claudeQuotaRefresh: async () => { calls++; } });
    try { expect((await app.request("/api/llm-quota")).status).toBe(200); expect(calls).toBe(1); }
    finally { await app.close(); }
  });

  it("uses only initialize/get_usage control messages and ignores unrelated output", async () => {
    const dir = await home(), bin = path.join(dir, "fake-claude");
    await fs.writeFile(bin, `#!/usr/bin/env node
const readline = require('node:readline');
if (!process.argv.includes('--safe-mode') || !process.argv.includes('--no-session-persistence')) process.exit(12);
readline.createInterface({ input: process.stdin }).on('line', line => {
 const row = JSON.parse(line);
 if (row.type !== 'control_request' || !['initialize','get_usage'].includes(row.request.subtype)) process.exit(13);
 process.stdout.write('ignored plain log\\n');
 process.stdout.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:row.request_id,response:row.request.subtype==='get_usage'?{rate_limits_available:true}:{} }})+'\\n');
});
`, { mode: 0o755 });
    expect(await readClaudeQuota({ bin })).toEqual({ rate_limits_available: true });
  });

  it("times out a nonresponsive CLI without sending a model turn", async () => {
    const dir = await home(), bin = path.join(dir, "silent-claude");
    await fs.writeFile(bin, "#!/bin/sh\nexec sleep 20\n", { mode: 0o755 });
    await expect(readClaudeQuota({ bin, timeoutMs: 100 })).rejects.toThrow("초과");
  });
});

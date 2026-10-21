import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { recordClaudeRateLimits } from "@patchbay/core";
import { resolveBin } from "./processHost.js";

export type ClaudeQuotaReader = () => Promise<unknown>;

/** Claude SDK의 실험적 get_usage 제어 요청. 사용자 메시지·모델 턴·도구 실행은 보내지 않는다. */
export function readClaudeQuota(options: { bin?: string; timeoutMs?: number } = {}): Promise<unknown> {
  const bin = options.bin ?? resolveBin("claude", "PATCHBAY_CLAUDE_BIN", [path.join(os.homedir(), ".local/bin/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]);
  if (!bin) return Promise.reject(new Error("Claude CLI를 찾지 못했습니다."));
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--safe-mode", "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--no-session-persistence"], { cwd: os.tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    let settled = false, buffer = "", bytes = 0;
    const finish = (error?: Error, body?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill("SIGTERM");
      const kill = setTimeout(() => child.kill("SIGKILL"), 1000); kill.unref();
      child.once("close", () => clearTimeout(kill));
      if (error) reject(error); else resolve(body);
    };
    const timer = setTimeout(() => finish(new Error("Claude 사용률 조회 시간이 초과됐습니다.")), options.timeoutMs ?? 12_000);
    const send = (id: string, request: Record<string, unknown>) => child.stdin.write(`${JSON.stringify({ type: "control_request", request_id: id, request })}\n`);
    child.stdin.on("error", () => finish(new Error("Claude 사용률 조회 연결이 끊겼습니다.")));
    child.on("error", () => finish(new Error("Claude 사용률 조회를 시작하지 못했습니다.")));
    child.on("close", () => finish(new Error("Claude 사용률 응답을 받지 못했습니다.")));
    child.stderr.resume();
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1_000_000) { finish(new Error("Claude 사용률 응답이 너무 큽니다.")); return; }
      buffer += chunk.toString();
      let end: number;
      while (!settled && (end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let row: { type?: string; response?: { subtype?: string; request_id?: string; response?: unknown } };
        try { row = JSON.parse(line) as typeof row; } catch { continue; }
        if (row.type !== "control_response") continue;
        if (row.response?.subtype !== "success") { finish(new Error("Claude CLI가 사용률 조회를 지원하지 않거나 조회에 실패했습니다.")); return; }
        if (row.response.request_id === "init") send("quota", { subtype: "get_usage", skip_behaviors: true });
        if (row.response.request_id === "quota") finish(undefined, row.response.response);
      }
    });
    send("init", { subtype: "initialize", hooks: {} });
  });
}

/** 화면은 15초마다 조회하되 네이티브 사용률 요청은 최대 분당 한 번, 동시 요청은 하나로 합친다. */
export function createClaudeQuotaRefresh(studioHome: string, read: ClaudeQuotaReader = readClaudeQuota, clock = Date.now): () => Promise<void> {
  let attemptedAt = -Infinity;
  let pending: Promise<void> | null = null;
  return () => {
    if (pending) return pending;
    if (clock() - attemptedAt < 60_000) return Promise.resolve();
    attemptedAt = clock();
    pending = (async () => {
      try {
        const body = await read() as { rate_limits_available?: boolean; rate_limits?: Record<string, { utilization?: unknown; resets_at?: unknown } | null> } | null;
        if (body?.rate_limits_available !== true || !body.rate_limits) return;
        const window = (key: string) => {
          const row = body.rate_limits![key];
          if (!row || typeof row.utilization !== "number" || !Number.isFinite(row.utilization) || row.utilization < 0 || row.utilization > 100 || typeof row.resets_at !== "string" || !Number.isFinite(Date.parse(row.resets_at))) return undefined;
          return { used_percentage: row.utilization, resets_at: row.resets_at };
        };
        await recordClaudeRateLimits(studioHome, { rate_limits: { five_hour: window("five_hour"), seven_day: window("seven_day") } }, new Date(clock()));
      } catch {
        // 기존 관측값을 보존한다. 최신으로 위장하지 않고 스냅샷이 갱신 지연을 알린다.
      }
    })().finally(() => { pending = null; });
    return pending;
  };
}

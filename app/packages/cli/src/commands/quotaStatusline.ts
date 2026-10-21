import { CLAUDE_RATE_STALE_MS, recordClaudeRateLimits, requireStudioHome, type ClaudeRateLimits } from "@patchbay/core";

/**
 * Claude Code 상태줄(`statusLine`) 명령 — stdin 에 상태줄 입력 JSON 이 온다.
 * 그 안의 `rate_limits`(5시간 · 7일 사용률)를 작업 공간에 남겨 콘솔 체력바가 실제 % 를 쓰게 하고,
 * 상태줄에는 남은 비율을 한 줄로 찍는다. 상태줄을 깨뜨리지 않도록 늘 0 으로 끝난다.
 */
export async function runQuotaStatusline(readInput: () => Promise<string> = readStdin, write: (line: string) => void = line => process.stdout.write(line)): Promise<number> {
  try {
    const input = JSON.parse((await readInput()) || "{}") as unknown;
    const record = await recordClaudeRateLimits(requireStudioHome(), input);
    write(statusText(record));
  } catch (error) {
    console.error(`patchbay quota statusline: ${(error as Error).message}`);
  }
  return 0;
}

/** 콘솔 레일과 같은 색: 31~100% 보라 · 1~30% 주황 · 0% 빨강. */
function toneColor(pct: number): string {
  return pct <= 0 ? "\x1b[38;5;203m" : pct <= 30 ? "\x1b[38;5;214m" : "\x1b[38;5;141m";
}

/** 최신 관측의 남은 비율만 그린다. 리셋 시각을 넘기면 새 관측을 기다린다. */
export function hpBar(label: string, window: { usedPct: number; resetsAt: string; at?: string } | undefined, nowMs = Date.now()): string {
  if (!window || !(Date.parse(window.resetsAt) > nowMs) || (window.at && nowMs - Date.parse(window.at) > CLAUDE_RATE_STALE_MS)) return `${label} \x1b[2m──────────\x1b[0m  갱신 대기`;
  const pct = Math.max(0, Math.min(100, 100 - Math.round(window.usedPct)));
  const filled = Math.round(pct / 10);
  return `${label} ${toneColor(pct)}${"█".repeat(filled)}\x1b[2m${"░".repeat(10 - filled)}\x1b[0m ${toneColor(pct)}${String(pct).padStart(3)}%\x1b[0m`;
}

function statusText(record: ClaudeRateLimits | null): string {
  if (!record) return "CL 체력 · 사용률 없음";
  return `CL 체력  ${hpBar("5h", record.session)}  ${hpBar("7d", record.weekly)}`;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

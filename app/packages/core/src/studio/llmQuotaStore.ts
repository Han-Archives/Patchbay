import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readStudio } from "./studioStore.js";
import { listRooms, readRoom, withFileLock } from "../rooms/store.js";
import { currentConsultMeta, listArchivedConsults, listConsults, readConsult } from "../consult/store.js";

/**
 * LLM 구독제 토큰 체력(HP) 저장소 · 집계 (`~/.patchbay/llm-quota.json`).
 *
 * 일반 대화 응답의 토큰 합계만으로 구독 잔여 비율을 알 수는 없다.
 * Claude는 상태줄·Flow의 무추론 CLI 제어 조회, Codex는 세션 기록의 서버 사용률을 우선한다.
 * 따라서:
 * 1) 작업 공간 안의 모든 프로젝트 대화방(`chats/*.jsonl`)과 설계 상담(`consult/*.jsonl` + 보관본)에서
 *    공급자별 최근 5시간(세션 창) / 최근 7일(주간 창) 입력·출력 토큰을 합산해 기준 체력통 대비 잔여 체력(%)을 계산한다.
 * 2) 호스트 CLI가 한도 도달 문구(`usage limit`, `session limit`, `weekly limit`, `resets ...`)를 내면
 *    즉시 고갈 상태(`exhausted`)를 기록하여 체력을 0%로 잠그고, 해제 시각이 지나거나 그 뒤 서버 사용률이 5시간 창에 여유가 있다고 하면 푼다.
 */

export const LLM_QUOTA_FILE_NAME = "llm-quota.json";

export const LLM_QUOTA_PROVIDERS = ["claude-code", "codex"] as const;
export type LlmQuotaProvider = (typeof LLM_QUOTA_PROVIDERS)[number];

export const LLM_QUOTA_PRESETS = ["pro", "max5x", "max20x", "custom"] as const;
export type LlmQuotaPreset = (typeof LLM_QUOTA_PRESETS)[number];

export const SESSION_WINDOW_MS = 5 * 60 * 60 * 1000;
export const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const providerCapSchema = z.object({
  sessionTokens: z.number().int().positive(),
  weeklyTokens: z.number().int().positive(),
});
export type ProviderCap = z.infer<typeof providerCapSchema>;

export const providerExhaustedSchema = z.object({
  at: z.string(),
  resetHint: z.string().optional(),
  until: z.string().optional(),
  reason: z.string().optional(),
});
export type ProviderExhausted = z.infer<typeof providerExhaustedSchema>;

export const llmQuotaConfigSchema = z.object({
  preset: z.enum(LLM_QUOTA_PRESETS).default("max5x"),
  caps: z.object({
    "claude-code": providerCapSchema,
    codex: providerCapSchema,
  }),
  exhausted: z
    .object({
      "claude-code": providerExhaustedSchema.optional(),
      codex: providerExhaustedSchema.optional(),
    })
    .default({}),
});
export type LlmQuotaConfig = z.infer<typeof llmQuotaConfigSchema>;

export const PRESET_CAPS: Record<Exclude<LlmQuotaPreset, "custom">, Record<LlmQuotaProvider, ProviderCap>> = {
  pro: {
    "claude-code": { sessionTokens: 45_000, weeklyTokens: 450_000 },
    codex: { sessionTokens: 60_000, weeklyTokens: 500_000 },
  },
  max5x: {
    "claude-code": { sessionTokens: 220_000, weeklyTokens: 2_000_000 },
    codex: { sessionTokens: 150_000, weeklyTokens: 1_000_000 },
  },
  max20x: {
    "claude-code": { sessionTokens: 880_000, weeklyTokens: 8_000_000 },
    codex: { sessionTokens: 600_000, weeklyTokens: 4_000_000 },
  },
};

export const PROVIDER_META: Record<
  LlmQuotaProvider,
  { code: "CL" | "CX"; label: string; sub: string }
> = {
  "claude-code": { code: "CL", label: "Claude Code", sub: "claude · opus / sonnet" },
  codex: { code: "CX", label: "Codex CLI", sub: "codex · gpt-5.4 / o3" },
};

export function defaultLlmQuotaConfig(): LlmQuotaConfig {
  return {
    preset: "max5x",
    caps: {
      "claude-code": { ...PRESET_CAPS.max5x["claude-code"] },
      codex: { ...PRESET_CAPS.max5x.codex },
    },
    exhausted: {},
  };
}

export function llmQuotaPath(studioHome: string): string {
  return path.join(studioHome, LLM_QUOTA_FILE_NAME);
}

/**
 * Claude 상태줄과 Flow의 무추론 CLI 사용률 조회가 공유하는 관측 파일.
 * 일반 세션의 토큰 기록과 달리 서버가 제공한 사용률과 창별 관측 시각을 담는다.
 */
export const CLAUDE_RATE_FILE_NAME = "llm-quota-claude.json";

export const CLAUDE_RATE_STALE_MS = 5 * 60 * 1000;
const rateWindowSchema = z.object({ usedPct: z.number().min(0).max(100), resetsAt: z.string(), at: z.string().optional() });
const claudeRateSchema = z.object({ at: z.string(), session: rateWindowSchema.optional(), weekly: rateWindowSchema.optional() });
export type ClaudeRateLimits = z.infer<typeof claudeRateSchema>;

function rateWindow(raw: unknown): z.infer<typeof rateWindowSchema> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as { used_percentage?: unknown; resets_at?: unknown };
  if (typeof row.used_percentage !== "number" || !Number.isFinite(row.used_percentage)) return undefined;
  // 상태줄은 epoch 초를 준다. ISO 문자열이 와도 받는다.
  const resetMs = typeof row.resets_at === "number" ? row.resets_at * 1000 : typeof row.resets_at === "string" ? Date.parse(row.resets_at) : NaN;
  if (!Number.isFinite(resetMs)) return undefined;
  return { usedPct: Math.max(0, Math.min(100, row.used_percentage)), resetsAt: new Date(resetMs).toISOString() };
}

/** 상태줄 입력 JSON의 `rate_limits` 를 남긴다. 사용률이 없으면(API 키 등) 아무것도 쓰지 않고 null. */
export async function recordClaudeRateLimits(studioHome: string, statusInput: unknown, now: Date = new Date()): Promise<ClaudeRateLimits | null> {
  const limits = statusInput && typeof statusInput === "object" ? (statusInput as { rate_limits?: unknown }).rate_limits : undefined;
  if (!limits || typeof limits !== "object") return null;
  const session = rateWindow((limits as Record<string, unknown>).five_hour);
  const weekly = rateWindow((limits as Record<string, unknown>).seven_day);
  if (!session && !weekly) return null;
  const file = path.join(studioHome, CLAUDE_RATE_FILE_NAME);
  await fs.mkdir(path.dirname(file), { recursive: true });
  return withFileLock(file, async () => {
    const previous = await readClaudeRateLimits(studioHome);
    const merge = (fresh: typeof session, old: typeof session) => {
      const saved = old ? { ...old, at: old.at ?? previous!.at } : undefined;
      if (!fresh || (saved && Date.parse(saved.at) > now.getTime())) return saved;
      return { ...fresh, at: now.toISOString() };
    };
    const nextSession = merge(session, previous?.session);
    const nextWeekly = merge(weekly, previous?.weekly);
    const record: ClaudeRateLimits = {
      at: previous && Date.parse(previous.at) > now.getTime() ? previous.at : now.toISOString(),
      ...(nextSession ? { session: nextSession } : {}),
      ...(nextWeekly ? { weekly: nextWeekly } : {}),
    };
    await atomicWrite(file, `${JSON.stringify(record, null, 2)}\n`);
    return record;
  });
}

export async function readClaudeRateLimits(studioHome: string): Promise<ClaudeRateLimits | null> {
  try {
    const parsed = claudeRateSchema.safeParse(JSON.parse(await fs.readFile(path.join(studioHome, CLAUDE_RATE_FILE_NAME), "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const writes = new Map<string, Promise<unknown>>();

async function atomicWrite(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, text, "utf8");
  await fs.rename(tmp, file);
}

export async function readLlmQuotaConfig(studioHome: string): Promise<LlmQuotaConfig> {
  try {
    const raw = JSON.parse(await fs.readFile(llmQuotaPath(studioHome), "utf8")) as unknown;
    const parsed = llmQuotaConfigSchema.safeParse(raw);
    return parsed.success ? parsed.data : defaultLlmQuotaConfig();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultLlmQuotaConfig();
    return defaultLlmQuotaConfig();
  }
}

export function updateLlmQuotaConfig(
  studioHome: string,
  change: (current: LlmQuotaConfig) => LlmQuotaConfig | Promise<LlmQuotaConfig>,
): Promise<LlmQuotaConfig> {
  const file = llmQuotaPath(studioHome);
  const next = (writes.get(file) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const current = await readLlmQuotaConfig(studioHome);
      const updated = llmQuotaConfigSchema.parse(await change(current));
      await atomicWrite(file, `${JSON.stringify(updated, null, 2)}\n`);
      return updated;
    });
  writes.set(file, next);
  void next.finally(() => {
    if (writes.get(file) === next) writes.delete(file);
  });
  return next;
}

/** 호스트 출력이나 오류 문장이 구독 사용량 한도 도달인지 판별한다. */
export function detectQuotaLimitError(raw: string): { isLimit: boolean; resetHint?: string } {
  const text = raw.trim();
  if (!text) return { isLimit: false };
  const lower = text.toLowerCase();
  const isLimit =
    /usage limit|rate limit|session limit|weekly limit|hit your .*limit|429|limit (has been )?reached|quota exceeded|too many requests/.test(
      lower,
    );
  if (!isLimit) return { isLimit: false };
  const reset = /resets?\s+([^\n(.;]+)/i.exec(text)?.[1]?.trim();
  return reset ? { isLimit: true, resetHint: reset } : { isLimit: true };
}

/** 호스트가 한도 초과를 반환했을 때 호출하여 해당 공급자 체력을 즉시 0%(고갈)로 기록한다. */
export async function recordLlmQuotaExhausted(
  studioHome: string,
  provider: LlmQuotaProvider,
  rawText: string,
  now: Date = new Date(),
): Promise<boolean> {
  const detected = detectQuotaLimitError(rawText);
  if (!detected.isLimit) return false;
  await updateLlmQuotaConfig(studioHome, (current) => ({
    ...current,
    exhausted: {
      ...current.exhausted,
      [provider]: {
        at: now.toISOString(),
        ...(detected.resetHint ? { resetHint: detected.resetHint } : {}),
        until: new Date(now.getTime() + SESSION_WINDOW_MS).toISOString(),
        reason: rawText.trim().slice(0, 240),
      },
    },
  }));
  return true;
}

export interface QuotaObservation {
  observedAt: string;
  resetsAt: string;
  remainingPct: number;
  stale: boolean;
}

export interface LlmProviderHealth {
  provider: LlmQuotaProvider;
  code: "CL" | "CX";
  label: string;
  sub: string;
  /** 사용률 창이 일부 누락됐거나 오래돼 전체 잔여량을 확인할 수 없다. */
  estimated: boolean;
  rateStatus?: "fresh" | "partial" | "stale" | "missing";
  /** 고갈이면 0. 확인된 최신 창 중 최솟값, 모두 미확인이면 null. 부분 확인은 rateStatus로 구별한다. */
  hpPct: number | null;
  tone: "ok" | "warn" | "bad";
  session: {
    usedTokens: number;
    inputTokens: number;
    outputTokens: number;
    capTokens: number;
    remainingPct: number | null;
    tone: "ok" | "warn" | "bad";
    turns: number;
    /** 가장 오래된 5시간 창 내 호출이 빠져나와 회복되기 시작하는 남은 분. */
    recoverInMinutes: number | null;
    observation?: QuotaObservation;
  };
  weekly: {
    usedTokens: number;
    inputTokens: number;
    outputTokens: number;
    capTokens: number;
    remainingPct: number | null;
    tone: "ok" | "warn" | "bad";
    turns: number;
    costUsd: number;
    observation?: QuotaObservation;
  };
  exhausted: ProviderExhausted | null;
}

export interface LlmQuotaSnapshot {
  preset: LlmQuotaPreset;
  caps: Record<LlmQuotaProvider, ProviderCap>;
  providers: LlmProviderHealth[];
  updatedAt: string;
}

function toneOfPct(pct: number): "ok" | "warn" | "bad" {
  if (pct <= 0) return "bad";
  if (pct <= 30) return "warn";
  return "ok";
}

function clampPct(used: number, cap: number): number {
  if (cap <= 0) return 0;
  const remaining = Math.round(((cap - used) / cap) * 100);
  return Math.max(0, Math.min(100, remaining));
}

interface UsageSample {
  provider: LlmQuotaProvider;
  atMs: number;
  input: number;
  output: number;
  costUsd: number;
}

interface HostRateLimitWindow {
  remainingPct: number;
  resetsAtMs: number;
}

/** 창이 이미 재설정됐으면 남은 비율은 100%. */
function serverWindow(window: { usedPct: number; resetsAt: string } | undefined, nowMs: number): HostRateLimitWindow | null {
  if (!window) return null;
  const resetsAtMs = Date.parse(window.resetsAt);
  if (!Number.isFinite(resetsAtMs)) return null;
  return { remainingPct: resetsAtMs > nowMs ? Math.max(0, Math.min(100, 100 - Math.round(window.usedPct))) : 100, resetsAtMs };
}

function claudeObservation(window: ClaudeRateLimits["session"], at: string | undefined, nowMs: number): QuotaObservation | undefined {
  if (!window || !at) return undefined;
  const observedAt = window.at ?? at;
  const observedMs = Date.parse(observedAt), resetsMs = Date.parse(window.resetsAt);
  return {
    observedAt, resetsAt: window.resetsAt,
    remainingPct: Math.max(0, Math.min(100, 100 - Math.round(window.usedPct))),
    stale: !Number.isFinite(observedMs) || !Number.isFinite(resetsMs) || observedMs > nowMs + 60_000 || nowMs - observedMs > CLAUDE_RATE_STALE_MS || resetsMs <= nowMs,
  };
}

interface HostCliCollection {
  claudeSamples: UsageSample[];
  codexSamples: UsageSample[];
  autoExhausted: Partial<Record<LlmQuotaProvider, ProviderExhausted>>;
  lastSessionResetMs: Partial<Record<LlmQuotaProvider, number>>;
  lastWeeklyResetMs: Partial<Record<LlmQuotaProvider, number>>;
  codexRateLimits: {
    session: HostRateLimitWindow | null;
    weekly: HostRateLimitWindow | null;
    observedAtMs: number;
  };
}

function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.round(chars / 3));
}

/**
 * 과거 room 기록 중 Codex `cached_input_tokens`가 `input`에 합산된 경우를 보정한다.
 */
function normalizeRoomInputTokens(provider: LlmQuotaProvider, input: number, output: number): number {
  if (provider === "codex" && input > 50_000 && input > output * 10) {
    return Math.max(1_000, Math.round(input * 0.1));
  }
  return input;
}

function isTemporaryStudioHome(studioHome: string): boolean {
  const normalized = path.resolve(studioHome);
  const tmp = path.resolve(os.tmpdir());
  return (
    normalized.startsWith(tmp) ||
    normalized.startsWith("/tmp/") ||
    normalized.startsWith("/private/tmp/") ||
    normalized.startsWith("/var/folders/") ||
    normalized.startsWith("/private/var/folders/")
  );
}

async function listRecentJsonlFiles(dir: string, sinceMs: number, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await listRecentJsonlFiles(full, sinceMs, out);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      try {
        const st = await fs.stat(full);
        if (st.mtimeMs >= sinceMs) out.push(full);
      } catch {
        // ignore disappeared file
      }
    }
  }
  return out;
}

/**
 * 로컬 머신의 `~/.claude/projects` · `~/.codex/sessions`에 기록된 호스트 CLI 세션 원문에서
 * 최근 7일 내 실제 사용 토큰(캐시 제외)과 서버가 내려준 rate_limits / quotaLimits를 읽는다.
 */
async function collectHostCliUsage(
  hostHome: string,
  sinceMs: number,
  now: Date,
): Promise<HostCliCollection> {
  const nowMs = now.getTime();
  const claudeByMsgId = new Map<string, UsageSample>();
  const codexSamples: UsageSample[] = [];
  const autoExhausted: Partial<Record<LlmQuotaProvider, ProviderExhausted>> = {};
  const lastSessionResetMs: Partial<Record<LlmQuotaProvider, number>> = {};
  const lastWeeklyResetMs: Partial<Record<LlmQuotaProvider, number>> = {};
  let latestCodexRateTs = 0;
  let codexSessionWindow: HostRateLimitWindow | null = null;
  let codexWeeklyWindow: HostRateLimitWindow | null = null;

  // 1. ~/.claude/projects/**/*.jsonl
  const claudeFiles = await listRecentJsonlFiles(path.join(hostHome, ".claude", "projects"), sinceMs);
  for (const file of claudeFiles) {
    let content = "";
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      if (!line) continue;
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const tsStr = typeof row.timestamp === "string" ? row.timestamp : "";
      const atMs = Date.parse(tsStr);
      if (!Number.isFinite(atMs) || atMs < sinceMs) continue;

      const quotaLimits = row.quotaLimits as
        | { status?: unknown; resetsAt?: unknown; rateLimitType?: unknown }
        | undefined;
      if (quotaLimits?.status === "rejected" && typeof quotaLimits.resetsAt === "number") {
        const resetMs = quotaLimits.resetsAt * 1000;
        const limitType = quotaLimits.rateLimitType;
        if (resetMs > nowMs) {
          autoExhausted["claude-code"] = {
            at: tsStr,
            resetHint: new Date(resetMs).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
            until: new Date(resetMs).toISOString(),
            reason: `Claude Code ${limitType === "seven_day" ? "7일 주간" : "5시간 세션"} 한도 도달`,
          };
        } else if (limitType === "five_hour") {
          lastSessionResetMs["claude-code"] = Math.max(lastSessionResetMs["claude-code"] ?? 0, resetMs);
        } else if (limitType === "seven_day") {
          lastWeeklyResetMs["claude-code"] = Math.max(lastWeeklyResetMs["claude-code"] ?? 0, resetMs);
        }
      }

      const message = row.message as
        | { id?: unknown; usage?: { input_tokens?: unknown; output_tokens?: unknown } }
        | undefined;
      const usage = message?.usage ?? (row.usage as { input_tokens?: unknown; output_tokens?: unknown } | undefined);
      if (!usage) continue;
      const input = typeof usage.input_tokens === "number" && usage.input_tokens >= 0 ? usage.input_tokens : 0;
      const output = typeof usage.output_tokens === "number" && usage.output_tokens >= 0 ? usage.output_tokens : 0;
      if (input === 0 && output === 0) continue;
      const msgId =
        typeof message?.id === "string"
          ? message.id
          : typeof row.uuid === "string"
            ? row.uuid
            : `${file}:${tsStr}`;
      claudeByMsgId.set(msgId, {
        provider: "claude-code",
        atMs,
        input,
        output,
        costUsd: 0,
      });
    }
  }

  // 2. ~/.codex/sessions/**/*.jsonl
  const codexFiles = await listRecentJsonlFiles(path.join(hostHome, ".codex", "sessions"), sinceMs);
  for (const file of codexFiles) {
    let content = "";
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      if (!line || !line.includes("token_count")) continue;
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const tsStr = typeof row.timestamp === "string" ? row.timestamp : "";
      const atMs = Date.parse(tsStr);
      if (!Number.isFinite(atMs) || atMs < sinceMs) continue;

      const payload = row.payload as
        | {
            type?: unknown;
            info?: {
              last_token_usage?: {
                input_tokens?: unknown;
                cached_input_tokens?: unknown;
                output_tokens?: unknown;
              };
            };
            rate_limits?: {
              primary?: { used_percent?: unknown; resets_at?: unknown };
              secondary?: { used_percent?: unknown; resets_at?: unknown };
            };
          }
        | undefined;
      if (payload?.type !== "token_count") continue;

      const lastUsage = payload.info?.last_token_usage;
      if (lastUsage) {
        const rawIn = typeof lastUsage.input_tokens === "number" ? lastUsage.input_tokens : 0;
        const cachedIn = typeof lastUsage.cached_input_tokens === "number" ? lastUsage.cached_input_tokens : 0;
        const input = Math.max(0, rawIn - cachedIn);
        const output = typeof lastUsage.output_tokens === "number" ? lastUsage.output_tokens : 0;
        if (input > 0 || output > 0) {
          codexSamples.push({
            provider: "codex",
            atMs,
            input,
            output,
            costUsd: 0,
          });
        }
      }

      const rl = payload.rate_limits;
      if (rl && atMs >= latestCodexRateTs) {
        latestCodexRateTs = atMs;
        const pUsed = rl.primary?.used_percent;
        const pReset = rl.primary?.resets_at;
        if (typeof pUsed === "number" && typeof pReset === "number") {
          const resetsAtMs = pReset * 1000;
          codexSessionWindow =
            resetsAtMs > nowMs
              ? { remainingPct: Math.max(0, Math.min(100, 100 - Math.round(pUsed))), resetsAtMs }
              : { remainingPct: 100, resetsAtMs };
        }
        const sUsed = rl.secondary?.used_percent;
        const sReset = rl.secondary?.resets_at;
        if (typeof sUsed === "number" && typeof sReset === "number") {
          const resetsAtMs = sReset * 1000;
          codexWeeklyWindow =
            resetsAtMs > nowMs
              ? { remainingPct: Math.max(0, Math.min(100, 100 - Math.round(sUsed))), resetsAtMs }
              : { remainingPct: 100, resetsAtMs };
        }
      }
    }
  }

  return {
    claudeSamples: [...claudeByMsgId.values()],
    codexSamples,
    autoExhausted,
    lastSessionResetMs,
    lastWeeklyResetMs,
    codexRateLimits: {
      session: codexSessionWindow,
      weekly: codexWeeklyWindow,
      observedAtMs: latestCodexRateTs,
    },
  };
}

/** 작업 공간 안 모든 프로젝트의 rooms · consult 기록에서 최근 7일 내 LLM 토큰 사용 샘플을 모은다. */
async function collectUsageSamples(
  studioHome: string,
  sinceMs: number,
  now: Date,
): Promise<{ samples: UsageSample[]; autoExhausted: Partial<Record<LlmQuotaProvider, ProviderExhausted>> }> {
  const samples: UsageSample[] = [];
  const autoExhausted: Partial<Record<LlmQuotaProvider, ProviderExhausted>> = {};
  let aliases: string[] = [];
  try {
    const studio = await readStudio(studioHome);
    aliases = studio.projects.map((p) => p.alias);
  } catch {
    return { samples, autoExhausted };
  }

  const nowMs = now.getTime();

  for (const alias of aliases) {
    // 1. 대화방 (chats/*.jsonl)
    const rooms = await listRooms(studioHome, alias).catch(() => []);
    for (const summary of rooms) {
      if (summary.updatedAt && Date.parse(summary.updatedAt) < sinceMs) continue;
      const room = await readRoom(studioHome, alias, summary.id).catch(() => null);
      if (!room) continue;
      for (const msg of room.messages) {
        const atMs = Date.parse(msg.at);
        if (!Number.isFinite(atMs) || atMs < sinceMs) continue;
        if (msg.role === "speaker") {
          if (msg.speaker !== "claude-code" && msg.speaker !== "codex") continue;
          const provider: LlmQuotaProvider = msg.speaker;
          const rawInput = msg.usage?.input ?? estimateTokensFromChars(240);
          const output = msg.usage?.output ?? estimateTokensFromChars(msg.text.length);
          const input = normalizeRoomInputTokens(provider, rawInput, output);
          samples.push({ provider, atMs, input, output, costUsd: 0 });
        } else if (msg.role === "system" && msg.kind === "error" && nowMs - atMs <= SESSION_WINDOW_MS) {
          const detected = detectQuotaLimitError(msg.text);
          if (detected.isLimit) {
            const p: LlmQuotaProvider | null = msg.text.startsWith("Claude")
              ? "claude-code"
              : msg.text.startsWith("Codex")
                ? "codex"
                : null;
            if (p) {
              autoExhausted[p] = {
                at: msg.at,
                ...(detected.resetHint ? { resetHint: detected.resetHint } : {}),
                until: new Date(atMs + SESSION_WINDOW_MS).toISOString(),
                reason: msg.text.slice(0, 240),
              };
            }
          }
        }
      }
    }

    // 2. 설계 상담 (consult/*.jsonl + consult/archive/*.jsonl)
    const activeConsults = await listConsults(studioHome, alias).catch(() => []);
    const archivedConsults = await listArchivedConsults(studioHome, alias).catch(() => []);
    const consultIds = [
      ...activeConsults.filter((c) => !c.updatedAt || Date.parse(c.updatedAt) >= sinceMs).map((c) => c.id),
      ...archivedConsults.filter((c) => Date.parse(c.closedAt) >= sinceMs).map((c) => c.id),
    ];
    for (const id of consultIds) {
      const consult = await readConsult(studioHome, alias, id).catch(() => null);
      if (!consult) continue;
      let activeHost: LlmQuotaProvider = currentConsultMeta(consult.messages)?.host ?? "claude-code";
      for (const msg of consult.messages) {
        if (msg.role === "meta") {
          activeHost = msg.host;
          continue;
        }
        const atMs = Date.parse(msg.at);
        if (!Number.isFinite(atMs) || atMs < sinceMs) continue;
        if (msg.role === "host") {
          const input = msg.usage?.input ?? estimateTokensFromChars(600);
          const output = msg.usage?.output ?? estimateTokensFromChars(msg.text.length);
          samples.push({
            provider: activeHost,
            atMs,
            input,
            output,
            costUsd: msg.costUsd ?? 0,
          });
        } else if (msg.role === "system" && msg.kind === "error" && nowMs - atMs <= SESSION_WINDOW_MS) {
          const detected = detectQuotaLimitError(msg.text);
          if (detected.isLimit) {
            autoExhausted[activeHost] = {
              at: msg.at,
              ...(detected.resetHint ? { resetHint: detected.resetHint } : {}),
              until: new Date(atMs + SESSION_WINDOW_MS).toISOString(),
              reason: msg.text.slice(0, 240),
            };
          }
        }
      }
    }
  }

  return { samples, autoExhausted };
}

export async function loadLlmQuotaSnapshot(
  studioHome: string,
  now: Date = new Date(),
  options?: { hostHome?: string | null },
): Promise<LlmQuotaSnapshot> {
  const config = await readLlmQuotaConfig(studioHome);
  const nowMs = now.getTime();
  const sessionStartMs = nowMs - SESSION_WINDOW_MS;
  const weeklyStartMs = nowMs - WEEKLY_WINDOW_MS;

  const studioCollection = await collectUsageSamples(studioHome, weeklyStartMs, now);
  const claudeRate = await readClaudeRateLimits(studioHome);
  const effectiveHostHome =
    options?.hostHome !== undefined
      ? options.hostHome
      : isTemporaryStudioHome(studioHome)
        ? null
        : os.homedir();
  const hostCollection = effectiveHostHome
    ? await collectHostCliUsage(effectiveHostHome, weeklyStartMs, now)
    : null;

  const providers: LlmProviderHealth[] = LLM_QUOTA_PROVIDERS.map((provider) => {
    const meta = PROVIDER_META[provider];
    const cap = config.caps[provider];

    const studioProviderSamples = studioCollection.samples.filter((s) => s.provider === provider);
    const rawProviderSamples =
      provider === "claude-code" && hostCollection && hostCollection.claudeSamples.length > 0
        ? hostCollection.claudeSamples
        : provider === "codex" && hostCollection && hostCollection.codexSamples.length > 0
          ? hostCollection.codexSamples
          : studioProviderSamples;

    const effectiveWeeklyStartMs = Math.max(
      weeklyStartMs,
      hostCollection?.lastWeeklyResetMs[provider] ?? 0,
    );
    const effectiveSessionStartMs = Math.max(
      sessionStartMs,
      effectiveWeeklyStartMs,
      hostCollection?.lastSessionResetMs[provider] ?? 0,
    );

    const providerSamples = rawProviderSamples.filter((s) => s.atMs >= effectiveWeeklyStartMs);
    const sessionSamples = providerSamples.filter((s) => s.atMs >= effectiveSessionStartMs);

    const sessionIn = sessionSamples.reduce((sum, s) => sum + s.input, 0);
    const sessionOut = sessionSamples.reduce((sum, s) => sum + s.output, 0);
    const sessionUsed = sessionIn + sessionOut;

    const weeklyIn = providerSamples.reduce((sum, s) => sum + s.input, 0);
    const weeklyOut = providerSamples.reduce((sum, s) => sum + s.output, 0);
    const weeklyUsed = weeklyIn + weeklyOut;
    const weeklyCost = Number(
      studioProviderSamples
        .filter((s) => s.atMs >= effectiveWeeklyStartMs)
        .reduce((sum, s) => sum + s.costUsd, 0)
        .toFixed(4),
    );

    let exhausted: ProviderExhausted | null =
      config.exhausted[provider] ??
      hostCollection?.autoExhausted[provider] ??
      studioCollection.autoExhausted[provider] ??
      null;
    if (exhausted?.until && Date.parse(exhausted.until) <= nowMs) {
      exhausted = null;
    }

    // 서버가 준 남은 비율: Codex는 세션 기록의 rate_limits, Claude는 상태줄이 남긴 rate_limits.
    const codexSessionRl = provider === "codex" ? hostCollection?.codexRateLimits.session ?? null : null;
    const codexWeeklyRl = provider === "codex" ? hostCollection?.codexRateLimits.weekly ?? null : null;
    const sessionObservation = provider === "claude-code" ? claudeObservation(claudeRate?.session, claudeRate?.at, nowMs) : undefined;
    const weeklyObservation = provider === "claude-code" ? claudeObservation(claudeRate?.weekly, claudeRate?.at, nowMs) : undefined;
    const claudeSessionRl = sessionObservation && !sessionObservation.stale ? serverWindow(claudeRate?.session, nowMs) : null;
    const claudeWeeklyRl = weeklyObservation && !weeklyObservation.stale ? serverWindow(claudeRate?.weekly, nowMs) : null;
    // 잠금보다 나중에 받은 서버 5시간 창에 여유가 있으면 잠금을 푼다. 그 관측이 지금 오래됐어도 풀린 사실은 그대로다.
    const sessionAfterLock = provider === "claude-code"
      ? { observedMs: sessionObservation ? Date.parse(sessionObservation.observedAt) : 0, window: serverWindow(claudeRate?.session, nowMs) }
      : { observedMs: hostCollection?.codexRateLimits.observedAtMs ?? 0, window: codexSessionRl };
    if (exhausted && sessionAfterLock.window && sessionAfterLock.observedMs > Date.parse(exhausted.at) && sessionAfterLock.window.remainingPct > 0) {
      exhausted = null;
    }
    const serverSessionRl = codexSessionRl ?? claudeSessionRl;
    const serverWeeklyRl = codexWeeklyRl ?? claudeWeeklyRl;

    // Claude 토큰 합계는 실제 한도와 3~9배씩 어긋나 체력통으로 % 를 매기지 않는다 (2026-10-15).
    // 상태줄 사용률을 아직 못 받았으면 사용량만 보이고, 실제 한도 도달일 때만 0%로 잠근다.
    const estimated = provider === "claude-code" && (!serverSessionRl || !serverWeeklyRl);
    const rateStatus = provider !== "claude-code" ? undefined
      : !sessionObservation && !weeklyObservation ? "missing" as const
      : sessionObservation?.stale || weeklyObservation?.stale ? "stale" as const
      : !sessionObservation || !weeklyObservation ? "partial" as const : "fresh" as const;
    const sessionRemainingPct = exhausted
      ? 0
      : serverSessionRl
        ? serverSessionRl.remainingPct
        : provider === "claude-code"
          ? null
          : clampPct(sessionUsed, cap.sessionTokens);
    const weeklyRemainingPct = serverWeeklyRl
      ? serverWeeklyRl.remainingPct
      : provider === "claude-code"
        ? null
        : clampPct(weeklyUsed, cap.weeklyTokens);
    const availablePcts = [sessionRemainingPct, weeklyRemainingPct].filter((pct): pct is number => pct !== null);
    const hpPct = exhausted ? 0 : availablePcts.length ? Math.min(...availablePcts) : null;

    const oldestSessionAt = sessionSamples.length
      ? Math.min(...sessionSamples.map((s) => s.atMs))
      : null;
    const recoverInMinutes =
      serverSessionRl && serverSessionRl.resetsAtMs > nowMs && serverSessionRl.remainingPct < 100
        ? Math.max(1, Math.ceil((serverSessionRl.resetsAtMs - nowMs) / 60_000))
        : oldestSessionAt !== null
          ? Math.max(1, Math.ceil((oldestSessionAt + SESSION_WINDOW_MS - nowMs) / 60_000))
          : null;

    return {
      provider,
      code: meta.code,
      label: meta.label,
      sub: meta.sub,
      estimated,
      ...(rateStatus ? { rateStatus } : {}),
      hpPct,
      tone: toneOfPct(hpPct ?? 100),
      session: {
        usedTokens: sessionUsed,
        inputTokens: sessionIn,
        outputTokens: sessionOut,
        capTokens: cap.sessionTokens,
        remainingPct: sessionRemainingPct,
        tone: toneOfPct(sessionRemainingPct ?? 100),
        turns: sessionSamples.length,
        recoverInMinutes,
        ...(sessionObservation ? { observation: sessionObservation } : {}),
      },
      weekly: {
        usedTokens: weeklyUsed,
        inputTokens: weeklyIn,
        outputTokens: weeklyOut,
        capTokens: cap.weeklyTokens,
        remainingPct: weeklyRemainingPct,
        tone: toneOfPct(weeklyRemainingPct ?? 100),
        turns: providerSamples.length,
        costUsd: weeklyCost,
        ...(weeklyObservation ? { observation: weeklyObservation } : {}),
      },
      exhausted,
    };
  });

  return {
    preset: config.preset,
    caps: config.caps,
    providers,
    updatedAt: now.toISOString(),
  };
}

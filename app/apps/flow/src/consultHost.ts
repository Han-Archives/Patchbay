import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendConsultMessage,
  buildConsultBrief,
  closeConsult,
  listArchivedConsults,
  pathsTouchedBy,
  readProvenance,
  consultStatus,
  consultTranscript,
  currentConsultMeta,
  readConsult,
  applyConsultPatch,
  listRefs,
  readProposedIr,
  readStudio,
  refsDir,
  CONSULT_HOSTS,
  type ConsultHost,
  type ConsultMessage,
} from "@patchbay/core";
import { resolveBin } from "./processHost.js";

/**
 * 상담 호스트 실행 — 명세 20261006a §13.
 *
 * **모델을 부르는 곳은 여기 하나다.** Core · CLI · MCP는 호스트를 실행하지 않는다(원칙 5). 여기서도 API 키는
 * 없다 — 사용자가 이미 로그인한 CLI(Claude Code · Codex)를 턴마다 같은 세션으로 부른다. 호스트는 읽기
 * 전용이고, 초안은 Patchbay MCP `consult_update` 로만 쓴다.
 *
 * 실측(2026-10-06, Claude Code 2.1.289 · 구독): `--session-id` → `--resume` 으로 둘째 턴이 첫 턴을 기억했다.
 * Codex는 문서로만 확인했다 — 이 길은 C5 실측 전까지 「확인 전」으로 표시한다.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 한 턴의 한도 (§13.5). 넘으면 프로세스를 끝내고 `system · timeout`. */
export const CONSULT_TURN_TIMEOUT_MS = 300_000;

/** 상담 호스트가 쓸 수 있는 도구 — 읽기 + Patchbay 도구. 쓰기 도구(Edit · Write · Bash)는 없다. */
export const CLAUDE_CONSULT_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "mcp__patchbay__consult_update",
  "mcp__patchbay__get_prd",
  "mcp__patchbay__consult_history",
  "mcp__patchbay__get_atlas",
  "mcp__patchbay__get_project_bundle",
  "mcp__patchbay__find_documents",
  // 사람이 「+」로 붙인 링크를 볼 수 있게 (사용자 요청 2026-10-07). 쓰기 도구는 여전히 없다.
  "WebFetch",
];

export interface HostTurnRequest {
  host: ConsultHost;
  bin: string;
  model: string;
  /** Claude: 미리 정한 uuid · Codex: 첫 턴 뒤에 받은 thread_id. */
  sessionId?: string;
  /** 이 세션으로 앞 턴이 있었나 — 있으면 이어 가고, 없으면 새로 연다. */
  resume: boolean;
  brief: string;
  prompt: string;
  mcpConfigPath: string;
  mcpServer: { command: string; args: string[]; env: Record<string, string> };
  cwd: string;
  timeoutMs: number;
  /** 첨부 자료가 사는 폴더 — 호스트가 Read로 열 수 있게 (Claude `--add-dir`). */
  addDirs?: string[];
  /** 지금 무엇을 하는지 — 화면의 「상담자가 ~하는 중」. 호스트 출력이 흐르는 대로 부른다. */
  onActivity?: (activity: string) => void;
}

export type HostTurnResult =
  | { ok: true; text: string; sessionId?: string; ms: number; costUsd?: number }
  | { ok: false; kind: "error" | "timeout"; text: string; ms: number; partial?: string };

export type HostRunner = (req: HostTurnRequest) => Promise<HostTurnResult>;

export function claudeArgs(req: HostTurnRequest): string[] {
  return [
    "-p",
    req.prompt,
    ...(req.resume ? ["--resume", req.sessionId!] : ["--session-id", req.sessionId!]),
    ...(req.model ? ["--model", req.model] : []),
    // stream-json: 도구 호출 · 글이 흐르는 대로 보인다 — 화면이 「지금 무엇을 하는지」를 말하고,
    // 시간 초과 때 어디서 멈췄는지 설명할 수 있다. 마지막 줄(result)은 json 형식과 같은 칸을 든다.
    "--output-format",
    "stream-json",
    "--verbose",
    ...(req.addDirs ?? []).flatMap((dir) => ["--add-dir", dir]),
    "--append-system-prompt",
    req.brief,
    "--mcp-config",
    req.mcpConfigPath,
    "--strict-mcp-config",
    "--allowedTools",
    CLAUDE_CONSULT_TOOLS.join(","),
  ];
}

/** Codex — 문서(2026-10) 기준. `--sandbox read-only` 에서 MCP 쓰기가 되는지는 C5에서 실측한다. */
export function codexArgs(req: HostTurnRequest): string[] {
  const toml = (value: unknown) => JSON.stringify(value);
  const mcp = [
    "-c",
    `mcp_servers.patchbay.command=${toml(req.mcpServer.command)}`,
    "-c",
    `mcp_servers.patchbay.args=${toml(req.mcpServer.args)}`,
    ...Object.entries(req.mcpServer.env).flatMap(([k, v]) => ["-c", `mcp_servers.patchbay.env.${k}=${toml(v)}`]),
  ];
  const common = ["--json", "--sandbox", "read-only", "--skip-git-repo-check", ...(req.model ? ["-m", req.model] : []), ...mcp];
  // Codex exec 에는 시스템 안내를 덧붙이는 플래그가 없다 — 안내를 말머리에 둔다. 매 턴 진행이 바뀌므로 매 턴 넣는다.
  const prompt = `[상담 안내]\n${req.brief}\n\n[사람]\n${req.prompt}`;
  return req.resume ? ["exec", "resume", req.sessionId!, ...common, prompt] : ["exec", ...common, prompt];
}

export function parseClaudeOutput(stdout: string): { text: string; sessionId?: string; costUsd?: number; isError: boolean } {
  const body = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as Record<string, unknown>;
  return {
    text: typeof body.result === "string" ? body.result : "",
    ...(typeof body.session_id === "string" ? { sessionId: body.session_id } : {}),
    ...(typeof body.total_cost_usd === "number" ? { costUsd: body.total_cost_usd } : {}),
    isError: body.is_error === true || body.subtype === "error",
  };
}

export function parseCodexOutput(stdout: string): { text: string; sessionId?: string; isError: boolean; error?: string } {
  let text = "";
  let sessionId: string | undefined;
  let error: string | undefined;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event.type === "thread.started" && typeof event.thread_id === "string") sessionId = event.thread_id;
    const item = event.item as Record<string, unknown> | undefined;
    if (event.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") text = item.text;
    if (event.type === "turn.failed" || event.type === "error") {
      const err = event.error as Record<string, unknown> | undefined;
      error = typeof err?.message === "string" ? err.message : typeof event.message === "string" ? event.message : "Codex 턴이 실패했다";
    }
  }
  return { text, ...(sessionId ? { sessionId } : {}), isError: Boolean(error) || !text, ...(error ? { error } : {}) };
}

const TOOL_ACTIVITY: Record<string, string> = {
  mcp__patchbay__consult_update: "초안에 쓰는 중",
  mcp__patchbay__get_prd: "PRD를 읽는 중",
  mcp__patchbay__consult_history: "지난 대화를 찾는 중",
  mcp__patchbay__get_atlas: "구조 요약을 읽는 중",
  mcp__patchbay__get_project_bundle: "프로젝트를 읽는 중",
  mcp__patchbay__find_documents: "문서를 찾는 중",
  Read: "파일을 읽는 중",
  Grep: "레포를 찾는 중",
  Glob: "파일 목록을 보는 중",
  WebFetch: "링크를 보는 중",
  consult_update: "초안에 쓰는 중",
  get_prd: "PRD를 읽는 중",
  consult_history: "지난 대화를 찾는 중",
};

/** 호스트 출력 한 줄 → 지금 하는 일 · 쓰고 있는 답. Claude stream-json · Codex --json 둘 다 본다. */
export function readStreamLine(line: string): { activity?: string; text?: string } {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return {};
  }
  // Claude: {type:"assistant", message:{content:[{type:"tool_use",name}|{type:"text",text}|{type:"thinking"}]}}
  if (event.type === "assistant") {
    const content = ((event.message as Record<string, unknown> | undefined)?.content ?? []) as Record<string, unknown>[];
    let activity: string | undefined;
    let text: string | undefined;
    for (const part of content) {
      if (part.type === "tool_use" && typeof part.name === "string") activity = TOOL_ACTIVITY[part.name] ?? `도구 ${part.name} 쓰는 중`;
      if (part.type === "thinking") activity = "생각하는 중";
      if (part.type === "text" && typeof part.text === "string") {
        text = part.text;
        activity = "답을 쓰는 중";
      }
    }
    return { ...(activity ? { activity } : {}), ...(text ? { text } : {}) };
  }
  // Codex: {type:"item.started"|"item.completed", item:{type:"mcp_tool_call"|"reasoning"|"agent_message", ...}}
  const item = event.item as Record<string, unknown> | undefined;
  if (item && typeof item.type === "string") {
    if (item.type === "reasoning") return { activity: "생각하는 중" };
    if (item.type === "mcp_tool_call") {
      const tool = typeof item.tool === "string" ? item.tool : "";
      return { activity: TOOL_ACTIVITY[tool] ?? "도구를 쓰는 중" };
    }
    if (item.type === "agent_message" && typeof item.text === "string") return { activity: "답을 쓰는 중", text: item.text };
  }
  return {};
}

/**
 * 실패를 사람이 알아듣는 말로 (사용자 요청 2026-10-07 — 「시간 초과」만으로는 왜 멈췄는지 모른다).
 * 호스트가 낸 원문은 뒤에 붙여 둔다. 모르는 실패는 원문 그대로.
 */
export function explainHostFailure(raw: string, model: string): string {
  const text = raw.trim();
  const lower = text.toLowerCase();
  if (/usage limit|rate limit|session limit|weekly limit|hit your .*limit|429|limit (has been )?reached|quota|too many requests/.test(lower)) {
    const reset = /resets? ([^\n(]+)/i.exec(text)?.[1]?.trim();
    return `구독 사용량 한도에 걸렸다.${reset ? ` ${reset}에 풀린다.` : ""} 풀리면 「같은 말 다시 보내기」를 누르면 된다.\n(호스트: ${text.slice(0, 200)})`;
  }
  if (/prompt is too long|context (window|length)|too many tokens|max_tokens|maximum context/.test(lower)) {
    return `대화가 길어져 모델이 한 번에 읽을 수 있는 양(토큰)을 넘었다. 새 상담을 열면 지금 초안에서 이어 간다 — 지금까지 쓴 초안은 그대로다.\n(호스트: ${text.slice(0, 200)})`;
  }
  if (/issue with the selected model|model.*(not exist|not found|invalid)|unknown model/.test(lower)) {
    return `모델 이름 「${model}」을 호스트가 모른다. 모델 칸을 비우거나 sonnet · opus · haiku 중에서 고른다.`;
  }
  if (/not logged in|login|authenticate|unauthorized|401/.test(lower)) {
    return `호스트가 로그인돼 있지 않다. 터미널에서 호스트를 한 번 켜서 로그인한다.\n(호스트: ${text.slice(0, 200)})`;
  }
  if (/max.?turns/.test(lower)) return "호스트가 한 턴에 할 수 있는 단계 수를 다 썼다. 「이어서」를 누르면 남은 것부터 한다.";
  return text || "호스트가 아무 말 없이 끝났다.";
}

function runProcess(
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  onLine?: (line: string) => void,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    // 프로세스 묶음으로 띄운다 — 호스트 CLI는 MCP 서버 같은 자식을 띄우고, 자식이 출력 파이프를 쥐고 있으면
    // 부모만 끝내서는 「끝남」이 오지 않는다. 시간 초과 때 묶음 전체를 끝낸다.
    const child = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env, detached: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), 2000).unref();
      // 파이프가 늦게 닫혀도 기다리지 않는다.
      setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ code: null, stdout, stderr, timedOut });
        }
      }, 100).unref();
    }, timeoutMs);
    let pending = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (!onLine) return;
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) onLine(line);
    });
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ code: -1, stdout, stderr: stderr || error.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/** 실제 CLI를 부르는 기본 실행기. 시험은 가짜 실행 파일이나 가짜 실행기를 넣는다 (명세 §15). */
export const defaultHostRunner: HostRunner = async (req) => {
  const started = Date.now();
  const args = req.host === "claude-code" ? claudeArgs(req) : codexArgs(req);
  let lastActivity = "시작하는 중";
  const activities: string[] = [];
  let partial = "";
  const run = await runProcess(req.bin, args, req.cwd, req.timeoutMs, (line) => {
    const seen = readStreamLine(line);
    if (seen.activity) {
      lastActivity = seen.activity;
      activities.push(seen.activity);
      req.onActivity?.(seen.activity);
    }
    if (seen.text) partial = seen.text;
  });
  const ms = Date.now() - started;
  if (run.timedOut) {
    const writes = activities.filter((a) => a === "초안에 쓰는 중").length;
    const text =
      `${Math.round(req.timeoutMs / 1000)}초 안에 끝나지 않아 멈췄다. 마지막으로 하던 일: ${lastActivity}` +
      `${activities.length ? ` (이 턴에서 ${activities.length}번째 일${writes ? ` · 초안에 ${writes}번 썼다` : ""})` : " — 첫 응답도 오기 전이다(모델이 생각하거나 호스트가 늦게 떴다)"}.` +
      ` ${writes ? "그때까지 쓴 초안은 남아 있다. " : ""}「이어서」를 누르면 멈춘 곳부터 이어 간다. 자주 멈추면 모델 칸에 더 빠른 모델(sonnet · haiku)을 쓴다.`;
    return { ok: false, kind: "timeout", text, ms, ...(partial ? { partial } : {}) };
  }
  try {
    if (req.host === "claude-code") {
      const out = parseClaudeOutput(run.stdout);
      if (run.code !== 0 || out.isError) return { ok: false, kind: "error", text: explainHostFailure(out.text || run.stderr || `종료 코드 ${run.code}`, req.model), ms };
      return { ok: true, text: out.text, ...(out.sessionId ? { sessionId: out.sessionId } : {}), ms, ...(out.costUsd !== undefined ? { costUsd: out.costUsd } : {}) };
    }
    const out = parseCodexOutput(run.stdout);
    if (run.code !== 0 || out.isError) return { ok: false, kind: "error", text: explainHostFailure(out.error ?? (run.stderr || `종료 코드 ${run.code}`), req.model), ms };
    return { ok: true, text: out.text, ...(out.sessionId ? { sessionId: out.sessionId } : {}), ms };
  } catch (error) {
    return { ok: false, kind: "error", text: explainHostFailure(run.stderr || `호스트 출력을 읽지 못했다 — ${(error as Error).message}`, req.model), ms };
  }
};

export interface ConsultHostInfo {
  host: ConsultHost;
  label: string;
  bin: string | null;
  loggedIn: boolean | null;
  /** 실측했나. Codex는 C5 전까지 false. */
  verified: boolean;
  hint: string;
}

const HOST_LABEL: Record<ConsultHost, string> = { "claude-code": "Claude Code", codex: "Codex" };

export function resolveHostBin(host: ConsultHost): string | null {
  return host === "claude-code"
    ? resolveBin("claude", "PATCHBAY_CLAUDE_BIN", [path.join(os.homedir(), ".local/bin/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"])
    : resolveBin("codex", "PATCHBAY_CODEX_BIN", ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"]);
}

export async function detectConsultHosts(): Promise<ConsultHostInfo[]> {
  const out: ConsultHostInfo[] = [];
  for (const host of CONSULT_HOSTS) {
    const bin = resolveHostBin(host);
    let loggedIn: boolean | null = null;
    if (bin) {
      const args = host === "claude-code" ? ["auth", "status"] : ["login", "status"];
      const run = await runProcess(bin, args, os.homedir(), 10_000);
      if (host === "claude-code") {
        try {
          loggedIn = (JSON.parse(run.stdout) as { loggedIn?: boolean }).loggedIn === true;
        } catch {
          loggedIn = run.code === 0;
        }
      } else loggedIn = run.code === 0;
    }
    out.push({
      host,
      label: HOST_LABEL[host],
      bin,
      loggedIn,
      verified: host === "claude-code",
      hint: !bin
        ? host === "claude-code"
          ? "설치: npm i -g @anthropic-ai/claude-code"
          : "설치: npm i -g @openai/codex"
        : loggedIn === false
          ? host === "claude-code"
            ? "로그인: claude 를 한 번 켜서 /login"
            : "로그인: codex login"
          : host === "codex"
            ? "Codex 길은 아직 실측 전이다 (명세 §13.3)"
            : "",
    });
  }
  return out;
}

/** Patchbay MCP를 호스트가 띄우는 법. 콘솔과 같은 작업 공간(`PATCHBAY_HOME`)을 보게 한다. */
export function patchbayMcpServer(studioHome: string, consultId?: string): { command: string; args: string[]; env: Record<string, string> } {
  const entry = process.env.PATCHBAY_MCP_ENTRY ?? path.resolve(__dirname, "..", "..", "..", "packages", "mcp", "dist", "index.js");
  // 상담 id를 넘겨 `consult_update` 가 출처에 어느 대화였는지 남기게 한다 — 대화를 보관한 뒤에도 찾아갈 수 있게.
  return { command: process.execPath, args: [entry], env: { PATCHBAY_HOME: studioHome, ...(consultId ? { PATCHBAY_CONSULT_ID: consultId } : {}) } };
}

async function writeMcpConfig(studioHome: string, alias: string, consultId: string): Promise<{ file: string; server: ReturnType<typeof patchbayMcpServer> }> {
  const server = patchbayMcpServer(studioHome, consultId);
  const file = path.join(os.tmpdir(), `patchbay-consult-mcp-${`${alias}-${consultId}`.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
  await fs.writeFile(file, JSON.stringify({ mcpServers: { patchbay: server } }), "utf8");
  return { file, server };
}

const running = new Set<string>();

/** 도는 턴의 지금 — 화면이 「n초째 · ~하는 중 · 마지막 신호 n초 전」을 그린다. 메모리에만 있다. */
export interface ConsultRunInfo {
  startedAt: string;
  activity: string;
  lastSignalAt: string;
  steps: number;
}
const runInfo = new Map<string, ConsultRunInfo>();
export function consultRunInfo(alias: string, consultId: string): ConsultRunInfo | null {
  return runInfo.get(`${alias}/${consultId}`) ?? null;
}

export interface SendConsultInput {
  alias: string;
  consultId?: string;
  text: string;
  host: ConsultHost;
  model: string;
  prdSection?: number;
  /** 「+」로 붙인 참고 자료 id (`refs/`). */
  attachments?: string[];
}

export type SendConsultResult =
  | { ok: true; consultId: string; done: Promise<void> }
  | { ok: false; status: 400 | 404 | 409 | 503; error: string };

export function newConsultId(now: Date = new Date()): string {
  return `${now.toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
}

/**
 * 한 턴 (§13.5): 사람의 말을 붙이고, 호스트를 부르고, 답(또는 실패)을 붙인다. 호스트는 오래 걸리니
 * 말을 붙인 즉시 돌려주고 나머지는 `done` 으로 — 화면은 `consult` 이벤트로 결과를 받는다.
 */
export async function sendConsultTurn(
  studioHome: string,
  input: SendConsultInput,
  deps: { runner?: HostRunner; bin?: string | null; timeoutMs?: number; now?: () => Date } = {},
): Promise<SendConsultResult> {
  const text = input.text.trim();
  if (!text) return { ok: false, status: 400, error: "보낼 말이 비어 있다." };
  if (!(CONSULT_HOSTS as readonly string[]).includes(input.host)) return { ok: false, status: 400, error: `호스트는 ${CONSULT_HOSTS.join(" · ")} 중 하나다.` };
  const studio = await readStudio(studioHome);
  const project = studio.projects.find((p) => p.alias === input.alias);
  if (!project) return { ok: false, status: 404, error: `"${input.alias}" 는 등록된 프로젝트가 아니다.` };
  const bin = deps.bin !== undefined ? deps.bin : resolveHostBin(input.host);
  if (!bin) return { ok: false, status: 503, error: `${HOST_LABEL[input.host]} 실행 파일을 찾지 못했다.` };

  const consultId = input.consultId ?? newConsultId(deps.now?.());
  const key = `${input.alias}/${consultId}`;
  if (running.has(key)) return { ok: false, status: 409, error: "이 상담은 답을 기다리는 중이다 — 답이 오면 이어서 말한다." };

  const now = () => deps.now?.() ?? new Date();
  let read: { messages: ConsultMessage[]; archived?: boolean } | null;
  try {
    read = await readConsult(studioHome, input.alias, consultId);
  } catch (error) {
    return { ok: false, status: 400, error: (error as Error).message };
  }
  if (input.consultId && !read) return { ok: false, status: 404, error: `상담 ${consultId} 가 없다.` };
  if (read?.archived) return { ok: false, status: 409, error: "끝낸 대화다 — 보관에서 읽기만 한다. 새 상담에서 이어 간다." };
  const messages = read?.messages ?? [];

  running.add(key);
  let meta = currentConsultMeta(messages);
  let switched = false;
  if (!meta || meta.host !== input.host || meta.model !== input.model) {
    switched = Boolean(meta);
    if (meta) {
      await appendConsultMessage(studioHome, input.alias, consultId, {
        role: "system",
        kind: "host-switch",
        text: `${meta.host} · ${meta.model || "기본 모델"} → ${input.host} · ${input.model || "기본 모델"}`,
      }, now());
    }
    const appended = await appendConsultMessage(studioHome, input.alias, consultId, {
      role: "meta",
      host: input.host,
      model: input.model,
      ...(input.host === "claude-code" ? { hostSessionId: randomUUID() } : {}),
    }, now());
    meta = appended.role === "meta" ? appended : null;
  }
  const refs = input.attachments?.length ? await listRefs(studioHome, input.alias) : [];
  const attached = (input.attachments ?? []).map((id) => refs.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const user = await appendConsultMessage(studioHome, input.alias, consultId, {
    role: "user",
    text,
    ...(input.prdSection ? { prdSection: input.prdSection } : {}),
    ...(attached.length ? { attachments: attached.map((r) => ({ id: r.id, title: r.title, kind: r.kind, uri: r.uri })) } : {}),
  }, now());
  // 붙인 자료는 사람이 준 근거다 — 초안의 참고 자료(0.0 references)에 바로 넣는다. 호스트에게 맡기지 않는다.
  if (attached.length) {
    const current = await readProposedIr(studioHome, input.alias);
    const have = current.ok && Array.isArray((current.raw as { references?: unknown })?.references)
      ? ((current.raw as { references: { id?: string }[] }).references)
      : [];
    const merged = [...have, ...attached.filter((r) => !have.some((h) => h.id === r.id))];
    await applyConsultPatch(studioHome, input.alias, {
      patch: { references: merged },
      provenance: attached.map((r) => ({ path: `references[${merged.findIndex((m) => m.id === r.id)}]`, source: "said" as const })),
      turn: user.seq,
    });
  }

  runInfo.set(key, { startedAt: now().toISOString(), activity: "호스트를 띄우는 중", lastSignalAt: now().toISOString(), steps: 0 });
  const done = (async () => {
    try {
      const after = (await readConsult(studioHome, input.alias, consultId))?.messages ?? [];
      const metaIndex = after.findIndex((m) => m.seq === meta!.seq);
      // 앞 턴이 답했거나 시간 초과로 끊겼으면 호스트 쪽 세션이 이미 있다 — 같은 id로 새로 열면 「이미 쓰는 세션」으로 거절된다.
      const resume =
        Boolean(meta!.hostSessionId) &&
        after.slice(metaIndex).some((m) => m.seq < user.seq && (m.role === "host" || (m.role === "system" && m.kind === "timeout")));
      const draft = await readProposedIr(studioHome, input.alias);
      const archived = await listArchivedConsults(studioHome, input.alias);
      const brief = buildConsultBrief({ alias: input.alias, draft: draft.ok ? draft.raw : {}, consultId, archived });
      const prefix = switched && !resume ? consultTranscript(after.filter((m) => m.seq < user.seq)) : "";
      const prdNote = input.prdSection ? `[PRD ${input.prdSection}절을 고쳐 달라는 말이다. 그 절의 칸만 고친다.]\n` : "";
      const turnNote = `[이 말의 상담 기록 번호(turn): ${user.seq}]\n`;
      const dir = refsDir(studioHome, input.alias);
      const attachNote = attached.length
        ? `[사람이 붙인 자료 — 초안의 references 에 이미 넣었다. 열어 보고 내용을 반영한다]\n${attached
            .map((r) => (r.kind === "link" ? `- ${r.id} 링크: ${r.uri}` : `- ${r.id} ${r.kind === "image" ? "이미지" : "파일"} 「${r.title}」: ${path.join(dir, path.basename(r.uri))}`))
            .join("\n")}\n`
        : "";
      const { file, server } = await writeMcpConfig(studioHome, input.alias, consultId);
      const result = await (deps.runner ?? defaultHostRunner)({
        host: input.host,
        bin,
        model: input.model,
        ...(meta!.hostSessionId ? { sessionId: meta!.hostSessionId } : {}),
        resume,
        brief,
        prompt: `${prefix}${prdNote}${turnNote}${attachNote}${text}`,
        addDirs: [dir],
        onActivity: (activity) => {
          const info = runInfo.get(key);
          if (info) runInfo.set(key, { ...info, activity, lastSignalAt: now().toISOString(), steps: info.steps + 1 });
        },
        mcpConfigPath: file,
        mcpServer: server,
        cwd: project.path,
        timeoutMs: deps.timeoutMs ?? CONSULT_TURN_TIMEOUT_MS,
      });
      if (result.ok) {
        // Codex는 세션 id를 첫 턴이 끝나야 안다 — 그때 meta를 한 줄 더 붙여 이어 갈 수 있게 한다.
        if (!meta!.hostSessionId && result.sessionId) {
          await appendConsultMessage(studioHome, input.alias, consultId, { role: "meta", host: input.host, model: input.model, hostSessionId: result.sessionId }, now());
        }
        await appendConsultMessage(studioHome, input.alias, consultId, {
          role: "host",
          text: result.text,
          model: input.model || input.host,
          ms: result.ms,
          ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
        }, now());
      } else {
        // 멈추기 전까지 쓴 답이 있으면 버리지 않는다 — 사람이 거기서부터 이어 갈 수 있게.
        if (!result.ok && result.partial) {
          await appendConsultMessage(studioHome, input.alias, consultId, {
            role: "host",
            text: `${result.partial}\n\n(멈추기 전까지 쓴 답)`,
            model: input.model || input.host,
            ms: result.ms,
          }, now());
        }
        await appendConsultMessage(studioHome, input.alias, consultId, { role: "system", kind: result.kind, text: result.text }, now());
      }
    } catch (error) {
      await appendConsultMessage(studioHome, input.alias, consultId, { role: "system", kind: "error", text: (error as Error).message }, now()).catch(() => undefined);
    } finally {
      running.delete(key);
      runInfo.delete(key);
    }
  })();
  return { ok: true, consultId, done };
}

/**
 * 대화를 끝낸다 — 보관으로 옮기고 색인에 그 대화가 고친 칸을 남긴다. 다음 말은 새 상담(새 호스트 세션)으로 간다.
 * 답을 기다리는 중이면 끝내지 않는다 — 답이 보관 뒤에 붙을 곳이 없다.
 */
export async function closeConsultConversation(
  studioHome: string,
  alias: string,
  consultId: string,
  now?: Date,
): Promise<{ ok: true; entry: Awaited<ReturnType<typeof listArchivedConsults>>[number] } | { ok: false; status: 404 | 409; error: string }> {
  if (running.has(`${alias}/${consultId}`)) return { ok: false, status: 409, error: "답을 기다리는 중이다 — 답이 온 뒤에 끝낸다." };
  const touched = pathsTouchedBy(await readProvenance(studioHome, alias), consultId);
  const closed = await closeConsult(studioHome, alias, consultId, { touched, ...(now ? { now } : {}) });
  if (!closed.ok) return { ok: false, status: closed.error.includes("없다") ? 404 : 409, error: closed.error };
  return closed;
}

export function isConsultRunning(alias: string, consultId: string): boolean {
  return running.has(`${alias}/${consultId}`);
}

/** 지금 상담에서 LLM이 답하는 중인 프로젝트. */
export function runningConsultAliases(): string[] {
  return [...running].map((key) => key.slice(0, key.lastIndexOf("/")));
}

export { consultStatus };

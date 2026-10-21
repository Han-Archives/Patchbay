import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { newRoomId, readRoom, readRoomMeta, readStudio, writeRoomMeta } from "@patchbay/core";
import { jsonResult } from "./result.js";

/**
 * 폰·터미널의 Claude Code 세션이 Patchbay 프로젝트를 맡을 때 쓰는 두 도구 (사용자 요청 2026-10-11).
 *
 * - `room_bind` — 이 세션의 대화를 어느 대화방에 옮겨 적을지 고른다. 옮겨 적기는 훅
 *   (`patchbay room mirror`)이 세션 기록에서 이 도구의 결과를 찾아서 한다. 모델이 직접 적지 않는다.
 * - `llm_status` — 이 맥에서 부를 수 있는 LLM CLI: 설치 · 로그인 · (원하면) 실제 한 마디 호출.
 *   로그인은 사용 한도를 모르므로, 한도까지 보려면 `probe` 로 실제 호출한다.
 */

export const SESSION_INSTRUCTIONS = `Patchbay 세션 규칙 — 사용자가 (폰의 Claude 앱 Remote Control 이든 터미널이든) Patchbay에 등록된 프로젝트의 일을 맡기면:
1. 확인: list_projects 로 그 프로젝트가 등록돼 있는지 본다. 없거나 애매하면 등록된 이름을 보여 주고 묻는다. 추측해서 고르지 않는다.
2. LLM: llm_status 로 이번 일에 쓸 LLM을 확인한다. 쓸 공급자만 probe 로 실제 호출한다 (한도·로그인 문제는 호출해야 보인다).
3. 기록 연결: room_bind 로 이 세션을 그 프로젝트의 대화방에 묶는다. 이어서 하는 일이면 get_room 으로 방을 찾아 roomId 를 넘긴다. 묶은 뒤 대화는 훅이 Patchbay 대화창에 그대로 옮긴다 — 직접 옮겨 적지 않는다. 묶인 뒤에는 그 프로젝트 폴더 밖에 쓰는 도구를 훅(room guard)이 막는다 — 다른 프로젝트의 일이면 사용자에게 묻고 허락받은 뒤 그 프로젝트로 다시 묶는다.
4. ready: 프로젝트 · 경로 · 대화방 · LLM 상태를 서너 줄로 알리고, 사용자의 요구대로 진행한다.
5. 검토사항: 사용자의 판단이 필요하면 (무슨 일이 생겼나 · 선택지 · 추천) 세 줄 안으로 쓰고 거기서 멈춰 답을 기다린다. 멈추기 직전에 PushNotification 도구가 있으면 행동할 내용을 앞에 둔 한 줄로 알린다. 판단이 필요 없는 일은 멈추지 않는다. 할일 준비본의 승인 · 보류 · 수정 요청은 list_preparations 로 계획과 완료 조건을 보인 뒤, 사람이 말한 결정만 decide_preparation 으로 넘긴다.
6. 끝: 결과를 짧게 알리고, 사용자가 자리를 비웠을 수 있으면 PushNotification 으로 알린다. Patchbay 반영은 progress_write (asked · did) 로 한다.`;

const LLM_HOSTS = ["claude-code", "codex", "grok", "local"] as const;
type LlmHost = (typeof LLM_HOSTS)[number];

const BIN: Record<LlmHost, { name: string; env: string; fallbacks: string[] }> = {
  "claude-code": { name: "claude", env: "PATCHBAY_CLAUDE_BIN", fallbacks: [path.join(os.homedir(), ".local/bin/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"] },
  codex: { name: "codex", env: "PATCHBAY_CODEX_BIN", fallbacks: ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"] },
  grok: { name: "grok", env: "PATCHBAY_GROK_BIN", fallbacks: [] },
  local: { name: "lms", env: "PATCHBAY_LMS_BIN", fallbacks: [path.join(os.homedir(), ".lmstudio", "bin", "lms")] },
};

function executable(file: string): boolean {
  try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; }
}

export function findLlmBin(host: LlmHost): string | null {
  const spec = BIN[host];
  const fromEnv = process.env[spec.env]?.trim();
  if (fromEnv && executable(fromEnv)) return fromEnv;
  for (const candidate of spec.fallbacks) if (executable(candidate)) return candidate;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir && executable(path.join(dir, spec.name))) return path.join(dir, spec.name);
  }
  return null;
}

export interface RunResult { code: number | null; stdout: string; stderr: string; timedOut: boolean }
export type LlmRun = (bin: string, args: string[], cwd: string, timeoutMs: number) => Promise<RunResult>;

const run: LlmRun = (bin, args, cwd, timeoutMs) => new Promise((resolve) => {
  const child = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let stdout = ""; let stderr = ""; let timedOut = false; let settled = false;
  const finish = (code: number | null) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); };
  const timer = setTimeout(() => {
    timedOut = true;
    try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    finish(null);
  }, timeoutMs);
  child.stdout.on("data", (b) => (stdout += b));
  child.stderr.on("data", (b) => (stderr += b));
  child.on("error", (e) => { stderr ||= e.message; finish(-1); });
  child.on("close", finish);
});

const PROBE_PROMPT = "Reply with exactly: OK";

function probeArgs(host: LlmHost, model: string): string[] {
  if (host === "claude-code") return ["-p", PROBE_PROMPT, "--output-format", "json", "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', ...(model ? ["--model", model] : [])];
  if (host === "codex") return ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", ...(model ? ["-m", model] : []), PROBE_PROMPT];
  if (host === "grok") return ["--no-auto-update", "-p", PROBE_PROMPT, "--output-format", "json", ...(model ? ["-m", model] : [])];
  return ["chat", "-p", PROBE_PROMPT, model];
}

function tail(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(-300);
}

export async function llmStatus(options: { probe?: LlmHost[]; models?: Partial<Record<LlmHost, string>>; runner?: LlmRun; bins?: Partial<Record<LlmHost, string | null>> } = {}) {
  const runner = options.runner ?? run;
  const rows = [];
  for (const host of LLM_HOSTS) {
    const bin = options.bins && host in options.bins ? options.bins[host] ?? null : findLlmBin(host);
    let loggedIn: boolean | null = null;
    if (bin && (host === "claude-code" || host === "codex")) {
      const status = await runner(bin, host === "claude-code" ? ["auth", "status"] : ["login", "status"], os.homedir(), 10_000);
      if (host === "claude-code") {
        try { loggedIn = (JSON.parse(status.stdout) as { loggedIn?: boolean }).loggedIn === true; } catch { loggedIn = status.code === 0; }
      } else loggedIn = status.code === 0;
    }
    let probe: { ok: boolean; ms: number; detail: string } | null = null;
    if (bin && options.probe?.includes(host)) {
      const model = options.models?.[host]?.trim() ?? "";
      if (host === "local" && !model) probe = { ok: false, ms: 0, detail: "로컬 모델은 LM Studio 모델 id를 models.local 로 넘긴다." };
      else {
        const started = Date.now();
        const answer = await runner(bin, probeArgs(host, model), os.tmpdir(), 90_000);
        const ms = Date.now() - started;
        const said = `${answer.stdout}\n${answer.stderr}`;
        const failed = answer.timedOut || answer.code !== 0 || /"is_error"\s*:\s*true/.test(answer.stdout);
        probe = { ok: !failed && /OK/.test(answer.stdout), ms, detail: answer.timedOut ? "90초 안에 답하지 않았다." : tail(said) };
      }
    }
    rows.push({ host, bin, installed: !!bin, loggedIn, probe,
      hint: !bin ? `${BIN[host].name} 실행 파일이 없다.` : loggedIn === false ? (host === "claude-code" ? "claude 를 켜서 /login" : "codex login") : "" });
  }
  return rows;
}

export async function consoleUp(): Promise<{ url: string } | null> {
  const ports = [...new Set([process.env.PATCHBAY_FLOW_PORT, "4318", "4317"].filter((p): p is string => !!p))];
  for (const port of ports) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/session`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return { url: `http://127.0.0.1:${port}` };
    } catch {
      // 다음 포트.
    }
  }
  return null;
}

export function registerSessionTools(server: McpServer, studioHome: string, deps: { runner?: LlmRun } = {}) {
  server.registerTool("room_bind", {
    title: "Bind this session to a Patchbay room",
    description: "Picks the Patchbay conversation room that this Claude Code session's dialogue is mirrored into (the mirror hook copies the human prompts and Claude's replies; you do not write them yourself). Pass roomId to continue an existing room, or omit it to open a new one. Call after confirming the project with list_projects.",
    inputSchema: { alias: z.string(), roomId: z.string().optional(), title: z.string().max(80).optional() },
  }, async ({ alias, roomId, title }) => {
    try {
      if (!(await readStudio(studioHome)).projects.some((p) => p.alias === alias)) return { ...jsonResult({ error: "등록된 프로젝트가 아니다. list_projects 로 이름을 확인한다." }), isError: true };
      const id = roomId ?? newRoomId();
      if (roomId && !(await readRoom(studioHome, alias, roomId))) return { ...jsonResult({ error: `대화방 ${roomId} 가 없다.` }), isError: true };
      const meta = await readRoomMeta(studioHome, alias, id);
      if (meta.kept) return { ...jsonResult({ error: "읽기 전용 방이다. 다른 방을 고르거나 새 방을 연다." }), isError: true };
      if (!roomId || title !== undefined) await writeRoomMeta(studioHome, alias, id, { ...meta, ...(title !== undefined ? { title } : {}) });
      const view = await consoleUp();
      return jsonResult({ bound: true, alias, roomId: id, title: title ?? meta.title,
        console: view ? `${view.url}/#room/${encodeURIComponent(alias)}/${encodeURIComponent(id)}` : null,
        note: "이 세션의 대화는 이제 훅이 이 방에 옮겨 적는다. 직접 적지 않는다." + (view ? "" : " 콘솔(patchbay flow)이 꺼져 있어도 기록은 남는다.") });
    } catch (error) { return { ...jsonResult({ error: (error as Error).message }), isError: true }; }
  });

  server.registerTool("llm_status", {
    title: "Check LLM CLIs on this machine",
    description: "Reports which LLM CLIs (Claude Code, Codex, Grok, LM Studio) are installed and logged in on this Mac, and whether the Patchbay console is up. Logged-in does not reveal usage limits: pass probe with the hosts you will actually use to make one tiny real call each (costs a few tokens, up to 90s).",
    inputSchema: {
      probe: z.array(z.enum(LLM_HOSTS)).optional(),
      models: z.object({ "claude-code": z.string(), codex: z.string(), grok: z.string(), local: z.string() }).partial().optional(),
    },
    annotations: { readOnlyHint: true },
  }, async ({ probe, models }) => {
    const hosts = await llmStatus({ ...(probe ? { probe } : {}), ...(models ? { models } : {}), ...(deps.runner ? { runner: deps.runner } : {}) });
    return jsonResult({ hosts, console: await consoleUp() });
  });
}

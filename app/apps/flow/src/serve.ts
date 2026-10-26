#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { migrateLegacyRoomDirs, requireStudioHome, seedBundledSkills } from "@patchbay/core";
import open from "open";
import { resolveLangGraphUrl } from "./langgraphContract.js";
import { resolveNeo4jPassword, resolveNeo4jUri, resolveNeo4jUser } from "./neo4jContract.js";
import { createFlowApp, type ServerRestart } from "./server.js";
import { createClaudeQuotaRefresh } from "./claudeQuotaHost.js";
import { dialHost, isLoopbackHost, resolveFlowHost } from "./serveContract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_SKILLS = path.resolve(__dirname, "../../../packages/skills");
const APP_ROOT = path.resolve(__dirname, "../../..");
const FLOW_ROOT = path.resolve(__dirname, "..");

/**
 * Real entrypoint (spec Phase 10): a short-lived local server, never a
 * daemon -- `patchbay flow` running this file IS the manual start action.
 * The UI is the four-tab console (spec P1). Reads `PATCHBAY_FLOW_PROJECT`,
 * `PATCHBAY_FLOW_PORT` and `PATCHBAY_FLOW_HOST` from the environment because
 * the CLI spawns this as a plain `node` child process (no argv parsing here to
 * duplicate commander's). Watch/SSE live only while this process is up (spec P3).
 */
const port = Number(process.env.PATCHBAY_FLOW_PORT ?? 4317);
const host = resolveFlowHost(process.env.PATCHBAY_FLOW_HOST);
const access = { token: process.env.PATCHBAY_FLOW_TOKEN, readToken: process.env.PATCHBAY_FLOW_READ_TOKEN };
if (!isLoopbackHost(host) && !access.token && !access.readToken) {
  throw new Error("원격 접속에는 PATCHBAY_FLOW_TOKEN 또는 조회 전용 PATCHBAY_FLOW_READ_TOKEN을 설정한다.");
}
const studioHome = requireStudioHome();
// 대화방 폴더 rooms/ → chats/ (사용자 요청 2026-10-16). 서버가 아직 듣기 전이라 이 프로세스가 옛 폴더에 쓰는 일이 없다.
const movedChats = migrateLegacyRoomDirs(studioHome);
if (movedChats.length > 0) console.log(`대화방 폴더를 rooms/ → chats/ 로 옮겼다: ${movedChats.join(", ")}`);
void seedBundledSkills(studioHome, BUNDLED_SKILLS).catch(() => undefined);

/** 화면의 「서버 다시 켜기」 (사용자 결정 2026-10-26, A안). 새 서버는 같은 명령 · 환경으로 띄우고, 포트가 빌 때까지 기다린다. */
const npm = (cwd: string) => new Promise<{ ok: boolean; output: string }>(resolve => {
  const env = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}` };
  execFile("npm", ["run", "build"], { cwd, env, timeout: 600_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) =>
    resolve({ ok: !error, output: `${stdout}${stderr}${error && !stderr ? error.message : ""}` }));
});
const serverRestart: ServerRestart = {
  async build() {
    const core = await npm(APP_ROOT);
    if (!core.ok) return core;
    const flow = await npm(FLOW_ROOT);
    return { ok: flow.ok, output: `${core.output}${flow.output}` };
  },
  restart() {
    const args = [...process.execArgv, ...process.argv.slice(1).filter(arg => arg !== "--no-open"), "--no-open"];
    spawn(process.execPath, args, { cwd: process.cwd(), env: { ...process.env, PATCHBAY_FLOW_RESTARTED: "1" }, detached: true, stdio: "inherit" }).unref();
    console.log("다시 켜는 중 — 새 서버에 넘긴다.");
    shutdown();
  },
};

const app = createFlowApp({
  studioHome,
  claudeQuotaRefresh: createClaudeQuotaRefresh(studioHome),
  project: process.env.PATCHBAY_FLOW_PROJECT || undefined,
  watch: true,
  access,
  serverRestart,
  roomNotifications: {
    discordWebhook: process.env.PATCHBAY_DISCORD_WEBHOOK,
    telegramToken: process.env.PATCHBAY_TELEGRAM_TOKEN,
    telegramChatId: process.env.PATCHBAY_TELEGRAM_CHAT_ID,
    publicUrl: process.env.PATCHBAY_PUBLIC_URL,
  },
  langgraph: { url: resolveLangGraphUrl(process.env.PATCHBAY_LANGGRAPH_URL) },
  neo4j: {
    uri: resolveNeo4jUri(process.env.PATCHBAY_NEO4J_URI),
    user: resolveNeo4jUser(process.env.PATCHBAY_NEO4J_USER),
    password: resolveNeo4jPassword(process.env.PATCHBAY_NEO4J_PASSWORD),
  },
});

const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  const url = `http://${dialHost(host)}:${info.port}`;
  console.log(`Patchbay console at ${url}`);
  if (!isLoopbackHost(host)) {
    console.log(`Listening on ${host} -- 연결 토큰으로 로그인한다. 조회 전용 토큰은 실행을 허용하지 않는다.`);
  }
  console.log("Ctrl+C to stop.");
  if (!process.argv.includes("--no-open")) {
    open(url).catch(() => {
      // No default browser available (headless/CI) -- the printed URL above is still usable.
    });
  }
});

// 다시 켜기로 뜬 서버는 앞 서버가 포트를 비울 때까지 기다린다(최대 15초). 그 밖의 오류는 그대로 멈춘다.
let portRetries = 0;
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code !== "EADDRINUSE" || !process.env.PATCHBAY_FLOW_RESTARTED || portRetries++ >= 60) throw error;
  setTimeout(() => server.listen(port, host), 250);
});

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  void app
    .close()
    .catch(() => undefined)
    .finally(() => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 2000).unref();
    });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

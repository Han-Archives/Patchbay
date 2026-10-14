#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { requireStudioHome, seedBundledSkills } from "@patchbay/core";
import open from "open";
import { resolveLangGraphUrl } from "./langgraphContract.js";
import { resolveNeo4jPassword, resolveNeo4jUri, resolveNeo4jUser } from "./neo4jContract.js";
import { createFlowApp } from "./server.js";
import { dialHost, isLoopbackHost, resolveFlowHost } from "./serveContract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_SKILLS = path.resolve(__dirname, "../../../packages/skills");

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
void seedBundledSkills(studioHome, BUNDLED_SKILLS).catch(() => undefined);
const app = createFlowApp({
  studioHome,
  project: process.env.PATCHBAY_FLOW_PROJECT || undefined,
  watch: true,
  access,
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
  open(url).catch(() => {
    // No default browser available (headless/CI) -- the printed URL above is still usable.
  });
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

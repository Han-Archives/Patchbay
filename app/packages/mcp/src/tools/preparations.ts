import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsonResult } from "./result.js";
import { consoleUp } from "./session.js";

/** 콘솔에 보내는 요청. 테스트는 가짜를 넣는다. 콘솔이 꺼져 있으면 null. */
export type ConsoleFetch = (pathAndQuery: string, init?: RequestInit) => Promise<Response | null>;

const defaultConsoleFetch: ConsoleFetch = async (pathAndQuery, init) => {
  const up = await consoleUp();
  return up ? fetch(`${up.url}${pathAndQuery}`, init) : null;
};

const OFF = "Patchbay 콘솔이 꺼져 있다 — 준비본 승인은 콘솔이 검사하고 실행한다. PC에서 콘솔을 켠 뒤 다시 부른다.";

/**
 * 폰(Remote Control)에서 할일 준비본을 승인 · 보류 · 수정 요청한다 (R7.9, 사용자 결정 2026-10-21).
 * 판단과 실행은 콘솔이 한다 — 이 도구는 콘솔의 준비 API를 그대로 부른다. 입력이 바뀌었으면 승인 거부 같은
 * 검사가 PC 화면과 똑같이 걸린다.
 */
export function registerPreparationTools(server: McpServer, deps: { consoleFetch?: ConsoleFetch } = {}) {
  const call = deps.consoleFetch ?? defaultConsoleFetch;

  server.registerTool("list_preparations", {
    title: "List task preparations waiting for a decision",
    description: "Lists the project's prepared tasks (plan, completion checks, status) so the person can approve, hold, or ask for changes from the phone. Show the person the plan and completion checks before asking. Read-only.",
    inputSchema: { alias: z.string() },
    annotations: { readOnlyHint: true },
  }, async ({ alias }) => {
    const res = await call(`/api/todo-preparations?alias=${encodeURIComponent(alias)}&summary=1`);
    if (!res) return { ...jsonResult({ error: OFF }), isError: true };
    const body = await res.json() as { items?: { id: string; todoId: string; title: string; status: string; plan: string[]; completion: string[]; reason?: string; error?: string; revisionNote?: string }[]; error?: string };
    if (!res.ok || !body.items) return { ...jsonResult({ error: body.error ?? `콘솔 응답 ${res.status}` }), isError: true };
    return jsonResult({ items: body.items.map(({ id, todoId, title, status, plan, completion, reason, error, revisionNote }) => ({ id, todoId, title, status, plan, completion, ...(reason ? { reason } : {}), ...(error ? { error } : {}), ...(revisionNote ? { revisionNote } : {}) })) });
  });

  server.registerTool("decide_preparation", {
    title: "Approve, hold, or revise a task preparation",
    description: "Records the person's decision on one prepared task: approve (starts the approved run), hold (pauses it and stops only related later tasks), or revise (asks for a new version; note is required). Call only with the decision the person stated — never decide for them.",
    inputSchema: {
      alias: z.string(),
      id: z.string().describe("Preparation id from list_preparations."),
      decision: z.enum(["approve", "hold", "revise"]),
      note: z.string().max(4000).optional().describe("What to change. Required for revise."),
    },
  }, async ({ alias, id, decision, note }) => {
    if (decision === "revise" && !note?.trim()) return { ...jsonResult({ error: "수정 요청은 무엇을 고칠지 note가 필요하다." }), isError: true };
    const res = await call("/api/todo-preparations/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias, id, action: decision, ...(note ? { note } : {}) }) });
    if (!res) return { ...jsonResult({ error: OFF }), isError: true };
    const body = await res.json() as { ok?: boolean; error?: string };
    if (!res.ok || !body.ok) return { ...jsonResult({ error: body.error ?? `콘솔 응답 ${res.status}` }), isError: true };
    return jsonResult({ ok: true, id, decision });
  });
}

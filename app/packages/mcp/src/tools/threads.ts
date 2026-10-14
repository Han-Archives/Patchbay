import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  answerRequest,
  listPendingRequests,
  listThreads,
  readStudio,
  readThread,
  threadStatus,
} from "@patchbay/core";
import { z } from "zod";
import { jsonResult } from "./result.js";

/**
 * 대화 도구 셋 — IDE의 호스트 모델이 Patchbay 대화의 멈춘 노드에 답하는 길
 * (사용자 결정 2026-10-05: 대화는 LangGraph thread_id 로 관리).
 *
 * 그래프 노드가 `interrupt()`로 멈추면 콘솔이 그 요청을 `threads/<thread_id>.jsonl` 에 남긴다.
 * 호스트는 `list_pending_requests` 로 읽고 `answer_request` 로 답을 붙인다. 이 도구는 **파일만**
 * 쓴다 — 그래프를 다시 돌리는 일은 떠 있는 콘솔이 파일 변화를 보고 같은 thread_id로 한다.
 * Patchbay는 모델을 부르지 않는다: 답을 쓰는 것은 이 도구를 부른 호스트 자신이다.
 */
export function registerThreadTools(server: McpServer, studioHome: string): void {
  server.registerTool(
    "list_pending_requests",
    {
      title: "List pending requests",
      description:
        "Lists Patchbay conversations whose LangGraph node stopped on interrupt() and is waiting for the host model's " +
        "answer: the project, thread id, request number (seq), node, the request payload, the person's last message " +
        "and the deadline. Read these, then answer each with `answer_request`. Read-only.",
      inputSchema: {
        alias: z.string().optional().describe("Registered project alias. Omitted -> every registered project."),
      },
    },
    async ({ alias }) => {
      const aliases = alias ? [alias] : (await readStudio(studioHome)).projects.map((p) => p.alias);
      const pending = (await Promise.all(aliases.map((a) => listPendingRequests(studioHome, a)))).flat();
      return jsonResult({ pending, count: pending.length });
    },
  );

  server.registerTool(
    "answer_request",
    {
      title: "Answer a pending request",
      description:
        "Attaches your answer to a stopped node in a Patchbay conversation. Write the answer yourself — Patchbay " +
        "does not call a model. Set `refused` when you decline (the graph takes its error branch). Name the model " +
        "you are (e.g. `claude-code · opus`) so the run record says who answered. A running `patchbay flow` " +
        "resumes the same LangGraph thread when this file changes; nothing else is needed.",
      inputSchema: {
        alias: z.string().describe("Registered project alias."),
        threadId: z.string().describe("The conversation's LangGraph thread_id, from list_pending_requests."),
        seq: z.number().int().nonnegative().optional().describe("The request number, from list_pending_requests."),
        text: z.string().describe("The answer. When refusing, the reason."),
        refused: z.boolean().optional().describe("True when you decline to answer."),
        model: z.string().optional().describe("Which host model is answering."),
      },
    },
    async ({ alias, threadId, seq, text, refused, model }) => {
      const result = await answerRequest(studioHome, alias, threadId, {
        ...(seq !== undefined ? { seq } : {}),
        text,
        ...(refused ? { refused } : {}),
        ...(model ? { model } : {}),
      });
      if (!result.ok) return { ...jsonResult({ ok: false, error: result.error }), isError: true };
      return jsonResult({
        ok: true,
        message: result.message,
        next: "patchbay flow 가 떠 있으면 같은 thread_id로 그래프를 재개한다. 결과는 콘솔 대화 칸에 나온다.",
      });
    },
  );

  server.registerTool(
    "get_thread",
    {
      title: "Get conversation",
      description:
        "Returns one Patchbay conversation (every message: the person, the graph, host answers, timeouts, " +
        "feedback) and its status, or — without threadId — the project's conversations, newest first. Read-only.",
      inputSchema: {
        alias: z.string().describe("Registered project alias."),
        threadId: z.string().optional().describe("Omitted -> list the project's conversations."),
      },
    },
    async ({ alias, threadId }) => {
      if (!threadId) return jsonResult({ threads: await listThreads(studioHome, alias) });
      const read = await readThread(studioHome, alias, threadId);
      if (!read) return { ...jsonResult({ ok: false, error: `대화 ${threadId} 가 없다.` }), isError: true };
      return jsonResult({ ...read, status: threadStatus(read.messages) });
    },
  );
}

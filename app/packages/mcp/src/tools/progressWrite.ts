import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { recordProgressWrite } from "@patchbay/core";
import { z } from "zod";
import { jsonResult } from "./result.js";

const inputShape = {
  alias: z.string().describe("Registered project alias. Required."),
  summary: z.string().min(1).describe("What is currently being worked on. Becomes progress.yaml current."),
  skill: z.string().optional().describe("Optional skill port or slug."),
  step: z.string().optional().describe("Optional named step within that skill."),
  asked: z
    .string()
    .optional()
    .describe("What the person asked for, in their own words. You hold the conversation -- write it here."),
  did: z.string().optional().describe("What was actually built or changed for that request."),
};

/**
 * `progress_write` (spec 5 / P4): same Core path as CLI `progress write`.
 * Writes files only. A running `patchbay flow` picks this up via SSE.
 *
 * `asked`/`did` are the request-and-outcome pair. They come from the calling
 * model, which already has the conversation -- Patchbay never collects a
 * transcript and its kernel never calls a model (기획 §4).
 */
export function registerProgressWriteTool(server: McpServer, studioHome: string): void {
  server.registerTool(
    "progress_write",
    {
      title: "Write progress",
      description:
        "Records current progress for a registered project (progress.yaml, PROGRESS.md, studio progress.md). " +
        "Pass `asked` and `did` to log what the person requested and what shipped for it. " +
        "Same Core path as `patchbay progress write`. Does not push the console directly -- the file change is enough.",
      inputSchema: inputShape,
    },
    async ({ alias, summary, skill, step, asked, did }) => {
      const recorded = await recordProgressWrite(studioHome, alias, { summary, skill, step, asked, did });
      return jsonResult({
        ok: true,
        alias: recorded.alias,
        summary: recorded.summary,
        progressMdPath: recorded.progressMdPath,
        rollupPath: recorded.rollupPath,
        current: recorded.progress.current,
      });
    },
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  applyConsultPatch,
  listArchivedConsults,
  loadPrd,
  PROVENANCE_SOURCES,
  readConsultRange,
  searchArchivedConsults,
} from "@patchbay/core";
import { z } from "zod";
import { jsonResult } from "./result.js";
import { resolveRegisteredProject } from "./shared.js";

/**
 * 1 설계 상담의 두 도구 (명세 20261006a §13.4 · §14.3).
 *
 * - `get_prd` — 초안을 PRD 11절로. 줄마다 출처 · 상담 진행 · 검토 상태. 읽기만.
 * - `consult_update` — 상담하는 호스트가 초안을 쓰는 **유일한** 길. `ir.proposed.yaml` 과
 *   `ir.provenance.yaml` 만 쓰고 승인된 `overlay.ir` 는 쓰지 않는다 (명세 §2.3). 모르는 칸은 거절한다.
 *
 * - `consult_history` — 끝내서 보관한 지난 대화를 필요할 때만 찾아 읽는다 (사용자 요청 2026-10-08). 새 대화는 빈 세션이라
 *   지난 말을 맥락에 싣지 않는다 — 색인 · 낱말 찾기 · 구간 읽기로 필요한 만큼만.
 *
 * Patchbay는 모델을 부르지 않는다: 쓰는 내용은 이 도구를 부른 호스트 자신의 해석이다.
 */
export function registerConsultTools(server: McpServer, studioHome: string): void {
  server.registerTool(
    "get_prd",
    {
      title: "Get PRD",
      description:
        "Draws the project's design draft (ir.proposed.yaml) as the 11-section PRD the person reviews, with the " +
        "source of every line (said / inferred / default / manual), the consultation progress per topic (which " +
        "sub-items are still empty) and the review state of each section. Deterministic; read-only.",
      inputSchema: { alias: z.string().optional().describe("Registered project alias. Omitted -> the sole registered project.") },
      annotations: { readOnlyHint: true },
    },
    async ({ alias }) => {
      const { registered } = await resolveRegisteredProject(studioHome, alias);
      const result = await loadPrd(studioHome, registered.alias);
      if (!result.ok) return jsonResult({ alias: registered.alias, prd: null, note: result.error });
      return jsonResult({ alias: registered.alias, sections: result.sections, review: result.review, progress: result.progress });
    },
  );

  server.registerTool(
    "consult_update",
    {
      title: "Update design draft from consultation",
      description:
        "Writes what you understood from the person into the design draft. `patch` is a partial IR using the " +
        "IR field names (goal, done, concepts, requirements, evals, environment, interface, credentials, …): " +
        "top-level keys replace, the object fields why / environment / interface merge their inner keys. Mark " +
        "each path with its source: `said` when the person said it, `inferred` when you interpreted it, `default` " +
        "when you filled a default they have not confirmed. Enumerated values use the contract words (pattern: " +
        "ubiquitous|event|state|unwanted|optional, priority: must|should|could, interface.entry: chat|cli|web|console|api|" +
        "schedule). Wrong shapes and unknown field names are refused, not dropped. Keep each call small — a few fields; " +
        "split long lists over several calls. Writes " +
        "only the draft and its source record — never the approved design. Do not invent what was not said; put " +
        "it in openQuestions instead.",
      inputSchema: {
        alias: z.string().describe("Registered project alias."),
        patch: z.record(z.string(), z.unknown()).describe("Partial IR — field names as in the IR contract."),
        provenance: z
          .array(z.object({ path: z.string(), source: z.enum(PROVENANCE_SOURCES) }))
          .optional()
          .describe("Source per path, e.g. {path: 'goal', source: 'said'}. Unmarked keys are recorded as inferred."),
        turn: z.number().int().nonnegative().optional().describe("The consultation message seq this came from."),
      },
      // 초안만 쓰고 승인본은 건드리지 않는다. Codex exec(approval never)는 이 표시가 없으면 호출을 거절한다.
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async ({ alias, patch, provenance, turn }) => {
      const { registered } = await resolveRegisteredProject(studioHome, alias);
      const result = await applyConsultPatch(studioHome, registered.alias, {
        patch,
        ...(provenance ? { provenance } : {}),
        ...(turn !== undefined ? { turn } : {}),
        // 콘솔이 상담 턴마다 MCP 서버를 띄우며 넘긴다 — 출처에 어느 대화였는지 남긴다.
        ...(process.env.PATCHBAY_CONSULT_ID ? { consult: process.env.PATCHBAY_CONSULT_ID } : {}),
      });
      if (!result.ok) return { ...jsonResult({ ok: false, error: result.error, unknown: result.unknown }), isError: true };
      const prd = await loadPrd(studioHome, registered.alias);
      return jsonResult({
        ok: true,
        written: result.written,
        ...(result.warnings.length ? { warnings: result.warnings } : {}),
        next: prd.ok ? prd.progress.next : null,
        missing: prd.ok ? prd.progress.topics.find((t) => t.name === prd.progress.next)?.missing ?? [] : [],
      });
    },
  );

  server.registerTool(
    "consult_history",
    {
      title: "Look up past consultations",
      description:
        "Finished consultations are archived and are NOT in your context — the design draft (get_prd) holds what was " +
        "decided. Use this only when the person refers to an earlier conversation or you must check why a field was " +
        "decided. No arguments → the archive index (id, title, dates, turns, fields each conversation changed). " +
        "`query` → matching snippets with conversation id and seq. `id` (+ optional `fromSeq`, `limit`) → that stretch " +
        "of the conversation, long messages trimmed. Read narrowly; do not read whole conversations.",
      inputSchema: {
        alias: z.string().optional().describe("Registered project alias. Omitted -> the sole registered project."),
        query: z.string().optional().describe("Word or phrase to find in archived conversations (case-insensitive)."),
        id: z.string().optional().describe("Consultation id to read."),
        fromSeq: z.number().int().nonnegative().optional().describe("With id: start from this seq. Omitted -> the last messages."),
        limit: z.number().int().positive().max(40).optional().describe("Max messages or hits (default 20)."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ alias, query, id, fromSeq, limit }) => {
      const { registered } = await resolveRegisteredProject(studioHome, alias);
      if (id) {
        const range = await readConsultRange(studioHome, registered.alias, id, {
          ...(fromSeq !== undefined ? { fromSeq } : {}),
          ...(limit !== undefined ? { limit } : {}),
        });
        if (!range) return { ...jsonResult({ ok: false, error: `상담 ${id} 가 없다.` }), isError: true };
        return jsonResult(range);
      }
      if (query) {
        return jsonResult({ query, hits: await searchArchivedConsults(studioHome, registered.alias, query, limit ?? 20) });
      }
      return jsonResult({ archived: await listArchivedConsults(studioHome, registered.alias) });
    },
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildLog, readLogConfig, readLogDay, readLogMonth, zonedParts, type LogIndexEntry } from "@patchbay/core";
import { z } from "zod";
import { jsonResult } from "./result.js";
import { resolveRegisteredProject } from "./shared.js";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MAX_ENTRIES = 200;
const MAX_RECORD_CHARS = 20_000;

/**
 * Log 읽기 · 정리 (사용자 결정 2026-10-15) — 화면 · CLI 와 같은 커널 함수.
 * 폰에서 「오늘 기록 정리해 줘」 「이번 주 보고서 써 줘」를 이 두 도구로 한다.
 * 기록에는 사용자 말 발췌가 들어 있다 — 그 프로젝트 일에만 쓴다.
 */
export function registerLogTools(server: McpServer, studioHome: string): void {
  server.registerTool(
    "log_build",
    {
      title: "Build project Log",
      description: "원문(진행 보고 · 대화방 · 할일 · 흐름도 · History 메모 · git 커밋)을 모아 그 달의 일일 기록과 색인을 다시 정리한다. 확정한 날은 바꾸지 않는다. date 를 비우면 오늘이 든 달.",
      inputSchema: { alias: z.string().describe("Registered project alias."), date: DATE.optional().describe("이 날이 든 달을 정리한다 (YYYY-MM-DD).") },
    },
    async ({ alias, date }) => {
      const { registered } = await resolveRegisteredProject(studioHome, alias);
      const day = date ?? zonedParts(new Date(), (await readLogConfig(studioHome, registered.alias)).tz)!.date;
      const result = await buildLog(studioHome, registered.alias, { from: day, to: day });
      return jsonResult({ ok: true, project: registered.alias, ...result });
    },
  );

  server.registerTool(
    "log_read",
    {
      title: "Read project Log",
      description: "정리된 Log 를 읽는다. date 하나면 그날 일일 기록 본문과 요약, from~to 면 그 기간 색인(날짜별 집계 · 사건 줄)을 준다. tag · kind 로 거른다. 읽기 전에 log_build 로 정리한다. 사건 id 는 근거로 그대로 인용한다.",
      inputSchema: {
        alias: z.string().describe("Registered project alias."),
        date: DATE.optional().describe("그날 하나 (YYYY-MM-DD)."),
        from: DATE.optional().describe("기간 시작."),
        to: DATE.optional().describe("기간 끝."),
        tag: z.string().optional().describe("이 태그가 붙은 사건만."),
        kind: z.enum(["진행", "대화", "할일", "흐름도", "메모", "커밋"]).optional(),
      },
    },
    async ({ alias, date, from, to, tag, kind }) => {
      const { registered } = await resolveRegisteredProject(studioHome, alias);
      if (date) {
        const day = await readLogDay(studioHome, registered.alias, date);
        const record = day.record && day.record.length > MAX_RECORD_CHARS ? `${day.record.slice(0, MAX_RECORD_CHARS)}\n…(잘림)` : day.record;
        return jsonResult({ ok: true, project: registered.alias, date, state: day.state, record, summary: day.summary });
      }
      if (!from || !to || from > to) throw new Error("date 하나 또는 from ≤ to 를 준다.");
      const days: Record<string, unknown> = {};
      const entries: LogIndexEntry[] = [];
      for (let m = from.slice(0, 7); m <= to.slice(0, 7);) {
        const index = await readLogMonth(studioHome, registered.alias, m);
        for (const [d, stat] of Object.entries(index?.days ?? {})) if (d >= from && d <= to) days[d] = stat;
        for (const e of index?.entries ?? []) if (e.date >= from && e.date <= to && (!tag || e.tags.includes(tag)) && (!kind || e.kind === kind)) entries.push(e);
        const [y, mo] = m.split("-").map(Number) as [number, number];
        m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
      }
      return jsonResult({ ok: true, project: registered.alias, from, to, days, entries: entries.slice(0, MAX_ENTRIES), truncated: entries.length > MAX_ENTRIES ? entries.length - MAX_ENTRIES : 0 });
    },
  );
}

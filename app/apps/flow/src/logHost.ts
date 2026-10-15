import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Context, Hono } from "hono";
import {
  buildLog,
  checkLogSummary,
  compactLogRecord,
  confirmLogDay,
  draftLogReport,
  listLogReports,
  logRecordHash,
  logSummaryPrompt,
  readLogConfig,
  readLogDay,
  readLogMonth,
  readLogReport,
  readStudio,
  reopenLogDay,
  setLogSummaryModel,
  writeLogSummary,
  zonedParts,
  type LogReportPeriod,
} from "@patchbay/core";
import { defaultRoomRunner, isEmbeddingModel, resolveRoomBin, type RoomRunner } from "./roomHost.js";

const run = promisify(execFile);

/**
 * 콘솔 Log (사용자 결정 2026-10-15 — 1안 화면). 정리 · 확정 · 보고서 바탕은 커널이 하고,
 * 로컬 LLM 요약 호출만 여기서 한다 — LM Studio(`lms chat`)만 쓴다, 클라우드로 보내지 않는다 (D3).
 */
export interface LogHostOptions {
  runner?: RoomRunner;
  /** LM Studio 실행 파일. 시험은 가짜를 넣는다. `null` 이면 없음. */
  lmsBin?: string | null;
  /** 시험은 고정 시각을 넣는다. */
  now?: () => Date;
}

async function body(c: Context): Promise<Record<string, unknown>> {
  try {
    const payload: unknown = await c.req.json();
    return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  } catch { return {}; }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function registerLogRoutes(app: Hono, studioHome: string, options: LogHostOptions = {}): void {
  const now = options.now ?? (() => new Date());
  const runner = options.runner ?? defaultRoomRunner;
  const summarizing = new Map<string, AbortController>();
  const lmsBin = () => (options.lmsBin !== undefined ? options.lmsBin : resolveRoomBin("local"));

  async function registered(alias: string): Promise<boolean> {
    return Boolean(alias) && (await readStudio(studioHome)).projects.some((p) => p.alias === alias);
  }
  const fail = (c: Context, error: unknown, status: 400 | 404 | 409 | 422 | 500 = 400) => c.json({ error: (error as Error).message ?? String(error) }, status);

  /** 한 달 — 정리한 뒤 색인. 화면을 열 때 부른다. */
  app.get("/api/log", async (c) => {
    const alias = c.req.query("alias") ?? "";
    if (!(await registered(alias))) return c.json({ error: "등록된 프로젝트가 아닙니다." }, 404);
    try {
      const config = await readLogConfig(studioHome, alias);
      const today = zonedParts(now(), config.tz)!.date;
      const month = c.req.query("month") || today.slice(0, 7);
      if (month <= today.slice(0, 7)) await buildLog(studioHome, alias, { from: `${month}-01`, to: `${month}-01` }, now());
      return c.json({ month, today, tz: config.tz, tags: config.tags, model: config.summary.model, index: await readLogMonth(studioHome, alias, month) });
    } catch (error) { return fail(c, error); }
  });

  app.get("/api/log/day", async (c) => {
    const alias = c.req.query("alias") ?? "";
    if (!(await registered(alias))) return c.json({ error: "등록된 프로젝트가 아닙니다." }, 404);
    try { return c.json(await readLogDay(studioHome, alias, c.req.query("date") ?? "")); }
    catch (error) { return fail(c, error); }
  });

  /** 다시 정리 — 그날이 든 달. 확정한 날은 바뀌지 않는다. */
  app.post("/api/log/build", async (c) => {
    const rec = await body(c);
    const alias = str(rec.alias), date = str(rec.date);
    if (!(await registered(alias))) return c.json({ error: "등록된 프로젝트가 아닙니다." }, 404);
    try {
      const result = await buildLog(studioHome, alias, { from: date, to: date }, now());
      return c.json({ ...result, day: await readLogDay(studioHome, alias, date) });
    } catch (error) { return fail(c, error); }
  });

  app.post("/api/log/confirm", async (c) => {
    const rec = await body(c);
    const alias = str(rec.alias);
    if (!(await registered(alias))) return c.json({ error: "등록된 프로젝트가 아닙니다." }, 404);
    try { return c.json(await confirmLogDay(studioHome, alias, str(rec.date), now())); }
    catch (error) { return fail(c, error, 409); }
  });

  app.post("/api/log/reopen", async (c) => {
    const rec = await body(c);
    const alias = str(rec.alias);
    if (!(await registered(alias))) return c.json({ error: "등록된 프로젝트가 아닙니다." }, 404);
    try { return c.json(await reopenLogDay(studioHome, alias, str(rec.date), now())); }
    catch (error) { return fail(c, error, 409); }
  });

  /** LM Studio 에 받아 둔 대화 모델 (임베딩 제외). */
  app.get("/api/log/models", async (c) => {
    const bin = lmsBin();
    if (!bin) return c.json({ available: false, reason: "LM Studio(lms)를 찾지 못했습니다.", models: [] });
    try {
      const { stdout } = await run(bin, ["ls", "--json"], { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
      const rows = JSON.parse(stdout) as { type?: string; modelKey?: string; displayName?: string }[];
      const models = rows.filter((r) => r.type === "llm" && r.modelKey && !isEmbeddingModel(r.modelKey)).map((r) => ({ id: r.modelKey!, name: r.displayName ?? r.modelKey! }));
      return c.json({ available: true, models });
    } catch (error) { return c.json({ available: false, reason: `모델 목록을 읽지 못했습니다: ${(error as Error).message.slice(0, 160)}`, models: [] }); }
  });

  app.post("/api/log/model", async (c) => {
    const rec = await body(c);
    const alias = str(rec.alias);
    if (!(await registered(alias))) return c.json({ error: "등록된 프로젝트가 아닙니다." }, 404);
    try { return c.json({ model: (await setLogSummaryModel(studioHome, alias, str(rec.model))).summary.model }); }
    catch (error) { return fail(c, error); }
  });

  /** 요약 만들기 — 사람이 눌렀을 때만. 형식 · 근거 검사를 통과한 글만 저장하고, 실패하면 앞 요약을 그대로 둔다. */
  app.post("/api/log/summary", async (c) => {
    const rec = await body(c);
    const alias = str(rec.alias), date = str(rec.date);
    if (!(await registered(alias))) return c.json({ error: "등록된 프로젝트가 아닙니다." }, 404);
    if (summarizing.has(alias)) return c.json({ error: "이 프로젝트는 이미 요약 중입니다." }, 409);
    try {
      const config = await readLogConfig(studioHome, alias);
      if (!config.summary.model) return c.json({ error: "요약 모델을 먼저 고르세요." }, 400);
      const bin = lmsBin();
      if (!bin) return c.json({ error: "LM Studio(lms)를 찾지 못했습니다." }, 400);
      const day = await readLogDay(studioHome, alias, date);
      if (!day.record) return c.json({ error: "이 날은 기록이 없습니다." }, 400);
      const input = compactLogRecord(day.record);
      if (input === null) return c.json({ error: `사건이 너무 많아 로컬 모델에 넘기지 않았습니다 (${day.events.length}건). 주 · 월 보고서 바탕을 쓰세요.` }, 422);
      const { system, prompt } = logSummaryPrompt(input);
      const abort = new AbortController();
      summarizing.set(alias, abort);
      try {
        const turn = await runner({ speaker: "local", model: config.summary.model, role: system, bin, prompt, cwd: os.tmpdir(), timeoutMs: config.summary.timeoutMs, signal: abort.signal });
        if (!turn.ok) return c.json({ error: turn.kind === "timeout" ? "로컬 모델이 시간 안에 답하지 않았습니다." : turn.kind === "stopped" ? "요약을 멈췄습니다." : `로컬 모델 오류: ${turn.text}` }, 422);
        const check = checkLogSummary(turn.text, day.record);
        if (!check.ok) return c.json({ error: "요약이 형식 · 근거 검사를 통과하지 못해 저장하지 않았습니다.", errors: check.errors }, 422);
        const latest = await readLogDay(studioHome, alias, date);
        if (!latest.record || logRecordHash(latest.record) !== logRecordHash(day.record)) return c.json({ error: "요약하는 동안 기록이 바뀌었습니다. 다시 요약하세요." }, 409);
        await writeLogSummary(studioHome, alias, date, { model: config.summary.model, text: check.text, record: day.record, now: now() });
        return c.json({ ...(await readLogDay(studioHome, alias, date)), suggestedTags: check.tags });
      } finally { summarizing.delete(alias); }
    } catch (error) { return fail(c, error); }
  });

  app.post("/api/log/summary/stop", async (c) => {
    const alias = str((await body(c)).alias);
    const abort = summarizing.get(alias);
    if (!abort) return c.json({ error: "요약 중이 아닙니다." }, 409);
    abort.abort();
    return c.json({ ok: true });
  });

  /** 보고서 바탕 — 있으면 그 파일, 없으면 처음 만든다. */
  app.post("/api/log/report", async (c) => {
    const rec = await body(c);
    const alias = str(rec.alias), period = str(rec.period), key = str(rec.key);
    if (!(await registered(alias))) return c.json({ error: "등록된 프로젝트가 아닙니다." }, 404);
    if (!["day", "week", "month"].includes(period)) return c.json({ error: "기간은 day · week · month 입니다." }, 400);
    try { return c.json(await draftLogReport(studioHome, alias, period as LogReportPeriod, key, now())); }
    catch (error) { return fail(c, error); }
  });

  app.get("/api/log/reports", async (c) => {
    const alias = c.req.query("alias") ?? "";
    if (!(await registered(alias))) return c.json({ error: "등록된 프로젝트가 아닙니다." }, 404);
    const name = c.req.query("name");
    try {
      if (name) {
        const text = await readLogReport(studioHome, alias, name);
        return text === null ? c.json({ error: "보고서가 없습니다." }, 404) : c.json({ name, text });
      }
      return c.json({ reports: await listLogReports(studioHome, alias) });
    } catch (error) { return fail(c, error); }
  });
}

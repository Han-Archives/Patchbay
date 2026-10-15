import {
  buildLog,
  confirmLogDay,
  draftLogReport,
  isoWeekKey,
  readLogConfig,
  readLogDay,
  readStudio,
  requireStudioHome,
  zonedParts,
  type LogReportPeriod,
} from "@patchbay/core";
import { printResult } from "../output.js";

async function registered(studioHome: string, alias: string): Promise<string> {
  const studio = await readStudio(studioHome);
  if (!studio.projects.some((row) => row.alias === alias)) throw new Error(`등록된 프로젝트가 아니다: ${alias} (등록된 것: ${studio.projects.map((row) => row.alias).join(", ")})`);
  return alias;
}

async function today(studioHome: string, alias: string): Promise<string> {
  return zonedParts(new Date(), (await readLogConfig(studioHome, alias)).tz)!.date;
}

export interface LogBuildOptions { project: string; date?: string; month?: string; json?: boolean }

/** `patchbay log build --project <alias> [--date | --month]` — 그 달을 정리한다 (기본: 오늘이 든 달). */
export async function runLogBuild(options: LogBuildOptions, studioHome: string = requireStudioHome()): Promise<number> {
  const alias = await registered(studioHome, options.project);
  const date = options.date ?? (options.month ? `${options.month}-01` : await today(studioHome, alias));
  const result = await buildLog(studioHome, alias, { from: date, to: date });
  printResult(Boolean(options.json), { ok: true, project: alias, ...result }, [
    `정리한 달: ${result.months.join(", ")}`,
    `다시 쓴 날: ${result.written.join(", ") || "없음"}${result.removed.length ? ` · 지운 날: ${result.removed.join(", ")}` : ""}`,
    ...result.sources.map((s) => `  ${s.name}: ${s.state}${s.note ? ` (${s.note})` : ""}`),
  ]);
  return 0;
}

export interface LogShowOptions { project: string; date?: string; json?: boolean }

/** `patchbay log show --project <alias> [--date]` — 정리한 뒤 그날 기록 본문을 찍는다. */
export async function runLogShow(options: LogShowOptions, studioHome: string = requireStudioHome()): Promise<number> {
  const alias = await registered(studioHome, options.project);
  const date = options.date ?? await today(studioHome, alias);
  await buildLog(studioHome, alias, { from: date, to: date });
  const day = await readLogDay(studioHome, alias, date);
  printResult(Boolean(options.json), { ok: true, project: alias, ...day }, [day.record ?? `${date}: 기록된 일이 없다.`]);
  return 0;
}

export interface LogConfirmOptions { project: string; date: string; json?: boolean }

export async function runLogConfirm(options: LogConfirmOptions, studioHome: string = requireStudioHome()): Promise<number> {
  const alias = await registered(studioHome, options.project);
  const day = await confirmLogDay(studioHome, alias, options.date);
  printResult(Boolean(options.json), { ok: true, project: alias, date: day.date, state: day.state, events: day.events.length }, [`${day.date} 확정 — 사건 ${day.events.length}건을 보존했다.`]);
  return 0;
}

export interface LogReportOptions { project: string; period: string; key?: string; json?: boolean }

/** `patchbay log report --project <alias> --period day|week|month [--key]` — 보고서 바탕. 있으면 덮지 않는다. */
export async function runLogReport(options: LogReportOptions, studioHome: string = requireStudioHome()): Promise<number> {
  const alias = await registered(studioHome, options.project);
  if (!["day", "week", "month"].includes(options.period)) throw new Error("--period 는 day · week · month 중 하나다.");
  const period = options.period as LogReportPeriod;
  const now = await today(studioHome, alias);
  const key = options.key ?? (period === "day" ? now : period === "week" ? isoWeekKey(now) : now.slice(0, 7));
  const result = await draftLogReport(studioHome, alias, period, key);
  printResult(Boolean(options.json), { ok: true, project: alias, ...result }, [result.created ? `보고서 바탕을 만들었다: ${result.file}` : `이미 있다 (덮지 않음): ${result.file}`]);
  return 0;
}

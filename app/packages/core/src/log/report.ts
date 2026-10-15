import fs from "node:fs/promises";
import path from "node:path";
import { buildLog, readLogDay, readLogMonth, type LogDayStat } from "./build.js";
import { collectLogEvents } from "./collect.js";
import { readLogConfig } from "./config.js";
import { addDays, assertLogDate, assertLogMonth, isoWeekRange, logPaths, monthDates, readText, weekday, zonedParts } from "./paths.js";
import { logSummaryHeadline } from "./summary.js";

/**
 * 보고서 바탕 (사용자 요구 2026-10-15 R4) — 기간을 고르면 근거를 모은 `.md` 를 처음 한 번 만든다.
 * 그다음은 사람의 저작물이라 덮지 않는다 (있으면 그 파일을 돌려준다). LLM 없이 완성된다.
 * 요약은 일일 기록과 해시가 맞는 것(fresh)만 「로컬 LLM 요약」이라고 밝혀 넣는다.
 */
export type LogReportPeriod = "day" | "week" | "month";

export function logReportRange(period: LogReportPeriod, key: string): { from: string; to: string; name: string; label: string } {
  if (period === "day") { assertLogDate(key); return { from: key, to: key, name: `day-${key}.md`, label: `일일 보고 · ${key} (${weekday(key)})` }; }
  if (period === "week") { const r = isoWeekRange(key); return { ...r, name: `week-${key}.md`, label: `주간 보고 · ${key} (${r.from.slice(5).replace("-", "/")}–${r.to.slice(5).replace("-", "/")})` }; }
  assertLogMonth(key);
  const dates = monthDates(key);
  return { from: dates[0]!, to: dates[dates.length - 1]!, name: `month-${key}.md`, label: `월간 보고 · ${key}` };
}

export interface LogReportResult { file: string; name: string; created: boolean; text: string }

export async function draftLogReport(studioHome: string, alias: string, period: LogReportPeriod, key: string, now = new Date()): Promise<LogReportResult> {
  const range = logReportRange(period, key);
  const p = logPaths(studioHome, alias);
  const file = path.join(p.reports, range.name);
  const existing = await readText(file);
  if (existing !== null) return { file, name: range.name, created: false, text: existing };

  await buildLog(studioHome, alias, range, now);
  const config = await readLogConfig(studioHome, alias);
  const today = zonedParts(now, config.tz)!.date;
  const stats: [string, LogDayStat][] = [];
  for (let m = range.from.slice(0, 7); m <= range.to.slice(0, 7); m = addDays(`${m}-28`, 7).slice(0, 7)) {
    const index = await readLogMonth(studioHome, alias, m);
    for (const [date, stat] of Object.entries(index?.days ?? {})) if (date >= range.from && date <= range.to) stats.push([date, stat]);
  }
  stats.sort((a, b) => a[0].localeCompare(b[0]));

  const results: string[] = [], done: string[] = [], removed: string[] = [], memos: string[] = [], rooms: string[] = [], daily: string[] = [];
  const tagEvents: Record<string, number> = {}, tagFiles: Record<string, number> = {};
  let summaries = 0;
  // 잠정인 날들은 원문에서 한 번에 모은다 (날마다 따로 모으지 않게).
  const loose = stats.some(([, s]) => s.state === "잠정") ? (await collectLogEvents(studioHome, alias, range.from, range.to < today ? range.to : today, config, now)).events : [];
  for (const [date, stat] of stats) {
    const day = await readLogDay(studioHome, alias, date, config, stat.state === "잠정" ? loose.filter((e) => e.date === date) : undefined);
    const md = date.slice(5).replace("-", "/");
    for (const [t, n] of Object.entries(stat.tags)) tagEvents[t] = (tagEvents[t] ?? 0) + n;
    for (const [t, n] of Object.entries(stat.fileTags)) tagFiles[t] = (tagFiles[t] ?? 0) + n;
    for (const e of day.events) {
      if (e.kind === "진행") {
        const did = e.detail?.find((d) => d.startsWith("반영: "))?.slice(4);
        results.push(`- ${md} ${did ? `${e.title} — ${did}` : e.title} [${e.id}]`);
      } else if (e.kind === "커밋") results.push(`- ${md} 커밋: ${e.title} [${e.id}]`);
      else if (e.kind === "할일" && e.change === "완료") done.push(`- ${md} ${e.title} [${e.id}]`);
      else if (e.kind === "할일" && e.change === "삭제") removed.push(`- ${md} 지움: ${e.title} [${e.id}]`);
      else if (e.kind === "메모") memos.push(`- ${md} ${e.title}${e.tags.length ? ` (${e.tags.join(", ")})` : ""} [${e.id}]`);
      else if (e.kind === "대화") rooms.push(`- ${md} ${e.title} · ${e.change} [${e.id}]`);
    }
    const headline = day.summary.state === "fresh" && day.summary.text ? logSummaryHeadline(day.summary.text) : null;
    if (headline) summaries++;
    daily.push(`- ${md} (${weekday(date)}) ${stat.state} · 사건 ${stat.events}${headline ? ` — ${headline} *(로컬 LLM 요약)*` : ""}`);
  }
  const provisional = stats.filter(([, s]) => s.state === "잠정").map(([d]) => d.slice(5).replace("-", "/"));
  const tagRows = Object.keys(tagEvents).sort((a, b) => tagEvents[b]! - tagEvents[a]!).map((t) => `| ${t} | ${tagEvents[t]} | ${tagFiles[t] ?? 0} |`);
  const human = "_(사람이 쓴다 — 아래 근거를 보고)_";
  const text = [
    "---",
    `project: ${JSON.stringify(alias)}`,
    `period: ${period}`,
    `range: ${range.from} ~ ${range.to}`,
    `drafted: ${now.toISOString()}`,
    `sources: { days: ${stats.length}, confirmed: ${stats.length - provisional.length}, provisional: ${provisional.length}, summaries: ${summaries} }`,
    "---",
    "",
    `# ${alias} ${range.label}`,
    "",
    ...(range.to >= today ? ["> 아직 끝나지 않은 기간이다.", ""] : []),
    ...(provisional.length ? [`> 잠정인 날: ${provisional.join(", ")} — 확정 뒤 바뀔 수 있다.`, ""] : []),
    "## 한 줄 요약", "", human, "",
    "## 주요 성과", "", ...(results.length ? results : ["- 기록된 진행 보고 · 커밋 없음"]), "",
    "## 바뀐 영역", "", "| 태그 | 사건 | 고유 파일 |", "| --- | --- | --- |", ...(tagRows.length ? tagRows : ["| — | 0 | 0 |"]), "",
    "## 끝낸 할일 · 지운 할일", "", ...(done.length || removed.length ? [...done, ...removed] : ["- 없음"]), "",
    ...(memos.length ? ["## 메모", "", ...memos, ""] : []),
    ...(rooms.length ? ["## 대화", "", ...rooms, ""] : []),
    "## 막힌 것 · 남은 일", "", human, "",
    "## 다음 계획", "", human, "",
    "## 날마다", "", ...(daily.length ? daily : ["- 기록된 날 없음"]), "",
    "## 근거", "", `일일 기록 \`log/records/\` ${stats.length}장 · 색인 \`log/index/\`. 대괄호 안은 사건 id.`, "",
  ].join("\n");
  await fs.mkdir(p.reports, { recursive: true });
  try {
    await fs.writeFile(file, text, { encoding: "utf8", flag: "wx" });
    return { file, name: range.name, created: true, text };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return { file, name: range.name, created: false, text: (await readText(file)) ?? text };
  }
}

export async function readLogReport(studioHome: string, alias: string, name: string): Promise<string | null> {
  if (!/^(day-\d{4}-\d{2}-\d{2}|week-\d{4}-W\d{2}|month-\d{4}-\d{2})\.md$/.test(name)) throw new Error(`Log: 보고서 이름 "${name}" 이 맞지 않다.`);
  return readText(path.join(logPaths(studioHome, alias).reports, name));
}

export async function listLogReports(studioHome: string, alias: string): Promise<string[]> {
  try { return (await fs.readdir(logPaths(studioHome, alias).reports)).filter((n) => n.endsWith(".md")).sort().reverse(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

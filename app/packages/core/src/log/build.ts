import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { withFileLock } from "../rooms/store.js";
import { collectLogEvents, type LogEvent, type LogSource } from "./collect.js";
import { readLogConfig, type LogConfig } from "./config.js";
import { assertLogDate, assertLogMonth, atomicWrite, logPaths, monthDates, readText, weekday, writeIfChanged, zonedParts } from "./paths.js";

/**
 * 정리 — 원문에서 날마다 사건을 모아 일일 기록(`records/<날짜>.md`)과 월별 색인(`index/<월>.json`)을 쓴다.
 * 감시자 없이 부를 때만 돈다 (화면 · CLI · MCP · 보고서가 이 함수 하나를 부른다). 프로젝트마다 잠근다.
 *
 * 잠정 · 확정 (사용자 결정 2026-10-15 D1): 잠정인 날은 원문에서 매번 다시 만든다. 사용자가 「확정」하면
 * 그날 사건을 `events/<날짜>.json` 에 보존하고, 그 뒤로는 원문이 바뀌어도 그 파일에서 그린다.
 * 일일 기록 본문에는 정리한 시각을 넣지 않는다 — 같은 입력이면 같은 바이트.
 */
export const LOG_RENDER_VERSION = 1;

export type LogDayState = "잠정" | "확정";
export type LogSummaryState = "none" | "fresh" | "stale";

const confirmedSchema = z.object({
  version: z.literal(1),
  project: z.string(),
  date: z.string(),
  tz: z.string(),
  confirmedAt: z.string(),
  sources: z.array(z.object({ name: z.string(), state: z.string(), count: z.number(), note: z.string().optional() })),
  events: z.array(z.record(z.string(), z.unknown())),
});
type ConfirmedDay = z.infer<typeof confirmedSchema>;

export interface LogDayStat {
  state: LogDayState;
  events: number;
  /** 커밋으로 바뀐 고유 파일 수. */
  files: number;
  kinds: Record<string, number>;
  /** 태그별 사건 수. */
  tags: Record<string, number>;
  /** 태그별 고유 파일 수. */
  fileTags: Record<string, number>;
  summary: LogSummaryState;
}

export interface LogIndexEntry { id: string; date: string; time: string; kind: string; change: string; title: string; tags: string[]; ref: LogEvent["ref"] }

export interface LogMonthIndex {
  version: 1;
  project: string;
  month: string;
  tz: string;
  builtAt: string;
  tags: string[];
  sources: LogSource[];
  days: Record<string, LogDayStat>;
  entries: LogIndexEntry[];
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function dayStat(events: LogEvent[], state: LogDayState, summary: LogSummaryState): LogDayStat {
  const kinds: Record<string, number> = {}, tags: Record<string, number> = {};
  const files = new Set<string>();
  const fileTagSets = new Map<string, Set<string>>();
  for (const e of events) {
    kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    for (const t of e.tags) tags[t] = (tags[t] ?? 0) + 1;
    for (const f of e.files ?? []) files.add(f);
    for (const [t, list] of Object.entries(e.filesByTag ?? {})) for (const f of list) (fileTagSets.get(t) ?? fileTagSets.set(t, new Set()).get(t)!).add(f);
  }
  return { state, events: events.length, files: files.size, kinds, tags, fileTags: Object.fromEntries([...fileTagSets].map(([t, s]) => [t, s.size])), summary };
}

const SOURCE_KIND: Record<string, string> = { "진행 보고": "진행", "대화방": "대화", "할일": "할일", "흐름도 항목": "흐름도", "History 메모": "메모", "git 커밋": "커밋" };
const SECTIONS: [LogEvent["kind"], string][] = [["진행", "진행"], ["대화", "대화"], ["할일", "할일"], ["흐름도", "흐름도 항목"], ["메모", "History 메모"], ["커밋", "커밋"]];

/** 일일 기록 한 장. 사건 id 를 본문에 넣는다 — 요약의 근거를 이 id 로 검사한다. */
export function renderLogDay(input: { project: string; date: string; tz: string; state: LogDayState; events: LogEvent[]; sources: LogSource[]; workTree: number | null; confirmedAt?: string }): string {
  const { project, date, tz, state, events } = input;
  const stat = dayStat(events, state, "none");
  const top = Object.entries(stat.tags).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `${t} ${n}`).join(" · ");
  const yamlMap = (o: Record<string, number>) => `{ ${Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${v}`).join(", ")} }`;
  const lines = [
    "---",
    `project: ${JSON.stringify(project)}`,
    `date: ${date}`,
    `tz: ${tz}`,
    `state: ${state}`,
    ...(input.confirmedAt ? [`confirmedAt: ${input.confirmedAt}`] : []),
    `events: ${stat.events}`,
    `files: ${stat.files}`,
    `tags: ${yamlMap(stat.tags)}`,
    `render: ${LOG_RENDER_VERSION}`,
    "---",
    "",
    `# ${project} · ${date} (${weekday(date)})`,
    "",
    "## 한눈에",
    "",
    `사건 ${stat.events} · 고유 파일 ${stat.files}${top ? ` · 가장 많이 바뀐 곳 ${top}` : ""} · ${state}`,
  ];
  for (const [kind, heading] of SECTIONS) {
    const rows = events.filter((e) => e.kind === kind);
    if (!rows.length) continue;
    lines.push("", `## ${heading}`, "");
    for (const e of rows) {
      const tags = e.tags.map((t) => `#${t}`).join(" ");
      lines.push(`- ${e.time} **${e.title.replace(/\*/g, "\\*")}** · ${e.change}${tags ? ` · ${tags}` : ""} · \`${e.id}\``);
      for (const d of e.detail ?? []) lines.push(`  - ${d}`);
      for (const x of e.excerpt ?? []) lines.push(`  - 발췌 ${x}`);
      if (e.omitted) lines.push(`  - 발췌 ${e.omitted}개 더 (LLM 답은 넣지 않음)`);
      if (e.files?.length) lines.push(`  - 파일 ${e.files.length}: ${e.files.slice(0, 8).join(" · ")}${e.files.length > 8 ? ` 외 ${e.files.length - 8}` : ""}`);
    }
  }
  if (state === "잠정" && input.workTree !== null) lines.push("", "## 작업 트리 상태", "", `조회 시점 커밋 안 된 파일 ${input.workTree} — 오늘 변경이 아니라 지금 상태다.`);
  lines.push("", "## 수집", "");
  for (const s of input.sources) {
    const n = stat.kinds[SOURCE_KIND[s.name] ?? ""] ?? 0;
    lines.push(`- ${s.name}: ${s.state === "unavailable" ? "수집 불가" : s.state === "error" ? "실패" : n ? `${n}건` : "없음"}${s.note ? ` (${s.note})` : ""}`);
  }
  lines.push("- 묶이지 않은 Claude Code 대화는 들어오지 않는다");
  return `${lines.join("\n")}\n`;
}

async function readConfirmed(file: string): Promise<ConfirmedDay | null> {
  const text = await readText(file);
  return text === null ? null : confirmedSchema.parse(JSON.parse(text));
}

async function summaryState(summaries: string, date: string, record: string | null): Promise<LogSummaryState> {
  const text = await readText(path.join(summaries, `${date}.md`));
  if (text === null) return "none";
  const source = /^source:\s*([0-9a-f]{64})\s*$/m.exec(text)?.[1];
  return record !== null && source === hash(record) ? "fresh" : "stale";
}

export function logRecordHash(record: string): string {
  return hash(record);
}

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7);) {
    out.push(m);
    const [y, mo] = m.split("-").map(Number) as [number, number];
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  return out;
}

export interface LogBuildResult { months: string[]; written: string[]; removed: string[]; sources: LogSource[] }

/** 범위가 걸친 달을 통째로 정리한다. 오늘 뒤의 날은 만들지 않는다. */
export async function buildLog(studioHome: string, alias: string, range: { from: string; to: string }, now = new Date()): Promise<LogBuildResult> {
  assertLogDate(range.from); assertLogDate(range.to);
  const p = logPaths(studioHome, alias);
  await fs.mkdir(p.root, { recursive: true });
  return withFileLock(p.lock, async () => {
    const config = await readLogConfig(studioHome, alias);
    const months = monthsBetween(range.from, range.to);
    const today = zonedParts(now, config.tz)!.date;
    const from = `${months[0]}-01`;
    const to = [monthDates(months[months.length - 1]!).pop()!, today].sort()[0]!;
    const result: LogBuildResult = { months, written: [], removed: [], sources: [] };
    if (from > to) return result;
    const collected = await collectLogEvents(studioHome, alias, from, to, config, now);
    result.sources = collected.sources;
    const byDate = new Map<string, LogEvent[]>();
    for (const e of collected.events) (byDate.get(e.date) ?? byDate.set(e.date, []).get(e.date)!).push(e);
    for (const month of months) {
      const index: LogMonthIndex = { version: 1, project: alias, month, tz: config.tz, builtAt: now.toISOString(), tags: config.tags, sources: collected.sources, days: {}, entries: [] };
      for (const date of monthDates(month)) {
        if (date > to) break;
        const recordFile = path.join(p.records, `${date}.md`);
        const confirmed = await readConfirmed(path.join(p.events, `${date}.json`));
        let events: LogEvent[], record: string | null;
        if (confirmed) {
          events = confirmed.events as unknown as LogEvent[];
          record = renderLogDay({ project: alias, date, tz: confirmed.tz, state: "확정", events, sources: confirmed.sources as LogSource[], workTree: null, confirmedAt: confirmed.confirmedAt });
        } else {
          events = byDate.get(date) ?? [];
          record = events.length ? renderLogDay({ project: alias, date, tz: config.tz, state: "잠정", events, sources: collected.sources, workTree: date === today ? collected.workTree : null }) : null;
        }
        if (record === null) {
          if (await readText(recordFile) !== null) { await fs.rm(recordFile, { force: true }); result.removed.push(date); }
          continue;
        }
        if (await writeIfChanged(recordFile, record)) result.written.push(date);
        index.days[date] = dayStat(events, confirmed ? "확정" : "잠정", await summaryState(p.summaries, date, record));
        for (const e of events) index.entries.push({ id: e.id, date: e.date, time: e.time, kind: e.kind, change: e.change, title: e.title, tags: e.tags, ref: e.ref });
      }
      await atomicWrite(path.join(p.index, `${month}.json`), `${JSON.stringify(index, null, 2)}\n`);
    }
    return result;
  });
}

export async function readLogMonth(studioHome: string, alias: string, month: string): Promise<LogMonthIndex | null> {
  const text = await readText(path.join(logPaths(studioHome, alias).index, `${assertLogMonth(month)}.json`));
  return text === null ? null : (JSON.parse(text) as LogMonthIndex);
}

export interface LogDayView {
  date: string;
  state: LogDayState | null;
  record: string | null;
  events: LogEvent[];
  summary: { state: LogSummaryState; text: string | null };
}

/** 한 날 — 기록 본문 · 사건 · 요약. 정리는 하지 않는다 (먼저 buildLog). */
export async function readLogDay(studioHome: string, alias: string, date: string, config?: LogConfig, looseEvents?: LogEvent[]): Promise<LogDayView> {
  assertLogDate(date);
  const p = logPaths(studioHome, alias);
  const record = await readText(path.join(p.records, `${date}.md`));
  const confirmed = await readConfirmed(path.join(p.events, `${date}.json`));
  let events: LogEvent[] = [];
  if (confirmed) events = confirmed.events as unknown as LogEvent[];
  else if (record !== null && looseEvents) events = looseEvents;
  else if (record !== null) {
    const cfg = config ?? await readLogConfig(studioHome, alias);
    events = (await collectLogEvents(studioHome, alias, date, date, cfg)).events.filter((e) => e.date === date);
  }
  const summaryText = await readText(path.join(p.summaries, `${date}.md`));
  return {
    date,
    state: record === null ? null : confirmed ? "확정" : "잠정",
    record,
    events,
    summary: { state: await summaryState(p.summaries, date, record), text: summaryText },
  };
}

/** 확정 — 그날 사건을 보존한다. 이미 확정이면 거절. 오늘 뒤의 날은 확정할 수 없다. */
export async function confirmLogDay(studioHome: string, alias: string, date: string, now = new Date()): Promise<LogDayView> {
  assertLogDate(date);
  const p = logPaths(studioHome, alias);
  await fs.mkdir(p.events, { recursive: true });
  await withFileLock(p.lock, async () => {
    const config = await readLogConfig(studioHome, alias);
    if (date > zonedParts(now, config.tz)!.date) throw new Error("Log: 아직 오지 않은 날은 확정할 수 없다.");
    const collected = await collectLogEvents(studioHome, alias, date, date, config, now);
    const events = collected.events.filter((e) => e.date === date);
    if (!events.length) throw new Error("Log: 이 날은 사건이 없어 확정할 것이 없다.");
    const body: ConfirmedDay = { version: 1, project: alias, date, tz: config.tz, confirmedAt: now.toISOString(), sources: collected.sources, events: events as unknown as Record<string, unknown>[] };
    try { await fs.writeFile(path.join(p.events, `${date}.json`), `${JSON.stringify(body, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Log: 이미 확정한 날이다."); throw error; }
  });
  await buildLog(studioHome, alias, { from: date, to: date }, now);
  return readLogDay(studioHome, alias, date);
}

/** 확정 풀기 — 보존 파일을 events/archive/ 로 옮기고 다시 잠정으로 정리한다 (사용자가 눌렀을 때만). */
export async function reopenLogDay(studioHome: string, alias: string, date: string, now = new Date()): Promise<LogDayView> {
  assertLogDate(date);
  const p = logPaths(studioHome, alias);
  await withFileLock(p.lock, async () => {
    const file = path.join(p.events, `${date}.json`);
    if (await readText(file) === null) throw new Error("Log: 확정하지 않은 날이다.");
    const archive = path.join(p.events, "archive");
    await fs.mkdir(archive, { recursive: true });
    await fs.rename(file, path.join(archive, `${date}.${now.toISOString().replace(/[:.]/g, "-")}.json`));
  });
  await buildLog(studioHome, alias, { from: date, to: date }, now);
  return readLogDay(studioHome, alias, date);
}

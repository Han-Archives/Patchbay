import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { projectStudioDir } from "../studio/studioStore.js";

/**
 * 프로젝트별 Log (사용자 결정 2026-10-15 — 1안 화면 + 층별 폴더).
 *
 *   log/config.yaml          태그 규칙 · 요약 모델 · 시간대
 *   log/events/              원문 — 바뀌는 순간 남긴 변동(changes.jsonl), 확정한 날의 사건(<날짜>.json)
 *   log/records/<날짜>.md    파생 — 일일 기록. 잠정인 날은 다시 만든다
 *   log/index/<월>.json      파생 — 월별 색인
 *   log/summaries/<날짜>.md  LLM — 로컬 모델 요약. 다시 요약하면 앞 판은 archive/
 *   log/reports/*.md         저작물 — 보고서 바탕. 처음만 만들고 덮지 않는다
 */
export const LOG_DIR_NAME = "log";

export function logDir(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), LOG_DIR_NAME);
}

export function logPaths(studioHome: string, alias: string) {
  const root = logDir(studioHome, alias);
  return {
    root,
    config: path.join(root, "config.yaml"),
    events: path.join(root, "events"),
    changes: path.join(root, "events", "changes.jsonl"),
    records: path.join(root, "records"),
    index: path.join(root, "index"),
    summaries: path.join(root, "summaries"),
    reports: path.join(root, "reports"),
    lock: path.join(root, ".build"),
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

/** 실제로 있는 날짜만. 파일 이름이 되므로 다른 꼴은 거절한다. */
export function assertLogDate(date: string): string {
  if (!DATE.test(date) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error(`Log: 날짜 "${date}" 는 YYYY-MM-DD 가 아니다.`);
  return date;
}

export function assertLogMonth(month: string): string {
  if (!MONTH.test(month)) throw new Error(`Log: 달 "${month}" 는 YYYY-MM 이 아니다.`);
  assertLogDate(`${month}-01`);
  return month;
}

/** 그 시간대의 날짜와 시각 (YYYY-MM-DD, HH:mm). */
export function zonedParts(at: string | Date, tz: string): { date: string; time: string } | null {
  const when = typeof at === "string" ? new Date(at) : at;
  if (!Number.isFinite(when.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(when).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function monthDates(month: string): string[] {
  const out: string[] = [];
  for (let date = `${month}-01`; date.startsWith(month); date = addDays(date, 1)) out.push(date);
  return out;
}

export function weekday(date: string): string {
  return "일월화수목금토"[new Date(`${date}T12:00:00Z`).getUTCDay()]!;
}

/** ISO 주 (월요일 시작): `2026-W42`. */
export function isoWeekKey(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const year = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4, 12));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** `2026-W42` → 그 주 월요일 ~ 일요일. */
export function isoWeekRange(key: string): { from: string; to: string } {
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!m) throw new Error(`Log: 주 "${key}" 는 YYYY-Www 가 아니다.`);
  const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4, 12));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (Number(m[2]) - 1) * 7);
  const from = monday.toISOString().slice(0, 10);
  if (isoWeekKey(from) !== key) throw new Error(`Log: 주 "${key}" 는 없는 주다.`);
  return { from, to: addDays(from, 6) };
}

export async function atomicWrite(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, text, "utf8");
  await fs.rename(tmp, file);
}

export async function writeIfChanged(file: string, text: string): Promise<boolean> {
  try { if (await fs.readFile(file, "utf8") === text) return false; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await atomicWrite(file, text);
  return true;
}

export async function readText(file: string): Promise<string | null> {
  try { return await fs.readFile(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

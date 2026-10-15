/** 콘솔 Log 화면이 받는 모양 — 커널 `log/` 의 색인 · 날 보기와 같다 (브라우저는 커널을 들이지 않는다). */
export type LogKind = "진행" | "대화" | "할일" | "흐름도" | "메모" | "커밋";
export const LOG_KINDS: LogKind[] = ["진행", "대화", "할일", "흐름도", "메모", "커밋"];
/** 화면 이름표 — 저장된 종류 값은 그대로 두고 보이는 이름만 (사용자 요청 2026-10-15: 할일 → Tasks, 흐름도 → Workflow). */
export const LOG_KIND_LABEL: Record<LogKind, string> = { 진행: "진행", 대화: "대화", 할일: "Tasks", 흐름도: "Workflow", 메모: "메모", 커밋: "커밋" };
export const LOG_SOURCE_LABEL: Record<string, string> = { "할일": "Tasks", "흐름도 항목": "Workflow 항목" };

export interface LogEvent {
  id: string; date: string; time: string; at: string; kind: LogKind; change: string; title: string;
  detail?: string[]; excerpt?: string[]; omitted?: number; files?: string[];
  tags: string[]; tagFrom: Record<string, "연결" | "경로" | "낱말" | "입력">;
  ref: { type: string; id: string; fromSeq?: number; toSeq?: number };
}
export interface LogDayStat { state: "잠정" | "확정"; events: number; files: number; kinds: Record<string, number>; tags: Record<string, number>; fileTags: Record<string, number>; summary: "none" | "fresh" | "stale" }
export interface LogIndexEntry { id: string; date: string; time: string; kind: LogKind; change: string; title: string; tags: string[]; ref: LogEvent["ref"] }
export interface LogSource { name: string; state: "ok" | "empty" | "unavailable" | "error"; count: number; note?: string }
export interface LogMonthIndex { month: string; tags: string[]; sources: LogSource[]; days: Record<string, LogDayStat>; entries: LogIndexEntry[] }
export interface LogMonthView { month: string; today: string; tz: string; tags: string[]; model: string; index: LogMonthIndex | null }
export interface LogDayView { date: string; state: "잠정" | "확정" | null; record: string | null; events: LogEvent[]; summary: { state: "none" | "fresh" | "stale"; text: string | null } }

const TAG_COLORS: Record<string, string> = { UI: "#a78bfa", 데이터: "#6fc3df", 서버: "#e3a35a", 문서: "#8ed8b0", Agent: "#ef7b6e" };
const EXTRA = ["#f0a3c8", "#c9d36b", "#7fb2ff", "#d9a46b", "#9ad0c2"];
export function tagColor(tag: string): string {
  if (TAG_COLORS[tag]) return TAG_COLORS[tag]!;
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return EXTRA[h % EXTRA.length]!;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1, 12));
  return d.toISOString().slice(0, 7);
}

/** 월요일 시작 달력 칸. 빈칸은 null. */
export function mondayCells(month: string): (string | null)[] {
  const first = new Date(`${month}-01T12:00:00Z`);
  const cells: (string | null)[] = Array((first.getUTCDay() + 6) % 7).fill(null);
  for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function weekDates(date: string): string[] {
  const monday = addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function isoWeekKey(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const year = d.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 4, 12));
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7) + 3);
  return `${year}-W${String(1 + Math.round((d.getTime() - first.getTime()) / (7 * 86_400_000))).padStart(2, "0")}`;
}

export function weekdayLabel(date: string): string {
  return "일월화수목금토"[new Date(`${date}T12:00:00Z`).getUTCDay()]!;
}

/** 요약 · 보고서용 작은 마크다운 — 머리(##) · 목록(-) · 인용(>) · 표(|) · 문단만. 머리말(---)은 뺀다. */
export type MdBlock = { kind: "h"; level: number; text: string } | { kind: "li"; text: string } | { kind: "quote"; text: string } | { kind: "table"; rows: string[][] } | { kind: "p"; text: string };
export function parseMiniMarkdown(text: string): MdBlock[] {
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const blocks: MdBlock[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { blocks.push({ kind: "h", level: h[1]!.length, text: h[2]! }); continue; }
    if (/^\s*[-*]\s+/.test(line)) { blocks.push({ kind: "li", text: line.replace(/^\s*[-*]\s+/, "") }); continue; }
    if (line.startsWith(">")) { blocks.push({ kind: "quote", text: line.replace(/^>\s?/, "") }); continue; }
    if (line.startsWith("|")) {
      const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
      const last = blocks[blocks.length - 1];
      if (last?.kind === "table") last.rows.push(cells); else blocks.push({ kind: "table", rows: [cells] });
      continue;
    }
    blocks.push({ kind: "p", text: line.replace(/^_\((.*)\)_$/, "($1)") });
  }
  return blocks;
}

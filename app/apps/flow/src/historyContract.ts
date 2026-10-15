export interface HistoryRow {
  id: string; date?: string; timestamp: string; tags: string[]; content: string;
  source: "manual" | "progress"; asked?: string; did?: string;
}
export function localHistoryDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function historyRowDate(row: HistoryRow): string {
  if (row.date) return row.date;
  const date = new Date(row.timestamp);
  return Number.isFinite(date.getTime()) ? localHistoryDate(date) : "";
}
export function historyMonthCells(month: string): (string | null)[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
  const first = new Date(`${month}-01T12:00:00`);
  if (!Number.isFinite(first.getTime())) return [];
  const last = new Date(first); last.setMonth(last.getMonth() + 1, 0);
  const cells: (string | null)[] = Array(first.getDay()).fill(null);
  for (let day = 1; day <= last.getDate(); day++) cells.push(`${month}-${String(day).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}
export function shiftHistoryMonth(month: string, delta: number): string {
  const date = new Date(`${month}-01T12:00:00`); date.setMonth(date.getMonth() + delta);
  return localHistoryDate(date).slice(0, 7);
}

/** 태그는 진행 상태가 아니라 변경된 기능 영역을 나타낸다. */
export const HISTORY_DOMAINS = ["UI", "LLM", "대화창", "할일", "대시보드", "데이터", "서버", "문서", "프로젝트"] as const;
export function historyDomainTags(entry: { tags?: string[]; content?: string; summary?: string; step?: string; skill?: string; asked?: string; did?: string }): string[] {
  const explicit = [...new Set((entry.tags ?? []).filter(tag => (HISTORY_DOMAINS as readonly string[]).includes(tag)))];
  if (explicit.length) return explicit;
  const text = [entry.content, entry.summary, entry.step, entry.skill, entry.asked, entry.did].filter(Boolean).join(" ");
  const domains: [string, RegExp][] = [
    ["UI", /\bui\b|화면|디자인|시안|버튼|아이콘|모바일|레이아웃/i],
    ["LLM", /\bllm\b|codex|claude|qwen|모델|에이전트|agent|토큰|구독/i],
    ["대화창", /대화|채팅|상담/],
    ["할일", /할\s?일|todo|자동\s?업무/i],
    ["대시보드", /대시보드|dashboard|history|캘린더/i],
    ["데이터", /데이터|저장|인덱스|색인|스키마|\bdb\b|\brag\b|검색|백업/i],
    ["서버", /서버|\bapi\b|http|\bsse\b|포트|인증|접속/i],
    ["문서", /문서|보고서|요구사항|기획|규칙/],
  ];
  const matched = domains.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
  return matched.length ? matched.slice(0, 4) : ["프로젝트"];
}

/** Browser-only navigation preferences. Never contain document text, drafts or model requests. */
export const WORK_PLACES = {
  design: "설계", build: "구현", test: "테스트", graph: "지식 그래프", docs: "RAG",
  architecture: "아키텍처", files: "폴더 · 문서", log: "Log", plan: "기획 문서", board: "배치도",
} as const;
export type WorkPlace = keyof typeof WORK_PLACES;
export type WorkspacePlace = WorkPlace | "dashboard" | "home";
export interface WorkLocation { version: 1; alias: string; place: WorkPlace; logDate?: string }
export interface NavigationStorage { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }
export const lastWorkKey = (alias: string) => "patchbay.last-work." + alias;
export function isWorkPlace(value: unknown): value is WorkPlace {
  return typeof value === "string" && Object.hasOwn(WORK_PLACES, value);
}
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function workLocation(alias: string, place: unknown, logDate?: string | null): WorkLocation | null {
  if (!alias || !isWorkPlace(place)) return null;
  return { version: 1, alias, place, ...(place === "log" && validDate(logDate) ? { logDate } : {}) };
}
export function readLastWork(alias: string, storage?: NavigationStorage | null): WorkLocation | null {
  if (!alias || !storage) return null;
  try {
    const raw: unknown = JSON.parse(storage.getItem(lastWorkKey(alias)) ?? "null");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    if (value.version !== 1 || value.alias !== alias || (value.logDate !== undefined && !validDate(value.logDate))) return null;
    return workLocation(alias, value.place, value.logDate as string | undefined);
  } catch { return null; }
}
export function rememberWork(location: WorkLocation, storage?: NavigationStorage | null): void {
  if (!storage) return;
  try { storage.setItem(lastWorkKey(location.alias), JSON.stringify(location)); } catch { /* React state still resumes within this session. */ }
}
export type ResumeAction =
  | { kind: "place"; location: WorkLocation; label: "이어하기"; title: string }
  | { kind: "chat"; label: "이어하기"; title: string }
  | { kind: "start"; label: "시작하기"; title: string };
/** One decision supplies both the button's label and its actual action. */
export function resolveResume(alias: string, saved: WorkLocation | null, hasRooms: boolean): ResumeAction {
  if (saved?.alias === alias && isWorkPlace(saved.place)) return { kind: "place", location: saved, label: "이어하기",
    title: "최근 작업 화면 · " + WORK_PLACES[saved.place] + (saved.logDate ? " · " + saved.logDate : "") };
  return hasRooms ? { kind: "chat", label: "이어하기", title: "현재 프로젝트의 대화 이어하기" }
    : { kind: "start", label: "시작하기", title: "현재 프로젝트의 대화 시작하기" };
}
export function readRoomLink(hash: string): { alias: string; id: string } | null {
  const match = /^#room\/([^/]+)\/([^/]+)$/.exec(hash);
  if (!match) return null;
  try {
    const alias = decodeURIComponent(match[1]!), id = decodeURIComponent(match[2]!);
    if (!alias || !id || /[\x00-\x1f]/.test(alias + id)) return null;
    return { alias, id };
  } catch { return null; }
}

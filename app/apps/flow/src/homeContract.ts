import type { WorkspaceProject } from "./workspaceContract.js";

export type HomeStatus = "turn" | "running" | "problem" | "normal";
export interface HomeTodo { id: string; title: string; alias: string; order: number; at: string }
export interface HomeOutput {
  alias: string; path: string; title: string; kind: "문서" | "화면" | "이미지" | "PDF";
  at: string; excerpt: string; matches: boolean;
}
export interface HomeProject extends WorkspaceProject {
  description: string; version: number | null; appUrl: string | null;
  todos: HomeTodo[]; outputs: HomeOutput[]; outputCount: number;
  outputLimited: boolean; status: HomeStatus; matches: boolean; issues: string[];
}
export interface HomeExecutionGroup { date: string; alias: string; source: "Claude" | "Codex" | "테스트"; count: number; failed: number }
export interface HomeResponse {
  projects: HomeProject[]; month: string; today: string;
  execution: { days: Record<string, number>; total: number; activeDays: number; rejected: number; groups: HomeExecutionGroup[]; unavailable: string[]; commandsConnected: boolean };
}

/** App addresses are navigation only: never execute scripts or embed credentials. */
export function appLaunchUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
export function dayKey(date: Date): string { return `${monthKey(date)}-${String(date.getDate()).padStart(2, "0")}`; }
export function validMonth(value: string): boolean { return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 1970; }
export function projectCycle(project: WorkspaceProject): "design" | "build" | "test" | "review" {
  return (["design", "build", "test"] as const).find(id => project.stages.find(s => s.id === id)?.tone !== "done") ?? "review";
}
export function outputUrl(output: Pick<HomeOutput, "alias" | "path">): string {
  return `/api/project-file/${encodeURIComponent(output.alias)}/${output.path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Markdown links are relative to the document, while ChatText expects project-relative paths. */
export function outputDocumentText(text: string, source: string): string {
  return text.replace(/(!?\[[^\]\n]*\]\()([^\s)]+)(\))/g, (whole, start: string, target: string, end: string) => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(target)) return whole;
    const parts = source.split("/").slice(0, -1);
    for (const segment of target.split("/")) {
      if (segment === "..") { if (!parts.length) return whole; parts.pop(); }
      else if (segment !== "." && segment !== "") parts.push(segment);
    }
    return `${start}${parts.join("/")}${end}`;
  });
}

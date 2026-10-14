import { requirementDisplay } from "./display.js";

/**
 * 0 구조에 보이는 「상담에서 적은 설계」 (사용자 요청 2026-10-07 — 옛 기록 대신 지금 적은 것, 특히 요구사항).
 * 초안에서 결정적으로 뽑는다. 초안이 없으면 null.
 */
export interface DesignSummary {
  goal: string;
  requirements: { id: string; text: string; priority: string | null }[];
  users: string[];
  scene: string;
  environment: string;
  screen: string;
  openQuestions: number;
}

type Rec = Record<string, unknown>;
const obj = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const PRIORITY: Record<string, string> = { must: "꼭", should: "있으면 좋음", could: "나중에" };

export function designSummary(draft: unknown): DesignSummary | null {
  if (!draft || typeof draft !== "object") return null;
  const ir = obj(draft);
  const env = obj(ir.environment);
  const ui = obj(ir.interface);
  return {
    goal: str(ir.goal),
    requirements: list(ir.requirements).map((q) => ({
      id: str(q.id),
      text: requirementDisplay(q).short,
      priority: PRIORITY[str(q.priority)] ?? null,
    })),
    users: list(ir.stakeholders).map((s) => str(s.role)).filter(Boolean),
    scene: str(ir.jobStory),
    environment: Object.keys(env).length
      ? [str(env.location) === "remote" ? `원격 ${str(obj(env.remote).host)}` : "이 컴퓨터", str(env.language), str(env.runtime)].filter(Boolean).join(" · ")
      : "",
    screen: [Array.isArray(ui.entry) ? (ui.entry as string[]).join(" · ") : "", str(ui.output)].filter(Boolean).join(" — "),
    openQuestions: Array.isArray(ir.openQuestions) ? ir.openQuestions.length : 0,
  };
}

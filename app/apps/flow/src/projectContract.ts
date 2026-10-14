import type { DesignSummary } from "@patchbay/core";

export const SOURCE_ROW_LIMIT = 40;

export interface AtlasCountsView {
  skills: number;
  rules: number;
  unlabeledPorts: number;
  patchesWithoutWire: number;
  wiresWithoutPatch: number;
}

export interface GapView {
  from: string;
  to: string;
  kind: string;
}

export interface ProgressCurrentView {
  project: string;
  summary: string;
  skill?: string;
  step?: string;
  /** What the person asked for, when the host model recorded it. */
  asked?: string;
  /** What actually shipped for that request. */
  did?: string;
  timestamp: string;
}

/** overlay.yaml `decisions` as shown on the project tab. Not an Atlas section. */
export interface DecisionView {
  id: string;
  concept: string;
  summary: string;
  rationale?: string;
  date?: string;
}

export type ProcessOutputView = "table" | "diagram" | "text";

export interface ProcessStepView {
  id: string;
  label: string;
  output: ProcessOutputView;
  filled: boolean;
}

export const PLAN_BEATS: Array<{ id: string; label: string; output: ProcessOutputView }> = [
  { id: "plan-goal", label: "목표", output: "table" },
  { id: "plan-direction", label: "방향", output: "table" },
  { id: "plan-proceed", label: "실행 단계", output: "diagram" },
];

export function isPlanBeatId(id: string): boolean {
  return PLAN_BEATS.some((beat) => beat.id === id);
}

export function planBeatById(id: string): (typeof PLAN_BEATS)[number] | undefined {
  if (id === "plan" || id === "process") return PLAN_BEATS[0];
  return PLAN_BEATS.find((beat) => beat.id === id);
}

export function nextPlanBeatId(id: string): string | null {
  const index = PLAN_BEATS.findIndex((beat) => beat.id === id);
  if (index < 0 || index >= PLAN_BEATS.length - 1) return null;
  return PLAN_BEATS[index + 1]!.id;
}

export function prevPlanBeatId(id: string): string | null {
  const index = PLAN_BEATS.findIndex((beat) => beat.id === id);
  if (index <= 0) return null;
  return PLAN_BEATS[index - 1]!.id;
}

export type PlanHostKind = "cursor" | "claude";
export type PlanHostStatus = "running" | "done";

export interface PlanHostView {
  host: PlanHostKind;
  beatId: string;
  openedAt: string;
  status: PlanHostStatus;
  doneAt?: string;
  completed?: string[];
}

export function completedPlanBeatIds(host: PlanHostView | null): string[] {
  if (!host) return [];
  const allowed = new Set(PLAN_BEATS.map((beat) => beat.id));
  const ids = new Set((host.completed ?? []).filter((id) => allowed.has(id)));
  return PLAN_BEATS.map((beat) => beat.id).filter((id) => ids.has(id));
}

export function planBeatPhase(host: PlanHostView | null, beatId: string): "idle" | "running" | "done" {
  const completed = new Set(completedPlanBeatIds(host));
  if (completed.has(beatId)) return "done";
  if (host?.status === "running" && host.beatId === beatId) return "running";
  const current = PLAN_BEATS.find((beat) => !completed.has(beat.id));
  if (current?.id === beatId) return "running";
  return "idle";
}

export interface ProcessView {
  configured: boolean;
  goal: string;
  folders: string[];
  steps: ProcessStepView[];
  edges: Array<{ from: string; to: string }>;
  bind: Record<string, string>;
  briefFilled: boolean;
  planBeats: ProcessStepView[];
  host: PlanHostView | null;
}

export const EMPTY_PROCESS_VIEW: ProcessView = {
  configured: false,
  goal: "",
  folders: [],
  steps: [],
  edges: [],
  bind: {},
  briefFilled: false,
  planBeats: PLAN_BEATS.map((beat) => ({ ...beat, filled: false })),
  host: null,
};

export interface ProjectViewOk {
  status: "ok";
  alias: string;
  path: string;
  counts: AtlasCountsView;
  sections: {
    skills: string[];
    rules: string[];
    unlabeledPorts: string[];
    matched: GapView[];
    patchesWithoutWire: GapView[];
    wiresWithoutPatch: GapView[];
  };
  progress: {
    current: ProgressCurrentView | null;
    history: ProgressCurrentView[];
  };
  currentLine: string;
  decisions: DecisionView[];
  process: ProcessView;
  clarity: number | null;
  git: { branch: string; head: string };
  /** 상담에서 적은 설계 (초안). 없으면 null — 0 구조 맨 위에 보인다 (사용자 요청 2026-10-07). */
  design: DesignSummary | null;
}

export interface ProjectViewUnscanned {
  status: "unscanned";
  alias: string;
  path: string;
  process: ProcessView;
  design: DesignSummary | null;
  /**
   * 스캔 결과 파일은 있는데 읽지 못했다(JSON · 형식 오류). 없음과 같이 「다시 스캔」으로 새로 쓰면
   * 풀리지만, 사람에게는 「아직 없다」가 아니라 「깨졌다」고 말해야 한다.
   */
  broken?: string;
}

/** 스캔 결과 파일이 깨져서 난 오류인가 — JSON 문법 또는 스키마. 그 밖의 I/O 오류는 아니다. */
export function isBrokenScanError(error: unknown): boolean {
  return error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError");
}

export type ProjectViewResponse = ProjectViewOk | ProjectViewUnscanned;

export function isProjectViewOk(body: ProjectViewResponse): body is ProjectViewOk {
  return body.status === "ok";
}

/**
 * 구조 화면이 항목 설명(`/api/project/ports`)을 다시 읽을지 정하는 열쇠. 구조 칸(항목 · 연결)이
 * 바뀔 때만 달라진다 — 진행 기록 같은 다른 파일이 바뀌어 화면이 새로 고쳐져도 그대로라서, 그때마다
 * 모든 항목 파일을 다시 읽지 않는다.
 */
export function structureKey(view: Pick<ProjectViewOk, "alias" | "sections">): string {
  return JSON.stringify([view.alias, view.sections]);
}

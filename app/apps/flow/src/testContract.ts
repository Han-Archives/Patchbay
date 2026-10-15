/**
 * 0 대시보드 · 3 테스트가 화면과 서버 사이에 주고받는 모양 (사용자 결정 2026-10-08).
 * 화면이 읽어도 되는 타입만 — 서버 모듈(dashboardView.ts · testActivity.ts)을 화면이 가져오지 않게.
 */

export type EvalOutcome = "pass" | "fail" | "todo" | "skip";

export interface DashboardMetric {
  field: string;
  label: string;
  /** 내놓는 개념이면 앞에 둔다. */
  output: boolean;
  kind: "number" | "text" | "count";
  value: number | string;
}

export interface SystemMap {
  nodes: { id: string; label: string; layer: string; ref?: string; detail: [string, string][] }[];
  edges: { from: string; to: string; label?: string }[];
}

export interface DashboardView {
  progressLog?: { timestamp: string; summary: string; step?: string; asked?: string; did?: string }[];
  system?: SystemMap | null;
  alias: string;
  design: { version: number | null; requirements: number; evals: number; nodes: number } | null;
  requirements: { id: string; summary: string; priority: string | null; evals: string[]; node: string | null }[];
  tests: { at: string; results: Record<string, EvalOutcome>; passed: number; failed: number; todo: number } | null;
  nodes: { id: string; passed: boolean }[];
  agent: { reachable: boolean; url: string; threadId: string | null; updatedAt: string | null; metrics: DashboardMetric[] };
  attention: string[];
  app: string | null;
}

export interface TestActivityEntry {
  runId: string;
  threadId: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  /** 이 실행에 들어온 State 칸 (사람이 넣은 답 등). */
  input: string[];
  /** 값을 바꾼 노드 — 실제로 일했다. */
  worked: string[];
  /** 돌았지만 할 일이 없어 건너뛴 노드. */
  skipped: string[];
}

export interface TestActivity {
  reachable: boolean;
  url: string;
  graphId: string | null;
  threads: number;
  entries: TestActivityEntry[];
  /** 설계의 노드 중 한 번 이상 일한 것. */
  passed: string[];
  /** 설계의 노드 전부. */
  total: string[];
  error?: string;
}

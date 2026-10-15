import { phaseOf } from "./irContract.js";

/**
 * 작업 공간의 단계 띠(셸 시안 나 · 기억.md 「디자인 개편 — 셸 재구성」)의 계약.
 *
 * 2026-10-08 사용자 결정으로 순서를 바꿨다(기획 20261008a §2): 0 대시보드 · 1 설계 · 2 구현 · 3 테스트 ·
 * 4 지식 그래프 · 5 문서 호출. 지식 그래프와 문서 호출은 프로젝트가 실제로 돈 뒤에야 확인할 수 있으므로
 * 테스트 뒤로 갔고, 설계의 노드를 모두 한 번 이상 지난 뒤 열린다. 0은 「구조」가 아니라 이 프로젝트의 대시보드다.
 */
export const WORKSPACE_STAGES = [
  { id: "dashboard", num: "0", label: "대시보드", hint: "이 프로젝트가 지금 어떤지 — 진행 · 지표 · 먼저 볼 것" },
  { id: "design", num: "1", label: "설계", hint: "요구사항을 IR로 — 노드·권한·평가" },
  { id: "build", num: "2", label: "구현", hint: "IR에서 LangGraph 뼈대를 만들고 노드를 채운다" },
  { id: "test", num: "3", label: "테스트", hint: "만든 에이전트를 여기서 쓰고, 실행이 쌓인다" },
  { id: "graph", num: "4", label: "지식 그래프", hint: "프로젝트의 지식 그래프를 탐색합니다" },
  { id: "docs", num: "5", label: "문서 호출", hint: "관계를 따라 문서를 찾고 근거 경로를 낸다 — 노드를 다 지난 뒤" },
] as const;

export type StageId = (typeof WORKSPACE_STAGES)[number]["id"];

/** 지남 · 지금 · 막힘 · 잠김(앞 단계의 출력이 아직 없다). */
export type StageTone = "done" | "now" | "blocked" | "locked";

export interface StageState {
  id: StageId;
  tone: StageTone;
  status: string;
  /** 짧은 상태 뒤의 사유. 화면은 상태 아래 한 줄로 둔다. */
  detail?: string;
  /** 이 칸이 지금 칸일 때 사람이 할 일. 잠긴 칸은 무엇을 기다리는지 적는다. */
  next: string;
}

/** 초안이 IR로 읽히는지에 따라 아는 것이 다르다. */
export type DraftFact =
  | { readable: false; complete: number; total: number; error: string }
  | { readable: true; passed: number; total: number; failedGates: string[] };

/** 단계 상태를 정하는 데 쓰는 사실 — 전부 파일에서 읽은 것이다. */
export interface ProjectFacts {
  /** 스캔 결과(`inferred.json`). 항목 수, 깨졌으면 "broken", 없으면 null. */
  scan: { ports: number } | "broken" | null;
  /** 승인본(`overlay.ir`). 없으면 null. */
  adopted: { version: number | null } | null;
  /** 승인본이 있는데 IR로 안 읽힌다. */
  adoptedBroken: boolean;
  /** 초안(`ir.proposed.yaml`). 없으면 null. */
  draft: DraftFact | null;
  /** `src/agent/` 에 생성된 뼈대 파일이 하나라도 있다. */
  scaffold: boolean;
  /** 생성기가 남긴 빈 노드 표시가 몇 개 남았나 — graph.ts 를 못 읽으면 null. */
  filled?: { total: number; empty: number } | null;
  /** 수집된 실행 기록 수. */
  runs: number;
  /** 테스트에서 실제로 일한 설계 노드 수 (`test/passed-nodes.json`). */
  nodes?: { total: number; passed: number };
}

export interface WorkspaceLatest {
  summary: string;
  step?: string;
  at: string;
}

export interface WorkspaceProject {
  alias: string;
  name?: string;
  path: string;
  stages: StageState[];
  /** 지금 서 있는 단계 — 처음으로 「지남」이 아닌 칸. */
  current: StageId;
  /** 레일의 점 (`attentionOf`). */
  attention: Attention;
  /** 레일에서 숨겼다 (`studio.yaml`의 `hidden`). 등록은 그대로다. */
  hidden?: boolean;
  latest: WorkspaceLatest | null;
}

export interface WorkspaceResponse {
  projects: WorkspaceProject[];
}

function gateName(cellId: string): string {
  const phase = phaseOf(cellId);
  return phase !== null ? `Phase ${phase}` : "최종 검사";
}

function designStage(facts: ProjectFacts): StageState {
  if (facts.adoptedBroken) {
    return {
      id: "design",
      tone: "blocked",
      status: "승인본이 IR로 안 읽힌다",
      next: "overlay.ir 을 고치거나 초안을 다시 채택한다",
    };
  }
  if (facts.adopted) {
    const version = facts.adopted.version === null ? "" : ` · v${facts.adopted.version}`;
    return {
      id: "design",
      tone: "done",
      status: `채택됨${version}`,
      ...(facts.draft ? { detail: "새 초안이 있다" } : {}),
      next: facts.draft ? "새 초안을 승인본과 견주고, 바꿀 만하면 채택한다" : "설계를 바꿀 때 초안을 새로 쓴다",
    };
  }
  const draft = facts.draft;
  if (!draft) return { id: "design", tone: "now", status: "시작 전", next: "Phase 1(목표)부터 초안을 적는다" };
  if (!draft.readable) {
    // 칸을 다 적었는데도 안 읽히면 적는 중이 아니라 막힌 것이다.
    if (draft.complete === draft.total) {
      return {
        id: "design",
        tone: "blocked",
        status: "초안이 IR로 안 읽힌다",
        detail: draft.error,
        next: "초안 파일의 형식 오류를 고친다",
      };
    }
    return {
      id: "design",
      tone: "now",
      status: `초안 작성 중 · Phase ${draft.complete} / ${draft.total} 다 적음`,
      next: "덜 적은 Phase를 마저 적는다",
    };
  }
  if (draft.failedGates.length === 0) {
    return {
      id: "design",
      tone: "now",
      status: `검사 ${draft.passed} / ${draft.total} 통과 · 채택 대기`,
      next: "최종 검사를 확인하고 채택한다 — 채택은 사람이 누른다",
    };
  }
  const gates = draft.failedGates.map(gateName).join(" · ");
  return {
    id: "design",
    tone: "blocked",
    status: `검사 ${draft.passed} / ${draft.total}`,
    detail: `돌아갈 곳: ${gates}`,
    next: `${gates}을 고치고 다시 검사한다`,
  };
}

/** 0 대시보드 — 단계라기보다 늘 보는 곳이다. 스캔 전이면 첫 할 일이 스캔이라 「지금」으로 둔다. */
function dashboardStage(facts: ProjectFacts): StageState {
  if (facts.scan === "broken") {
    return {
      id: "dashboard",
      tone: "blocked",
      status: "스캔 결과가 깨졌다",
      next: "대시보드의 레포 구조 칸에서 「다시 스캔」을 누른다",
    };
  }
  if (facts.scan === null) {
    return { id: "dashboard", tone: "now", status: "스캔 전", next: "대시보드의 레포 구조 칸에서 「스캔」을 누른다" };
  }
  const parts = [facts.adopted?.version ? `설계 v${facts.adopted.version}` : null, facts.nodes?.total ? `노드 ${facts.nodes.passed}/${facts.nodes.total} 지남` : null]
    .filter(Boolean)
    .join(" · ");
  return {
    id: "dashboard",
    tone: "done",
    status: parts || `스캔됨 · 항목 ${facts.scan.ports}`,
    next: "지금 할 일은 다음 단계에 있다",
  };
}

/**
 * 각 단계의 입력은 앞 단계의 출력뿐이다 (기획 20260928a §2). 그래서 앞 칸이 「지남」이
 * 아니면 뒤 칸은 잠긴다 — 예외가 둘이다. 실행 기록은 설계 없이도 들어올 수 있고, 들어온
 * 것을 숨기면 있는 사실을 지운다. 그리고 0 구조는 1 설계를 잠그지 않는다 — IR은 스캔
 * 결과를 입력으로 먹지 않는다(명세 20260929a §3). 스캔은 구조를 보는 길이지 설계의 재료가 아니다.
 */
export function stagesOf(facts: ProjectFacts): StageState[] {
  const dashboard = dashboardStage(facts);
  const design = designStage(facts);
  const designed = design.tone === "done";
  const filled = facts.filled ?? null;

  const build: StageState = !designed
    ? { id: "build", tone: "locked", status: "설계 채택 뒤", next: "1 설계가 채택되기를 기다린다" }
    : !facts.scaffold
      ? {
          id: "build",
          tone: "now",
          status: "뼈대 생성 전",
          next: "구현 화면에서 「뼈대 생성」을 누른다 — state · graph · 평가 테스트가 생긴다",
        }
      : filled && filled.empty > 0
        ? {
            id: "build",
            tone: "now",
            status: `노드 채우는 중 · ${filled.total - filled.empty}/${filled.total}`,
            next: "생성된 평가 테스트가 통과하도록 빈 노드를 채운다",
          }
        : {
            id: "build",
            tone: "done",
            status: filled ? `노드 ${filled.total}/${filled.total} 채움` : "뼈대 생성됨",
            next: "설계를 바꾸면 2.6 대조로 어긋남을 본다",
          };
  const built = build.tone === "done";

  const nodes = facts.nodes ?? { total: 0, passed: 0 };
  const allPassed = nodes.total > 0 && nodes.passed >= nodes.total;
  const passedText = nodes.total ? `노드 ${nodes.passed}/${nodes.total} 지남` : "노드 정보 없음";
  const test: StageState =
    !built && facts.runs === 0 && nodes.passed === 0
      ? { id: "test", tone: "locked", status: "구현 뒤", next: "2 구현에서 노드를 다 채우기를 기다린다" }
      : allPassed
        ? { id: "test", tone: "done", status: passedText, next: "계속 쓰면서 실행을 쌓는다 — 지식 그래프 · 문서 호출이 열렸다" }
        : {
            id: "test",
            tone: "now",
            status: `${passedText}${facts.runs ? ` · 실행 기록 ${facts.runs}건` : ""}`,
            next: "테스트의 사용 창에서 에이전트를 써서 설계의 노드를 모두 한 번 이상 지나게 한다",
          };

  const waiting = `테스트에서 설계의 노드를 모두 한 번 이상 지나야 열린다 — 지금 ${passedText}`;
  const graph: StageState = allPassed
    ? { id: "graph", tone: "now", status: "열림", next: "프로젝트의 지식 그래프를 확인합니다" }
    : { id: "graph", tone: "locked", status: `노드 ${nodes.passed}/${nodes.total || "?"} 지난 뒤`, next: waiting };
  const docs: StageState = allPassed
    ? { id: "docs", tone: "now", status: "열림", next: "출발점을 넣고 문서 호출이 근거(지나온 관계)를 내는지 본다" }
    : { id: "docs", tone: "locked", status: `노드 ${nodes.passed}/${nodes.total || "?"} 지난 뒤`, next: waiting };

  return [dashboard, design, build, test, graph, docs];
}

/**
 * 레일의 프로젝트 점. 막힌 칸이 있을 때만 「막힘」(빨간 네모), 아니면 점이 없다.
 * 레일 오른쪽 아래 주황 점은 「LLM 실행 중」(`/api/running`) 하나만 뜻한다 — 2026-10-15까지 있던 「진행」 점이
 * 같은 주황 · 같은 자리여서, 손을 댄 프로젝트마다 늘 실행 중처럼 보였다(사용자 지적). 진행은 단계 띠가 보여 준다.
 */
export type Attention = "blocked" | null;

export function attentionOf(stages: readonly StageState[]): Attention {
  return stages.some((stage) => stage.tone === "blocked") ? "blocked" : null;
}

export function currentStage(stages: readonly StageState[]): StageId {
  return (stages.find((stage) => stage.tone !== "done") ?? stages[stages.length - 1]!).id;
}

export function stageMeta(id: StageId) {
  return WORKSPACE_STAGES.find((stage) => stage.id === id)!;
}

/** 레일 버튼은 이름의 첫 글자만, 전체 이름은 title·aria-label로 표시한다. */
export function projectInitials(name: string): string {
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name.trim());
  return segments[Symbol.iterator]().next().value?.segment ?? "?";
}

const PROJECT_ICON_COLORS = ["#b9a4eb", "#89b4e8", "#8ec9aa", "#e2b78c", "#df9fb0", "#87c6d2", "#d9ca83", "#a9b0eb"] as const;

/** 이름이나 목록 순서가 바뀌어도 같은 프로젝트는 같은 색을 사용한다. */
export function projectIconColor(alias: string): string {
  let hash = 0;
  for (const character of alias) hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0;
  return PROJECT_ICON_COLORS[hash % PROJECT_ICON_COLORS.length]!;
}

import type { TodoItem } from "@patchbay/core";
import type { EvalsReviewResponse } from "./evalsContract.js";
import type { StageState } from "./workspaceContract.js";

export type ActionTodo = TodoItem & { running?: boolean; turn?: string };
export interface UserAction {
  alias: string;
  title: string;
  reason: string;
  steps: string[];
  target:
    | { kind: "evals"; version: number }
    | { kind: "todo"; id: string; roomId?: string; turn?: string }
    | { kind: "stage"; place: "design" | "build" | "test"; designTab?: "consult" | "prd" };
}
export interface ActionRequest { action: UserAction; nonce: number }

const TODO_STEPS: Record<string, string[]> = {
  "준비본 검토": ["수행 계획과 산출물, 완료 조건을 읽어 주세요.", "맞으면 「그대로 진행」, 바꿀 점이 있으면 「수정 요청」, 나중에 할 일은 「보류」를 눌러 주세요."],
  "준비본 재검토": ["앞선 결과가 바뀌어 준비본을 다시 확인해야 합니다.", "「다시 준비」로 갱신한 뒤 산출물을 검토해 주세요."],
  "준비 실패 확인": ["준비 결과에 표시된 실패 이유를 확인해 주세요.", "수정할 내용을 적거나 「다시 준비」를 눌러 주세요."],
  "답 확인": ["대화의 최근 답과 결과물을 확인해 주세요.", "고칠 점은 입력창에 적어 보내고, 끝났으면 할일의 「완료」를 눌러 주세요."],
  "오류 확인": ["대화에 표시된 오류 내용을 확인해 주세요.", "필요한 정보를 보완해 입력창에서 다시 요청해 주세요."],
  "실행 승인": ["실행 내용과 적용 대상을 확인해 주세요.", "실행 패널에서 확인 버튼을 눌러 다음 단계로 진행해 주세요."],
  "실행 실패 확인": ["실행 패널의 실패 이유와 검증 결과를 확인해 주세요.", "구현 오류는 수정 단계로, 요구사항 변경은 상담으로 보내 주세요."],
};

function todoAction(alias: string, todo: ActionTodo): UserAction {
  return {
    alias, title: todo.title, reason: todo.turn ? `지금은 「${todo.turn}」 차례입니다.` : todo.detail || "이 할일을 진행할 차례입니다.",
    steps: TODO_STEPS[todo.turn ?? ""] ?? ["할일의 요구사항과 지금까지의 대화를 확인해 주세요.", "입력창에 진행할 내용이나 필요한 결정을 적어 보내 주세요."],
    target: { kind: "todo", id: todo.id, ...(todo.roomId ? { roomId: todo.roomId } : {}), ...(todo.turn ? { turn: todo.turn } : {}) },
  };
}

/** 사람의 승인·오류 확인 → 평가 채점 → 답 확인·다음 할일 → 현재 단계. 작업 중인 일은 고르지 않는다. */
export function nextUserAction(alias: string, todos: ActionTodo[], evals: EvalsReviewResponse, stages: StageState[], hasPrd: boolean): UserAction | null {
  const active = todos.filter(t => !t.done && !t.inactive && !t.deletedAt && !t.running);
  const decision = active.find(t => t.turn && t.turn !== "답 확인");
  if (decision) return todoAction(alias, decision);
  const tested = ["design", "build", "test"].every(id => stages.some(s => s.id === id && s.tone === "done"));
  if (tested && evals.alias === alias && evals.status === "ok") {
    const recorded = new Set(evals.current?.run.irVersion === evals.irVersion ? evals.current.run.results.map(r => r.evalId) : []);
    const remaining = evals.evals.filter(e => !recorded.has(e.id)).length;
    if (remaining) return {
      alias, title: `v${evals.irVersion} 평가 채점·기록`,
      reason: "구현과 테스트를 마쳤습니다. 이제 실제 동작의 근거를 보고 결과를 판정해 주세요.",
      steps: ["표시된 항목의 기대 동작과 「한 일 · 본 것」, 첨부 이미지를 확인해 주세요.", "통과 · 실패 · 건너뜀 중 하나를 고르고, 필요한 이유를 메모해 주세요.", `채점을 마치면 「v${evals.irVersion}에 기록」을 눌러 저장해 주세요. 일부만 기록하고 나중에 이어갈 수도 있습니다.`],
      target: { kind: "evals", version: evals.irVersion },
    };
  }
  const todo = active.find(t => t.turn) ?? active[0];
  if (todo) return todoAction(alias, todo);
  // 미완료 할일이 실행 중이면 완료를 기다린다. 같은 일을 다시 요청하도록 유도하지 않는다.
  if (todos.some(t => !t.done && !t.inactive && !t.deletedAt && t.running)) return null;
  const stage = stages.find(s => ["design", "build", "test"].includes(s.id) && s.tone !== "done");
  if (!stage || stage.tone === "locked") return null;
  const place = stage.id as "design" | "build" | "test";
  return {
    alias, title: place === "design" ? hasPrd ? "설계 초안 검토" : "설계 상담 시작" : place === "build" ? "구현 상태 확인" : "테스트 결과 확인",
    reason: stage.next,
    steps: place === "design" ? hasPrd
      ? ["PRD의 확인 전인 절을 읽고 「맞아요」 또는 「고쳐 주세요」를 골라 주세요.", "모든 절의 확인과 검사가 끝나면 「채택」을 눌러 주세요."]
      : ["설계 상담 입력창에 만들려는 것과 원하는 결과를 적어 주세요.", "상담에서 묻는 질문에 답하며 요구사항을 채워 주세요."]
      : [stage.next, "화면에 표시된 상태와 결과를 확인하고, 필요한 작업은 대화창에서 요청해 주세요."],
    target: { kind: "stage", place, ...(place === "design" ? { designTab: hasPrd ? "prd" as const : "consult" as const } : {}) },
  };
}

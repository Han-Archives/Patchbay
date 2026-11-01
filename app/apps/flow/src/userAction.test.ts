import { describe, expect, it } from "vitest";
import { nextUserAction, type ActionTodo } from "./userAction.js";
import type { EvalsReviewResponse } from "./evalsContract.js";
import type { StageState } from "./workspaceContract.js";

const stages: StageState[] = ["design", "build", "test"].map(id => ({ id: id as StageState["id"], tone: "done", status: "완료", next: "" }));
const evals: Extract<EvalsReviewResponse, { status: "ok" }> = {
  status: "ok", alias: "demo", irVersion: 3, current: null,
  evals: ["E1", "E2"].map(id => ({ id, node: "n", kind: "deterministic", input: "", expect: "동작함", requirements: [], evidence: null })),
};
const todo = (patch: Partial<ActionTodo> = {}): ActionTodo => ({ id: "t1", title: "결과 검토", at: "", done: false, roomId: "room-1", ...patch });

describe("이어하기의 지금 할 일", () => {
  it("오래된 RAG 화면이나 할일의 일반 답 확인보다 기록 전 평가를 먼저 연다", () => {
    const action = nextUserAction("demo", [todo({ turn: "답 확인" })], evals, stages, true);
    expect(action?.target).toEqual({ kind: "evals", version: 3 });
    expect(action?.steps.join(" ")).toContain("v3에 기록");
  });
  it.each(["준비본 검토", "준비본 재검토", "준비 실패 확인", "실행 승인", "오류 확인", "실행 실패 확인"])("평가가 남아 있어도 %s의 실제 할일 방을 먼저 연다", turn => {
    const action = nextUserAction("demo", [todo({ turn })], evals, stages, true);
    expect(action?.target).toEqual({ kind: "todo", id: "t1", roomId: "room-1", turn });
    expect(action?.reason).toContain(turn);
  });
  it("작업 중·완료·비활성·삭제된 할일을 사람의 차례로 고르지 않는다", () => {
    const rows = [todo({ running: true, turn: "준비본 검토" }), todo({ done: true, turn: "실행 승인" }), todo({ inactive: true }), todo({ deletedAt: "2026-11-01T00:00:00Z" })];
    expect(nextUserAction("demo", rows, { status: "no-design", alias: "demo" }, stages, false)).toBeNull();
  });
  it("일부 평가 기록 뒤에는 남은 평가로 이어가고 전부 기록한 뒤에는 다음 할일로 간다", () => {
    const result = (evalId: string) => ({ evalId, kind: "deterministic" as const, status: "pass" as const });
    const view = { ...evals, current: { run: { irVersion: 3, ranAt: "2026-11-01T00:00:00Z", how: "사람 채점", results: [result("E1")] }, score: { total: 1, passed: 1, failed: 0, skipped: 0, meanScore: null, scored: 0, ids: ["E1"] } } };
    expect(nextUserAction("demo", [], view, stages, true)?.target.kind).toBe("evals");
    view.current.run.results.push(result("E2"));
    expect(nextUserAction("demo", [todo()], view, stages, true)?.target.kind).toBe("todo");
    expect(nextUserAction("demo", [], view, stages, true)).toBeNull();
  });
  it("구현·테스트가 끝나기 전이나 다른 프로젝트의 평가는 채점으로 건너뛰지 않는다", () => {
    const unfinished: StageState[] = stages.map(s => s.id === "test" ? { ...s, tone: "now", next: "시험을 실행하세요" } : s);
    expect(nextUserAction("demo", [], evals, unfinished, true)?.target).toEqual({ kind: "stage", place: "test" });
    expect(nextUserAction("other", [], evals, stages, true)).toBeNull();
  });
  it("방이 없는 할일은 방 생성 대상으로, 설계는 상담 또는 PRD 검토 대상으로 돌려준다", () => {
    expect(nextUserAction("demo", [todo({ roomId: undefined })], { status: "no-design", alias: "demo" }, [], false)?.target).toEqual({ kind: "todo", id: "t1" });
    const design: StageState[] = [{ id: "design", tone: "now", status: "설계 중", next: "초안 확인" }];
    for (const hasPrd of [true, false]) expect(nextUserAction("demo", [], { status: "no-design", alias: "demo" }, design, hasPrd)?.target).toEqual({ kind: "stage", place: "design", designTab: hasPrd ? "prd" : "consult" });
  });
});

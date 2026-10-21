import { describe, expect, it } from "vitest";
import { taskStatus } from "./CycleTaskTable.js";
import { markSteps } from "./ProjectCycleFlow.js";

/** 대시보드 작업 표의 상태 — 흐름도가 「지금」으로 짚은 세부 단계는 진행 중이다 (사용자 요청 2026-10-18). */
describe("작업 표 상태", () => {
  it("지금 단계의 처음 남은 세부 단계가 진행 중 — 첫 바퀴 설계에서도", () => {
    const design = markSteps(
      [
        { label: "목표와 요구사항", done: true },
        { label: "사용 시나리오", done: false },
        { label: "환경 설정", done: false },
        { label: "채택", done: false },
      ],
      true,
    );
    const status = design.map((s) => taskStatus({ done: s.state === "done", now: s.state === "now" }, []));
    expect(status).toEqual(["done", "run", "wait", "wait"]);
  });

  it("지금 단계가 아니면 진행 중이 없다", () => {
    const build = markSteps([{ label: "노드 A", done: false }], false);
    expect(taskStatus({ done: false, now: build[0]!.state === "now" }, [])).toBe("wait");
  });

  it("LLM이 세부 항목을 실행 중이면 지금이 아니어도 진행 중, 세부 항목이 모두 끝나면 완료", () => {
    expect(taskStatus({ done: false, now: false }, [{ status: "run" }, { status: "wait" }])).toBe("run");
    expect(taskStatus({ done: false, now: true }, [{ status: "done" }, { status: "done" }])).toBe("done");
  });
});

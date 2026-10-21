import { describe, expect, it } from "vitest";
import type { ConsultProgress } from "@patchbay/core";
import { doneTopics, handoffText, stageHandoff } from "./consultStage.js";

function progress(done: string[], next: string | null): ConsultProgress {
  const names = ["목표와 요구사항", "사용 시나리오", "환경 설정"];
  return {
    topics: names.map((name) => ({ name, filled: 0, total: 1, missing: [], done: done.includes(name) })),
    next,
    defaults: [],
  } as unknown as ConsultProgress;
}

describe("stageHandoff", () => {
  it("이 상담에서 주제가 새로 끝나면 다음 주제로 넘기기를 낸다", () => {
    const h = stageHandoff([], progress(["목표와 요구사항"], "사용 시나리오"));
    expect(h).toEqual({ done: "목표와 요구사항", next: "사용 시나리오" });
    expect(handoffText(h!)).toContain("「사용 시나리오」");
  });

  it("상담을 열 때 이미 끝난 주제로는 넘기지 않는다", () => {
    expect(stageHandoff(["목표와 요구사항"], progress(["목표와 요구사항"], "사용 시나리오"))).toBeNull();
  });

  it("시작을 모르거나 모두 끝났으면 내지 않는다", () => {
    expect(stageHandoff(null, progress(["목표와 요구사항"], "사용 시나리오"))).toBeNull();
    expect(stageHandoff([], progress(["목표와 요구사항", "사용 시나리오", "환경 설정"], null))).toBeNull();
  });

  it("끝난 주제만 모은다", () => {
    expect(doneTopics(progress(["사용 시나리오"], "목표와 요구사항"))).toEqual(["사용 시나리오"]);
  });
});

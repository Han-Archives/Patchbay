import { describe, expect, it } from "vitest";
import type { RoomMessage } from "@patchbay/core";
import { todoTurn } from "./todoTurn.js";

const at = "2026-10-29T00:00:00.000Z";
const speaker: RoomMessage = { seq: 2, at, role: "speaker", speaker: "claude-code", model: "m", text: "끝났습니다", ms: 1 };
const user: RoomMessage = { seq: 1, at, role: "user", text: "해 줘" } as RoomMessage;

describe("할일의 사람 차례", () => {
  it("LLM이 일하는 중이면 사람 차례가 아니다", () => {
    expect(todoTurn(true, "ready", speaker)).toBeUndefined();
  });
  it("준비본이 검토를 기다리면 대화보다 먼저 알린다", () => {
    expect(todoTurn(false, "ready", speaker)).toBe("준비본 검토");
    expect(todoTurn(false, "stale", undefined)).toBe("준비본 재검토");
    expect(todoTurn(false, "failed", undefined)).toBe("준비 실패 확인");
  });
  it("대화방 마지막 말이 LLM 답 · 오류 · 승인 대기면 사람 차례다", () => {
    expect(todoTurn(false, undefined, speaker)).toBe("답 확인");
    expect(todoTurn(false, undefined, { seq: 3, at, role: "system", kind: "timeout", text: "" })).toBe("오류 확인");
    expect(todoTurn(false, undefined, { seq: 3, at, role: "operation", executionId: "e", operationId: "o", stage: "act", status: "waiting", text: "" })).toBe("실행 승인");
  });
  it("사람이 마지막에 말했거나 준비 중 · 대화 없음이면 차례가 아니다", () => {
    expect(todoTurn(false, undefined, user)).toBeUndefined();
    expect(todoTurn(false, "preparing", undefined)).toBeUndefined();
    expect(todoTurn(false, undefined, { seq: 3, at, role: "system", kind: "done", text: "" })).toBeUndefined();
  });
});

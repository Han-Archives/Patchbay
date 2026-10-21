import { describe, expect, it } from "vitest";
import { existingTone, generateNote, type ExistingLink } from "./buildContract.js";

describe("generateNote", () => {
  it("쓴 파일과 건너뛴 파일을 한 줄로 가른다", () => {
    expect(generateNote({ ok: true, written: ["state.ts"], skipped: ["graph.ts"] })).toBe(
      "생성했다 — state.ts · 이미 있어 그대로 둠: graph.ts",
    );
  });

  it("쓸 것이 없었던 것과 막힌 것은 다른 문장이다", () => {
    expect(generateNote({ ok: true, written: [], skipped: [] })).toBe("새로 쓸 파일이 없었다");
    expect(generateNote({ ok: false, error: "1.9가 막았다" })).toBe("1.9가 막았다");
  });
});

describe("existingTone", () => {
  const link = (state: ExistingLink["state"]): ExistingLink => ({ id: state, requirement: "R1", file: "a.test.ts", test: "", state, by: "agent", at: "" });
  const req = (state: "unlinked" | "pass", links: ExistingLink[]) => ({ id: "R1", text: "", nodes: [], links, state });

  it("확인된 연결이 없어도 제안이 있으면 「테스트 없음」이 아니라 「확인 대기」다", () => {
    expect(existingTone(req("unlinked", [link("proposed")]))).toEqual({ tone: "proposed", label: "확인 대기" });
    expect(existingTone(req("unlinked", []))).toEqual({ tone: "unlinked", label: "테스트 없음" });
    expect(existingTone(req("pass", [link("confirmed"), link("proposed")]))).toEqual({ tone: "pass", label: "통과" });
  });
});

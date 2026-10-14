import { describe, expect, it } from "vitest";
import { generateNote } from "./buildContract.js";

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

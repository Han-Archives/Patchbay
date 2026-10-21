import { describe, expect, it, vi } from "vitest";
import { consultProgress } from "../ir/consult/catalog.js";
import { buildConsultBrief } from "./brief.js";

vi.mock("../ir/consult/catalog.js", async (orig) => {
  const real = await orig<typeof import("../ir/consult/catalog.js")>();
  return { ...real, consultProgress: vi.fn(real.consultProgress) };
});

describe("상담 안내 — 남은 과정이 없으면 「다음 과정」 버튼을 말하지 않는다 (2026-10-20)", () => {
  const brief = () => buildConsultBrief({ alias: "t", draft: {}, consultId: "c" });

  it("남은 과정이 있으면 버튼으로 넘기라고 알린다", () => {
    expect(brief()).toContain("다음 과정 버튼");
  });

  it("모든 과정이 끝났으면 버튼 안내를 하지 않는다", () => {
    vi.mocked(consultProgress).mockReturnValueOnce({ topics: [], next: null, defaults: [] } as unknown as ReturnType<typeof consultProgress>);
    expect(brief()).not.toContain("다음 과정 버튼");
  });
});

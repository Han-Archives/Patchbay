import { describe, expect, it } from "vitest";
import { hpBar } from "./quotaStatusline.js";

describe("quota statusline", () => {
  const now = Date.parse("2026-10-19T01:00:00Z");
  it("shows a fresh observed percentage", () => {
    expect(hpBar("5h", { usedPct: 35, resetsAt: "2026-10-19T05:00:00Z", at: new Date(now).toISOString() }, now)).toContain("65%");
  });
  it("waits for a fresh observation after reset instead of inventing 100%", () => {
    const text = hpBar("5h", { usedPct: 100, resetsAt: "2026-10-19T00:59:00Z" }, now);
    expect(text).toContain("갱신 대기");
    expect(text).not.toContain("100%");
  });
  it("does not display an old retained window as a current percentage", () => {
    expect(hpBar("5h", { usedPct: 35, resetsAt: "2026-10-19T05:00:00Z", at: "2026-10-19T00:50:00Z" }, now)).toContain("갱신 대기");
    expect(hpBar("7d", undefined, now)).toContain("갱신 대기");
  });
});

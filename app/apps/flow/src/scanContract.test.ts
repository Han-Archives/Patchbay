import { describe, expect, it } from "vitest";
import { scanNote } from "./scanContract.js";

const ok = { alias: "demo", path: "/tmp/demo", head: "abc", previousBroken: false };

describe("scanNote", () => {
  it("says first scan when there was none before — not 「0 → n」", () => {
    expect(scanNote({ ...ok, ports: 4, portsBefore: null })).toBe("처음 스캔했다 — 항목 4");
  });

  it("shows the change in jack count", () => {
    expect(scanNote({ ...ok, ports: 7, portsBefore: 5 })).toBe("다시 스캔했다 — 항목 5 → 7 (+2)");
    expect(scanNote({ ...ok, ports: 3, portsBefore: 5 })).toBe("다시 스캔했다 — 항목 5 → 3 (-2)");
  });

  it("says nothing moved when the count is the same", () => {
    expect(scanNote({ ...ok, ports: 5, portsBefore: 5 })).toBe("다시 스캔했다 — 항목 5, 수는 그대로");
  });

  it("깨진 앞 결과를 새로 썼으면 「처음」이 아니라 그렇게 말한다", () => {
    expect(scanNote({ ...ok, ports: 4, portsBefore: null, previousBroken: true })).toBe("깨진 스캔 결과를 새로 썼다 — 항목 4");
  });

  it("passes the server's error through", () => {
    expect(scanNote({ error: "폴더가 없다: /x" })).toBe("폴더가 없다: /x");
  });
});

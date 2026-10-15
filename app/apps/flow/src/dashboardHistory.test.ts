import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendDashboardHistory, dashboardHistoryInputSchema, readDashboardHistory, registerProject, writeProgressEntry } from "@patchbay/core";
import { historyDomainTags, historyMonthCells, historyRowDate, localHistoryDate, shiftHistoryMonth, type HistoryRow } from "./historyContract.js";
import { createFlowApp } from "./server.js";
async function setup() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pb-history-"));
  await registerProject(home, { alias: "demo", kind: "local_repo", path: home });
  return home;
}
describe("History와 월별 캘린더", () => {
  it("윤년·실제 일자를 확인하고 빈 태그와 내용을 거절한다", () => {
    const input = { date: "2024-02-29", tags: [" UI ", "UI"], content: " 변경 " };
    expect(dashboardHistoryInputSchema.parse(input)).toEqual({ date: "2024-02-29", tags: ["UI"], content: "변경" });
    for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-10-2"]) expect(dashboardHistoryInputSchema.safeParse({ ...input, date }).success).toBe(false);
    expect(dashboardHistoryInputSchema.safeParse({ ...input, tags: [] }).success).toBe(false);
    expect(dashboardHistoryInputSchema.safeParse({ ...input, content: "  " }).success).toBe(false);
  });
  it("진행 단계 대신 기능 영역으로 분류하고 기존 명시 영역 태그를 보존한다", () => {
    expect(historyDomainTags({ summary: "대화창 Codex 연결 버튼 수정", step: "진행" })).toEqual(["UI", "LLM", "대화창"]);
    expect(historyDomainTags({ tags: ["진행"], content: "할일 자동 실행" })).toEqual(["할일"]);
    expect(historyDomainTags({ tags: ["UI", "수정"], content: "내용" })).toEqual(["UI"]);
    expect(historyDomainTags({ summary: "일반 변경", step: "구현" })).toEqual(["프로젝트"]);
  });
  it("동시에 저장한 기록을 잃지 않고 날짜와 태그·내용을 보존한다", async () => {
    const home = await setup();
    await Promise.all(Array.from({ length: 8 }, (_, i) => appendDashboardHistory(home, "demo", { date: `2026-10-${String(i + 1).padStart(2, "0")}`, tags: ["기능"], content: `변경 ${i}` })));
    const rows = await readDashboardHistory(home, "demo"); expect(rows).toHaveLength(8); expect(new Set(rows.map(r => r.id)).size).toBe(8);
    expect(rows.some(r => r.date === "2026-10-01" && r.content === "변경 0")).toBe(true);
  });
  it("일요일 시작 격자와 월·연도 이동을 정확히 계산한다", () => {
    const feb = historyMonthCells("2024-02"); expect(feb.filter(Boolean)).toHaveLength(29); expect(feb[4]).toBe("2024-02-01"); expect(feb.length % 7).toBe(0);
    expect(historyMonthCells("2026-13")).toEqual([]); expect(historyMonthCells("2026-02").filter(Boolean)).toHaveLength(28);
    expect(shiftHistoryMonth("2026-12", 1)).toBe("2027-01"); expect(shiftHistoryMonth("2026-01", -1)).toBe("2025-12");
  });
  it("사용자가 선택한 기록 날짜를 보존하고 자동 기록은 표시 환경의 현지 날짜로 묶는다", () => {
    const row: HistoryRow = { id: "x", source: "manual", date: "2026-10-01", timestamp: "2026-10-15T23:00:00Z", tags: ["UI"], content: "내용" };
    expect(historyRowDate(row)).toBe("2026-10-01"); expect(historyRowDate({ ...row, date: undefined })).toBe(localHistoryDate(new Date(row.timestamp)));
  });
  it("기존 진행 기록과 수동 기록을 합쳐 조회하며 조회 전용 쓰기·잘못된 날짜·다른 프로젝트를 차단한다", async () => {
    const home = await setup(); await writeProgressEntry(home, "demo", { summary: "기존 진행", step: "구현", asked: "요구", did: "수정한 내용" });
    const app = createFlowApp({ studioHome: home, access: { token: "write", readToken: "read" } });
    const input = { alias: "demo", date: "2026-10-12", tags: ["UI", "대화창"], content: "달력 추가" };
    const post = (body: unknown, token = "write") => app.request("/api/dashboard/history", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    try {
      expect((await post(input, "read")).status).toBe(403); expect((await post({ ...input, tags: ["진행"] })).status).toBe(400); expect((await post({ ...input, date: "2026-02-30" })).status).toBe(400);
      expect((await post({ ...input, alias: "missing" })).status).toBe(404); expect((await post(input)).status).toBe(201);
      const res = await app.request("/api/dashboard/history?alias=demo", { headers: { authorization: "Bearer read" } });
      const body = await res.json() as { entries: HistoryRow[] }; expect(body.entries).toHaveLength(2);
      expect(body.entries.find(e => e.source === "progress")).toMatchObject({ content: "기존 진행", tags: ["프로젝트"], did: "수정한 내용" });
      expect(body.entries.find(e => e.source === "manual")).toMatchObject({ date: input.date, tags: input.tags, content: input.content });
      expect((await app.request("/api/dashboard/history?alias=missing", { headers: { authorization: "Bearer read" } })).status).toBe(404);
    } finally { await app.close(); }
  });
});

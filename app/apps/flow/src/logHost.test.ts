import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { logRecordIds, registerProject, updateTodos } from "@patchbay/core";
import { registerLogRoutes } from "./logHost.js";
import type { RoomRunner } from "./roomHost.js";

const NOW = new Date("2026-10-15T12:00:00Z");

async function setup(runner: RoomRunner) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-loghost-"));
  await registerProject(home, { alias: "demo", kind: "local_repo", path: path.join(home, "nope") });
  await updateTodos(home, "demo", () => [{ id: "t1", title: "화면 버튼 고치기", done: false, at: "2026-10-15T01:00:00.000Z" }], new Date("2026-10-15T01:00:00.000Z"));
  const app = new Hono();
  registerLogRoutes(app, home, { runner, lmsBin: "/fake/lms", now: () => NOW });
  const post = (url: string, body: unknown) => app.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { home, app, post };
}

const summaryFor = (id: string) => `## 한 줄 요약\n버튼을 손봤다.\n## 한 일\n- 버튼 할일 추가 [${id}]\n## 결정\n- 확인되지 않음\n## 막힌 것 · 남은 일\n- 확인되지 않음\n## 태그 제안\n- 버튼 [${id}]`;

describe("콘솔 Log API", () => {
  it("화면을 열면 그 달을 정리해 색인을 주고, 등록되지 않은 프로젝트는 거절한다", async () => {
    const { app } = await setup(async () => ({ ok: true, text: "", ms: 0 }));
    const res = await app.request("/api/log?alias=demo");
    const body = await res.json() as { month: string; today: string; index: { days: Record<string, { state: string; tags: Record<string, number> }> } };
    expect(body).toMatchObject({ month: "2026-10", today: "2026-10-15" });
    expect(body.index.days["2026-10-15"]).toMatchObject({ state: "잠정", tags: { UI: 1 } });
    expect((await app.request("/api/log?alias=else")).status).toBe(404);
    expect((await app.request("/api/log/day?alias=demo&date=../x")).status).toBe(400);
  });

  it("요약은 모델을 고른 뒤에만, 검사를 통과한 답만 저장하고, 실패하면 앞 요약을 둔다", async () => {
    let answer = "";
    const calls: string[] = [];
    const { app, post } = await setup(async (req) => { calls.push(`${req.speaker}:${req.model}`); return answer === "TIMEOUT" ? { ok: false, kind: "timeout", text: "", ms: 1 } : { ok: true, text: answer, ms: 1 }; });
    await app.request("/api/log?alias=demo");
    expect((await post("/api/log/summary", { alias: "demo", date: "2026-10-15" })).status).toBe(400);
    expect(await (await post("/api/log/model", { alias: "demo", model: "qwen-test" })).json()).toEqual({ model: "qwen-test" });
    const day = await (await app.request("/api/log/day?alias=demo&date=2026-10-15")).json() as { record: string };
    const id = [...logRecordIds(day.record)][0]!;
    answer = summaryFor(id);
    const ok = await post("/api/log/summary", { alias: "demo", date: "2026-10-15" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ summary: { state: "fresh" }, suggestedTags: ["버튼"] });
    expect(calls).toEqual(["local:qwen-test"]);
    answer = summaryFor("progress:지어낸것");
    const bad = await post("/api/log/summary", { alias: "demo", date: "2026-10-15" });
    expect(bad.status).toBe(422);
    expect((await bad.json() as { errors: string[] }).errors.join()).toContain("기록에 없는 근거");
    answer = "TIMEOUT";
    expect((await post("/api/log/summary", { alias: "demo", date: "2026-10-15" })).status).toBe(422);
    const kept = await (await app.request("/api/log/day?alias=demo&date=2026-10-15")).json() as { summary: { state: string; text: string } };
    expect(kept.summary.state).toBe("fresh");
    expect(kept.summary.text).toContain("버튼을 손봤다.");
  });

  it("확정하면 확정, 보고서 바탕은 처음만 만든다", async () => {
    const { post, app } = await setup(async () => ({ ok: true, text: "", ms: 0 }));
    await app.request("/api/log?alias=demo");
    expect(await (await post("/api/log/confirm", { alias: "demo", date: "2026-10-15" })).json()).toMatchObject({ state: "확정" });
    expect((await post("/api/log/confirm", { alias: "demo", date: "2026-10-15" })).status).toBe(409);
    const first = await (await post("/api/log/report", { alias: "demo", period: "month", key: "2026-10" })).json() as { created: boolean; name: string };
    expect(first).toMatchObject({ created: true, name: "month-2026-10.md" });
    expect(await (await post("/api/log/report", { alias: "demo", period: "month", key: "2026-10" })).json()).toMatchObject({ created: false });
    expect(await (await app.request("/api/log/reports?alias=demo")).json()).toEqual({ reports: ["month-2026-10.md"] });
    expect((await app.request("/api/log/reports?alias=demo&name=../../x.md")).status).toBe(400);
  });

});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adoptIr, ensureStudioInitialized, parseIr, readIrFile, readPassedNodes, recordPassedNodes, registerProject } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { metricLabel, metricsFrom, testsFromVitest } from "./dashboardView.js";
import { activityFromHistory, readTestActivity } from "./testActivity.js";

/** 0 대시보드 · 3 테스트 (사용자 결정 2026-10-08). 그래프 서버는 가짜 fetch로 — CI는 실제 서버를 띄우지 않는다. */

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/core/src/ir/__fixtures__");
let cached: Awaited<ReturnType<typeof load>> | null = null;
async function load() {
  const read = await readIrFile(path.join(FIXTURES, "valid.ir.yaml"));
  if (!read.ok) throw new Error("fixture");
  const parsed = parseIr(read.raw);
  if (!parsed.ok) throw new Error("fixture");
  return parsed.ir;
}
const validIr = async () => (cached ??= await load());

/** 체크포인트: step 순서, next 는 다음에 돌 노드, values 는 그 시점의 State. 최신이 앞이다(서버 순서). */
const history = [
  { metadata: { source: "loop", step: 5, run_id: "r2" }, created_at: "2026-10-08T10:00:03Z", next: [], values: { input: "a", kind: "bug" } },
  { metadata: { source: "loop", step: 4, run_id: "r2" }, created_at: "2026-10-08T10:00:02Z", next: ["classify"], values: { input: "a" } },
  { metadata: { source: "loop", step: 3, run_id: "r2" }, created_at: "2026-10-08T10:00:02Z", next: ["intake"], values: { input: "a" } },
  // 입력 체크포인트는 입력을 넣기 전 값 — 입력은 __start__ 다음에 보인다 (실제 langgraph dev 모양)
  { metadata: { source: "input", step: 2, run_id: "r2" }, created_at: "2026-10-08T10:00:01Z", next: ["__start__"], values: {} },
  { metadata: { source: "loop", step: 1, run_id: "r1" }, created_at: "2026-10-08T09:00:01Z", next: [], values: {} },
  { metadata: { source: "loop", step: 0, run_id: "r1" }, created_at: "2026-10-08T09:00:01Z", next: ["intake"], values: {} },
  { metadata: { source: "input", step: -1, run_id: "r1" }, created_at: "2026-10-08T09:00:00Z", next: ["__start__"], values: {} },
];

describe("테스트 로그 — 이웃한 체크포인트의 값을 비교해 일한 노드를 찾는다", () => {
  it("값을 바꾼 노드는 일함, 값이 그대로면 건너뜀, 입력 단계는 들어온 칸", () => {
    const entries = activityFromHistory("t1", history, (id) => (id === "r2" ? "success" : "error"));
    const r1 = entries.find((e) => e.runId === "r1")!;
    const r2 = entries.find((e) => e.runId === "r2")!;
    expect(r1).toMatchObject({ status: "error", input: [], worked: [], skipped: ["intake"] });
    expect(r2).toMatchObject({ status: "success", input: ["input"], worked: ["classify"], skipped: ["intake"] });
    expect(r2.startedAt).toBe("2026-10-08T10:00:01Z");
    expect(r2.endedAt).toBe("2026-10-08T10:00:03Z");
  });

  it("서버에서 읽으며 설계 노드 중 일한 것을 작업 공간에 쌓는다 — 서버가 꺼져도 남는다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-ops-"));
    await ensureStudioInitialized(home);
    await registerProject(home, { alias: "demo", kind: "local_repo", path: FIXTURES });
    fs.mkdirSync(path.join(home, "projects", "demo"), { recursive: true });
    fs.copyFileSync(path.join(FIXTURES, "valid.ir.yaml"), path.join(home, "projects", "demo", "ir.proposed.yaml"));
    expect((await adoptIr(home, "demo", { docRoot: FIXTURES })).ok).toBe(true);

    const fake = (async (url: string) => {
      const u = String(url);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (u.endsWith("/ok")) return json({ ok: true });
      if (u.endsWith("/threads/search")) return json([{ thread_id: "t1" }]);
      if (u.includes("/history")) return json(history);
      if (u.includes("/runs")) return json([{ run_id: "r2", status: "success" }]);
      return new Response("", { status: 404 });
    }) as typeof fetch;

    const activity = await readTestActivity(home, "demo", "http://lg.test", fake, new Date("2026-10-08T11:00:00Z"));
    expect(activity.reachable).toBe(true);
    expect(activity.total).toEqual(["intake", "classify", "explain", "pick"]);
    expect(activity.passed).toEqual(["classify"]);
    expect(activity.entries.map((e) => e.runId)).toEqual(["r2", "r1"]);
    expect((await readPassedNodes(home, "demo")).nodes).toEqual({ classify: "2026-10-08T10:00:01Z" });

    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const off = await readTestActivity(home, "demo", "http://lg.test", down);
    expect(off.reachable).toBe(false);
    expect(off.passed).toEqual(["classify"]);
    expect(off.error).toContain("닿지 못했다");
  });

  it("처음 지난 시각은 더 이른 것으로만 바뀐다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-passed-"));
    await recordPassedNodes(home, "x", [{ node: "a", at: "2026-10-08T10:00:00Z" }]);
    await recordPassedNodes(home, "x", [{ node: "a", at: "2026-10-08T12:00:00Z" }, { node: "b", at: "2026-10-08T12:00:00Z" }]);
    await recordPassedNodes(home, "x", [{ node: "a", at: "2026-10-08T09:00:00Z" }]);
    expect((await readPassedNodes(home, "x")).nodes).toEqual({ a: "2026-10-08T09:00:00Z", b: "2026-10-08T12:00:00Z" });
  });
});

describe("대시보드 — 프로젝트 전용 코드 없이 설계에서 읽는다", () => {
  it("State 칸 이름과 같은 낱말의 개념이 있으면 그 라벨로 — 없으면 칸 이름", async () => {
    const ir = await validIr();
    expect(metricLabel(ir, "input")).toEqual({ label: "기록", output: false });
    expect(metricLabel(ir, "reason")).toEqual({ label: "근거", output: true });
    const extended = { ...ir, concepts: [...ir.concepts, { id: "estimated-score", label: "예상 점수 — 전체 밴드", kind: "output" as const, values: [] }] };
    expect(metricLabel(extended, "estimatedScore")).toEqual({ label: "예상 점수", output: true });
    expect(metricLabel(ir, "messages").label).toBe("messages");
  });

  it("숫자 · 짧은 글 · 배열 개수만 지표로, 내놓는 개념을 앞에", async () => {
    const ir = await validIr();
    const metrics = metricsFrom(ir, { messages: [1, 2, 3], input: "저장 버튼이 두 번 눌린다", kind: "bug", reason: "재현 절차가 있다", guide: { path: "x" } });
    expect(metrics[0]).toMatchObject({ field: "reason", output: true, kind: "text" });
    expect(metrics.find((m) => m.field === "messages")).toMatchObject({ kind: "count", value: 3 });
    expect(metrics.some((m) => m.field === "guide")).toBe(false);
  });

  it("vitest JSON → 시험 id별 결과. 같은 id가 여럿이면 실패가 이긴다, todo는 사람 판단", () => {
    const report = {
      testResults: [
        {
          assertionResults: [
            { title: "E0 · diagnose · deterministic — …", status: "passed" },
            { title: "E0 · diagnose — Opus를 부르지 못하면 …", status: "passed" },
            { title: "E1 · split-7days …", status: "failed" },
            { title: "E1 · split-7days 다른 경우", status: "passed" },
            { title: "E13 · build-items · model — …", status: "todo" },
            { title: "넘기기 — 이상한 문제", status: "passed" },
          ],
        },
      ],
    };
    const tests = testsFromVitest(report, "2026-10-08T00:00:00Z");
    expect(tests.results).toEqual({ E0: "pass", E1: "fail", E13: "todo" });
    expect(tests).toMatchObject({ passed: 1, failed: 1, todo: 1 });
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { readTestRuns, recordTestRuns, type TestRunEntry } from "../runs/testRuns.js";
import { parseIr, type Ir } from "../types/ir.js";
import { RELATION_ORIGINS, isRunRelation } from "./contract.js";
import { auditReplica, knowledgeFromIr, knowledgeFromRuns, runEvidence, runPath } from "./ingest.js";

/**
 * 셋째 줄기 — 3 테스트의 실행 (기획 20261008a: 지식 그래프는 테스트 뒤, 사용자 결정 2026-10-08).
 * 실행 → 일한 노드 → 요구사항 → 평가 → 문서. 고정 자료 설계(intake → classify → explain → pick, pick이 D1~D4)로.
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ir", "__fixtures__");
function loadIr(): Ir {
  const parsed = parseIr(parseYaml(fs.readFileSync(path.join(FIXTURES, "valid.ir.yaml"), "utf8")));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.ir;
}

const run = (over: Partial<TestRunEntry>): TestRunEntry => ({
  runId: "r1",
  threadId: "t1",
  status: "success",
  startedAt: "2026-10-08T10:00:00Z",
  endedAt: "2026-10-08T10:00:05Z",
  input: [],
  worked: [],
  skipped: [],
  ...over,
});

describe("실행 행", () => {
  it("일한 설계 노드마다 RAN — 설계에 없는 노드 · 일한 노드가 없는 실행은 잇지 않는다", () => {
    const ir = loadIr();
    const snap = knowledgeFromRuns(
      [
        run({ runId: "r1", input: ["messages"], worked: ["intake", "classify", "ghost"] }),
        run({ runId: "r2", startedAt: "2026-10-08T11:00:00Z", input: ["messages"], worked: [] }),
      ],
      ir,
    );
    expect(snap.nodes.map((n) => [n.path, n.label, n.text])).toEqual([[runPath("r1"), "Run", "들어옴 messages · 일함 intake, classify"]]);
    expect(snap.edges).toEqual([
      { from: "run:r1", to: "ir:node/intake", kind: "RAN" },
      { from: "run:r1", to: "ir:node/classify", kind: "RAN" },
    ]);
    expect(isRunRelation("RAN")).toBe(true);
    expect(RELATION_ORIGINS.RAN.source).toBe("test/activity.json · runs[].worked");
  });

  it("근거 경로 — 실행 → 노드 → 맡은 요구사항 → 보는 평가 → 찾는 문서", () => {
    const ir = loadIr();
    const design = knowledgeFromIr(ir);
    const runs = knowledgeFromRuns([run({ runId: "r1", worked: ["pick"] })], ir);
    const snapshot = { nodes: [...design.nodes, ...runs.nodes], edges: [...design.edges, ...runs.edges] };
    const [evidence] = runEvidence(snapshot);
    expect(evidence!.run.path).toBe("run:r1");
    const pick = evidence!.steps[0]!;
    expect(pick.node).toBe("pick");
    expect(pick.requirements.map((r) => r.id).sort()).toEqual(["R1", "R3", "R5", "R7"]);
    expect(pick.evals).toEqual(expect.arrayContaining(["E1", "E3", "E5"]));
    expect(pick.documents.map((d) => d.id)).toEqual(["D1", "D2", "D3", "D4"]);
    expect(auditReplica(snapshot).runEdges).toBe(1);
  });

  it("test/activity.json — 실행 id로 합치고, 같은 값이면 다시 쓰지 않는다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-testruns-"));
    await recordTestRuns(home, "demo", [run({ runId: "a", worked: ["intake"] })]);
    await recordTestRuns(home, "demo", [run({ runId: "a", worked: ["intake", "classify"] }), run({ runId: "b", startedAt: "2026-10-08T12:00:00Z" })]);
    const runs = await readTestRuns(home, "demo");
    expect(runs.map((r) => r.runId)).toEqual(["b", "a"]);
    expect(runs[1]!.worked).toEqual(["intake", "classify"]);
    const file = path.join(home, "projects", "demo", "test", "activity.json");
    const before = fs.statSync(file).mtimeMs;
    await new Promise((r) => setTimeout(r, 15));
    await recordTestRuns(home, "demo", [run({ runId: "a", worked: ["intake", "classify"] })]);
    expect(fs.statSync(file).mtimeMs).toBe(before);
  });
});

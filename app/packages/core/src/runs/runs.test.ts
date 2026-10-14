import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { beforeEach, describe, expect, it } from "vitest";
import { parseIr, type Ir } from "../types/ir.js";
import { checkBudget } from "./budget.js";
import { compareRunsToDesign } from "./compare.js";
import { draftEvalsFromRuns, draftsAsIrEvals } from "./draftEvals.js";
import { scoreEvalRun, type EvalRun } from "./evals.js";
import { CALL_LOG_STATE_KEY, normalizeLangGraphRun } from "./normalize.js";
import { readRunRecords, safeRunId, writeRunRecord } from "./store.js";
import { parseRunRecord, runDurationMs, type RunRecord } from "./types.js";
import { compareVersions, type VersionRecord } from "./versions.js";

/**
 * M6's gate, against the fixed test material (명세 §8):
 *   - 성공·거절·타임아웃 세 실행이 다른 상태로 수집된다
 *   - 실패 사례는 사람 승인 전 평가 원본을 바꾸지 않는다
 *   - 같은 평가 묶음으로만 두 버전을 비교한다
 *   - 모델을 바꾸면 교체 전후 점수와 비용을 함께 보여 준다
 *
 * CI calls no model API: the three records are hand-written files and the
 * adapter's job is to produce that same shape from a provider.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "__fixtures__");
const IR_FIXTURE = path.join(HERE, "..", "ir", "__fixtures__", "valid.ir.yaml");

function loadIr(): Ir {
  const parsed = parseIr(parseYaml(fs.readFileSync(IR_FIXTURE, "utf8")));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.ir;
}

function loadRecord(name: string): RunRecord {
  const parsed = parseRunRecord(JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8")));
  if (!parsed.ok) throw new Error(`${name} — ${parsed.error}`);
  return parsed.record;
}

const THREE = () => [loadRecord("success.json"), loadRecord("refused.json"), loadRecord("timeout.json")];

describe("§5.2 실행 기록 형식", () => {
  it("reads all three fixtures, and they land on three different statuses", () => {
    const records = THREE();
    expect(records.map((record) => record.status)).toEqual(["success", "refused", "timeout"]);
    // 13필드가 다 있어야 한다 — 빼는 것과 []는 다르다.
    for (const record of records) {
      expect(Object.keys(record).sort()).toEqual(
        [
          "documentCalls", "endedAt", "error", "graphId", "irVersion", "modelCalls",
          "nodeId", "runId", "startedAt", "status", "toolCalls", "usage",
        ].sort(),
      );
    }
    expect(runDurationMs(records[2]!)).toBe(20010);
  });

  it("refuses a record that leaves an array out -- that is not the same as an empty one", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, "timeout.json"), "utf8"));
    delete raw.toolCalls;
    const parsed = parseRunRecord(raw);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("toolCalls");

    // 빈 배열은 통과한다 -- 「툴을 안 불렀다」는 값이다.
    const empty = { ...JSON.parse(fs.readFileSync(path.join(FIXTURES, "timeout.json"), "utf8")), toolCalls: [] };
    expect(parseRunRecord(empty).ok).toBe(true);
  });

  it("refuses a status outside the four, and a broken timestamp", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, "success.json"), "utf8"));
    expect(parseRunRecord({ ...raw, status: "cancelled" }).ok).toBe(false);
    expect(parseRunRecord({ ...raw, startedAt: "어제" }).ok).toBe(false);
  });
});

describe("§5.3 실행 기록 보관", () => {
  let studioHome: string;
  beforeEach(() => {
    studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-runs-"));
  });

  it("keeps one run per file and reads them back oldest first", async () => {
    for (const record of THREE()) await writeRunRecord(studioHome, "demo", record);
    const read = await readRunRecords(studioHome, "demo");
    expect(read.rejected).toEqual([]);
    expect(read.records.map((record) => record.runId)).toEqual([
      "run-fixture-0001",
      "run-fixture-0002",
      "run-fixture-0003",
    ]);
  });

  it("names an unreadable file instead of quietly reporting fewer runs", async () => {
    await writeRunRecord(studioHome, "demo", loadRecord("success.json"));
    fs.writeFileSync(path.join(studioHome, "projects", "demo", "runs", "broken.json"), "{ not json", "utf8");
    const read = await readRunRecords(studioHome, "demo");
    expect(read.records).toHaveLength(1);
    expect(read.rejected).toHaveLength(1);
    expect(read.rejected[0]?.error).toContain("JSON이 깨졌다");
  });

  it("returns nothing for a project that has never run, and refuses a runId that is a path", async () => {
    expect(await readRunRecords(studioHome, "demo")).toEqual({ records: [], rejected: [] });
    expect(() => safeRunId("../escape")).toThrow();
    expect(() => safeRunId("a/b")).toThrow();
  });
});

describe("5.3 설계와 실물 대조", () => {
  it("collects the three statuses separately and finds nothing wrong with a faithful run", () => {
    const result = compareRunsToDesign(loadIr(), THREE());
    expect(result.compared).toBe(3);
    expect(result.byStatus).toEqual({ success: 1, refused: 1, timeout: 1, error: 0 });
    expect(result.skipped).toEqual([]);
    // 고정 자료는 설계대로 돈 기록이다 -- 안 돈 노드만 남는다.
    expect(result.findings.filter((finding) => finding.kind !== "node-never-ran")).toEqual([]);
    expect(result.usage).toMatchObject({ inputTokens: 1210, outputTokens: 96, costMissing: 0 });
    expect(result.usage.costUsd).toBeCloseTo(0.0056, 6);
  });

  it("puts a node the design never mentions in its own lane", () => {
    const record = loadRecord("success.json");
    const stray: RunRecord = { ...record, nodeId: "summarize" };
    const result = compareRunsToDesign(loadIr(), [stray]);
    expect(result.findings.some((f) => f.kind === "node-not-in-design" && f.nodeId === "summarize")).toBe(true);
    expect(result.nodes.find((node) => node.id === "summarize")?.lane).toBe("actual");
    expect(result.nodes.find((node) => node.id === "pick")?.lane).toBe("both");
  });

  it("catches an undeclared model, and a declared model called from the wrong node", () => {
    const record = loadRecord("success.json");
    const undeclared = compareRunsToDesign(loadIr(), [
      { ...record, modelCalls: [{ ...record.modelCalls[0]!, model: "gpt-9" }] },
    ]);
    expect(undeclared.findings.some((f) => f.kind === "model-not-declared")).toBe(true);

    const wrongNode = compareRunsToDesign(loadIr(), [
      { ...record, modelCalls: [{ ...record.modelCalls[0]!, nodeId: "pick" }] },
    ]);
    expect(wrongNode.findings.some((f) => f.kind === "model-node-not-declared")).toBe(true);
  });

  /** §4.3 ③ -- 권한은 여기서 대조한다. 런타임을 막는 건 Patchbay의 일이 아니다 (원칙 9). */
  it("catches a tool that ran with a capability the design never delegated", () => {
    const record = loadRecord("success.json");
    const result = compareRunsToDesign(loadIr(), [
      { ...record, toolCalls: [{ ...record.toolCalls[0]!, caps: ["cap:draft", "cap:pr"] }] },
    ]);
    const finding = result.findings.find((f) => f.kind === "cap-not-declared");
    expect(finding?.detail).toContain("cap:pr");
    expect(finding?.detail).toContain("cap:draft");
  });

  it("catches a document the design never named, and one read by the wrong node", () => {
    const record = loadRecord("success.json");
    const unknown = compareRunsToDesign(loadIr(), [
      { ...record, documentCalls: [{ nodeId: "pick", path: "guides/stale-a.md", level: 1 }] },
    ]);
    expect(unknown.findings.some((f) => f.kind === "document-not-declared")).toBe(true);

    const wrongNode = compareRunsToDesign(loadIr(), [
      { ...record, documentCalls: [{ nodeId: "intake", path: "guides/bug.md", level: 1 }] },
    ]);
    expect(wrongNode.findings.some((f) => f.kind === "document-node-mismatch")).toBe(true);
  });

  it("reports a cut that came in under the declared limit", () => {
    const record = loadRecord("timeout.json");
    const result = compareRunsToDesign(loadIr(), [
      { ...record, modelCalls: [{ ...record.modelCalls[0]!, ms: 9000 }] },
    ]);
    const finding = result.findings.find((f) => f.kind === "timeout-before-limit");
    expect(finding?.detail).toContain("9000ms");
    expect(finding?.detail).toContain("20000ms");
  });

  it("will not hold a record from another design against this one", () => {
    const record = loadRecord("success.json");
    const result = compareRunsToDesign(loadIr(), [{ ...record, irVersion: 7 }]);
    expect(result.compared).toBe(0);
    expect(result.skipped).toEqual([{ runId: "run-fixture-0001", irVersion: 7 }]);
    expect(result.byStatus.success).toBe(0);
  });
});

describe("5.4 실패 → 평가 초안", () => {
  it("matches the fixed expected draft exactly", () => {
    const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES, "from-failure.expected.json"), "utf8"));
    const result = draftEvalsFromRuns(loadIr(), THREE());

    expect(result.from).toEqual(expected.from);
    expect(result.irVersion).toBe(expected.irVersion);
    expect(result.requirementLinksToFill).toEqual(expected.requirementLinksToFill);
    expect(
      result.draftEvals.map(({ id, node, kind, input, expect: e }) => ({ id, node, kind, input, expect: e })),
    ).toEqual(
      (expected.draftEvals as Array<Record<string, unknown>>).map(({ id, node, kind, input, expect: e }) => ({
        id, node, kind, input, expect: e,
      })),
    );
    // 근거는 어느 기록에서 나왔는지 말한다.
    expect(result.draftEvals[0]?.basis).toContain("run-fixture-0002");
    expect(result.draftEvals[1]?.basis).toContain("run-fixture-0003");
    expect(result.unfilled).toEqual([]);
  });

  it("leaves the requirement column blank -- the runtime does not know requirements", () => {
    const result = draftEvalsFromRuns(loadIr(), THREE());
    for (const row of result.requirementLinksToFill) expect(row.requirement).toBeNull();
  });

  it("gives every draft an id no existing eval is using", () => {
    const ir = loadIr();
    const result = draftEvalsFromRuns(ir, THREE());
    const taken = new Set(ir.evals.map((entry) => entry.id));
    for (const draft of result.draftEvals) expect(taken.has(draft.id)).toBe(false);
    expect(result.draftEvals.map((draft) => draft.id)).toEqual(["E7", "E8"]);
  });

  it("사람이 초안에 먼저 쓴 E7 과 겹치지 않는다 — 실패 사례가 조용히 빠지지 않는다", () => {
    const ir = loadIr();
    const draft: Ir = { ...ir, evals: [...ir.evals, { ...ir.evals[0]!, id: "E7", input: "사람이 직접 쓴 평가" }] };
    const result = draftEvalsFromRuns(ir, THREE(), { draft });
    expect(result.draftEvals.map((row) => row.id)).toEqual(["E8", "E9"]);
    expect(result.draftEvals.every((row) => !row.inDraft)).toBe(true);
    expect(draftsAsIrEvals(result).map((row) => row.id)).toEqual(["E8", "E9"]);
  });

  it("초안에 이미 넣은 실패는 id 가 아니라 (노드, 실패 종류)로 알아보고 다시 내보내지 않는다", () => {
    const ir = loadIr();
    const first = draftEvalsFromRuns(ir, THREE());
    const draft: Ir = { ...ir, evals: [...ir.evals, ...draftsAsIrEvals(first)] };
    const again = draftEvalsFromRuns(ir, THREE(), { draft });
    expect(again.draftEvals.map((row) => [row.id, row.inDraft])).toEqual([
      ["E7", true],
      ["E8", true],
    ]);
    expect(draftsAsIrEvals(again)).toEqual([]);
  });

  it("makes one case out of twenty identical failures, keeping every run id in the basis", () => {
    const refused = loadRecord("refused.json");
    const many = Array.from({ length: 20 }, (_, index) => ({ ...refused, runId: `run-${index}` }));
    const result = draftEvalsFromRuns(loadIr(), many);
    expect(result.draftEvals).toHaveLength(1);
    expect(result.from).toHaveLength(20);
    expect(result.draftEvals[0]?.basis).toContain("run-19");
  });

  it("leaves expect empty rather than inventing one, and says which draft needs it", () => {
    const ir = loadIr();
    // `explain` 에 평가가 없으면 기대값을 옮겨 올 곳이 없다.
    const bare: Ir = { ...ir, evals: ir.evals.filter((entry) => entry.node !== "explain") };
    const result = draftEvalsFromRuns(bare, THREE());
    expect(result.draftEvals.every((draft) => draft.expect === "")).toBe(true);
    expect(result.unfilled).toEqual(result.draftEvals.map((draft) => draft.id));
  });

  it("skips a failure it cannot file, and says why", () => {
    const refused = loadRecord("refused.json");
    const result = draftEvalsFromRuns(loadIr(), [
      { ...refused, runId: "r-a", irVersion: 9 },
      { ...refused, runId: "r-b", nodeId: null, error: null, status: "error" },
      { ...refused, runId: "r-c", error: { ...refused.error!, nodeId: "ghost" } },
    ]);
    expect(result.draftEvals).toEqual([]);
    expect(result.skipped.map((row) => row.runId)).toEqual(["r-a", "r-b", "r-c"]);
    expect(result.skipped[0]?.why).toContain("irVersion 9");
    expect(result.skipped[2]?.why).toContain("설계에 없다");
  });

  it("hands back rows shaped like evals[], and nothing else", () => {
    const rows = draftsAsIrEvals(draftEvalsFromRuns(loadIr(), THREE()));
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["expect", "id", "input", "kind", "node"]);
      expect(row.kind).toBe("deterministic");
    }
  });
});

describe("5.6 비용 한도", () => {
  it("reports a breach without pretending it stopped anything", () => {
    const report = checkBudget({ tokensPerRun: 500, costUsdPerRun: 0.002, why: "시험" }, THREE());
    expect(report.checked).toBe(3);
    expect(report.breaches.map((breach) => `${breach.runId}:${breach.kind}`)).toEqual([
      "run-fixture-0001:tokens",
      "run-fixture-0001:cost",
    ]);
    expect(report.breaches[0]).toMatchObject({ limit: 500, actual: 516, over: 16 });
  });

  it("treats an absent budget as no ceiling, not as a ceiling of zero", () => {
    const report = checkBudget(undefined, THREE());
    expect(report.budget).toBeNull();
    expect(report.breaches).toEqual([]);
    expect(report.totals.tokens).toBe(1306);
  });

  it("names the runs whose cost it could not judge", () => {
    const record = loadRecord("success.json");
    const noCost: RunRecord = { ...record, usage: { inputTokens: 1, outputTokens: 1 } };
    const report = checkBudget({ costUsdPerRun: 0.001, why: "" }, [noCost]);
    expect(report.costUnknown).toEqual(["run-fixture-0001"]);
    expect(report.breaches).toEqual([]);
    expect(report.totals.costUsd).toBeNull();
  });
});

describe("V.3 버전 비교", () => {
  const run = (irVersion: number, ids: string[], statuses: Array<"pass" | "fail">, score?: number): EvalRun => ({
    irVersion,
    ranAt: "2026-09-30T00:00:00.000Z",
    how: "고정 응답 어댑터",
    results: ids.map((evalId, index) => ({
      evalId,
      kind: score === undefined ? ("deterministic" as const) : ("model" as const),
      status: statuses[index] ?? "pass",
      ...(score === undefined ? {} : { score }),
    })),
  });

  const side = (version: number, evalRun: EvalRun | null, models: string[]): VersionRecord => ({
    version,
    dir: `/tmp/v${version}`,
    ir: null,
    score: evalRun ? scoreEvalRun(evalRun) : null,
    models,
    notes: [],
  });

  it("puts two versions side by side when the eval set is the same", () => {
    const before = side(1, run(1, ["E1", "E2", "E3"], ["pass", "fail", "pass"]), ["claude-opus-5"]);
    const after = side(2, run(2, ["E1", "E2", "E3"], ["pass", "pass", "pass"]), ["claude-opus-5"]);
    const result = compareVersions(before, after, THREE());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.before.score?.passed).toBe(2);
    expect(result.after.score?.passed).toBe(3);
    expect(result.modelChanged).toBe(false);
  });

  /** 명세 §6.2 — 평가가 바뀌었으면 점수를 나란히 놓지 않는다. */
  it("refuses to compare when the eval set changed, and names what moved", () => {
    const before = side(1, run(1, ["E1", "E2"], ["pass", "pass"]), ["claude-opus-5"]);
    const after = side(2, run(2, ["E1", "E2", "E7"], ["pass", "pass", "pass"]), ["claude-opus-5"]);
    const result = compareVersions(before, after, []);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("should have refused");
    expect(result.reason).toContain("평가 묶음이 다르다");
    expect(result.reason).toContain("E7");
  });

  it("refuses when one side never recorded results", () => {
    const result = compareVersions(side(1, null, []), side(2, run(2, ["E1"], ["pass"]), []), []);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("should have refused");
    expect(result.reason).toContain("v1 의 평가 결과가 없다");
  });

  /** V.4 — 모델을 바꾸면 교체 전후 점수와 비용을 함께 보여 준다. */
  it("shows the model change with both sides' score and cost", () => {
    const before = side(1, run(1, ["E6"], ["pass"], 4), ["claude-opus-5"]);
    const after = side(2, run(2, ["E6"], ["pass"], 5), ["claude-haiku-4-5-20251001"]);
    const records = THREE().map((record) => ({ ...record, irVersion: 1 }));
    const result = compareVersions(before, after, records);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.modelChanged).toBe(true);
    expect(result.before.score?.meanScore).toBe(4);
    expect(result.after.score?.meanScore).toBe(5);
    // v1의 기록만 v1 쪽에 붙는다.
    expect(result.before.usage.runs).toBe(3);
    expect(result.before.usage.costUsd).toBeCloseTo(0.0056, 6);
    expect(result.after.usage).toEqual({ runs: 0, tokens: 0, costUsd: null });
  });

  it("summarizes deterministic and model-scored evals apart", () => {
    const mixed: EvalRun = {
      irVersion: 1,
      ranAt: "2026-09-30T00:00:00.000Z",
      how: "",
      results: [
        { evalId: "E1", kind: "deterministic", status: "pass" },
        { evalId: "E2", kind: "deterministic", status: "fail" },
        { evalId: "E3", kind: "deterministic", status: "skip" },
        { evalId: "E6", kind: "model", status: "pass", score: 3 },
      ],
    };
    const score = scoreEvalRun(mixed);
    expect(score).toMatchObject({ total: 4, passed: 2, failed: 1, skipped: 1, meanScore: 3, scored: 1 });
    expect(score.ids).toEqual(["E1", "E2", "E3", "E6"]);
  });
});

describe("5.1 · 5.2 LangGraph 어댑터 정규화", () => {
  const lgRun = (over: Record<string, unknown> = {}) => ({
    run_id: "lg-0001",
    thread_id: "th-1",
    assistant_id: "triage",
    status: "success",
    created_at: "2026-09-30T01:00:00.000Z",
    updated_at: "2026-09-30T01:00:02.500Z",
    metadata: { graph_id: "triage" },
    ...over,
  });

  const callLog = (over: Record<string, unknown> = {}) => ({
    values: {
      [CALL_LOG_STATE_KEY]: {
        modelCalls: [
          { nodeId: "explain", model: "claude-opus-5", provider: "anthropic", status: "success", ms: 900 },
        ],
        toolCalls: [{ nodeId: "pick", tool: "write-draft", caps: ["cap:draft"], status: "success" }],
        documentCalls: [{ nodeId: "pick", path: "guides/bug.md", level: 1, via: "pick -[CONSULTS]-> D1" }],
        usage: { inputTokens: 300, outputTokens: 50, costUsd: 0.002 },
        ...over,
      },
    },
  });

  it("turns a finished LangGraph run plus the graph's own call log into a §5.2 record", () => {
    const result = normalizeLangGraphRun({ run: lgRun(), state: callLog(), irVersion: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.record).toMatchObject({
      runId: "lg-0001",
      graphId: "triage",
      irVersion: 1,
      status: "success",
      error: null,
    });
    expect(result.record.documentCalls[0]?.via).toBe("pick -[CONSULTS]-> D1");
    // 정규화 결과가 설계와 대조까지 통과한다 -- 형식만 맞는 게 아니라 쓸 수 있다.
    const compared = compareRunsToDesign(loadIr(), [result.record]);
    expect(compared.findings.filter((f) => f.kind !== "node-never-ran")).toEqual([]);
  });

  /**
   * The rule this whole normalizer exists for: LangGraph does not report tool
   * calls, so an adapter must not claim the graph called none.
   */
  it("names the fields the provider does not report instead of filling them with []", () => {
    const result = normalizeLangGraphRun({ run: lgRun(), irVersion: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("should have reported gaps");
    expect(result.gaps).toEqual(["modelCalls", "toolCalls", "documentCalls", "usage"]);
    expect(result.reason).toContain("빈 배열로 채우지 않는다");
    expect(result.reason).toContain(CALL_LOG_STATE_KEY);
  });

  it("fills the arrays it can and names only the one it cannot", () => {
    const partial = normalizeLangGraphRun({
      run: lgRun(),
      state: callLog({ toolCalls: "그런 거 없다" }),
      irVersion: 1,
    });
    expect(partial.ok).toBe(false);
    if (partial.ok) throw new Error("should have reported a gap");
    expect(partial.gaps).toEqual(["toolCalls"]);
  });

  it("does not collect a run that has not finished", () => {
    for (const status of ["pending", "running"]) {
      const result = normalizeLangGraphRun({ run: lgRun({ status }), state: callLog(), irVersion: 1 });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("should have refused");
      expect(result.reason).toContain("끝나지 않은 실행은 수집하지 않는다");
    }
  });

  /** refused 는 실행 상태가 아니라 모델 호출의 사실이다 — LangGraph에는 그런 상태가 없다. */
  it("reads a refusal off the model call, not off the run status", () => {
    const refusedLog = callLog({
      modelCalls: [
        { nodeId: "explain", model: "claude-opus-5", provider: "anthropic", status: "refused", ms: 780 },
      ],
    });
    const result = normalizeLangGraphRun({ run: lgRun({ status: "error" }), state: refusedLog, irVersion: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.record.status).toBe("refused");
    expect(result.record.error).toMatchObject({ kind: "refusal", nodeId: "explain" });

    // 같은 로그인데 실행이 성공했다면 거절로 바꾸지 않는다.
    const ok = normalizeLangGraphRun({ run: lgRun(), state: refusedLog, irVersion: 1 });
    if (!ok.ok) throw new Error(ok.reason);
    expect(ok.record.status).toBe("success");
  });

  it("maps a human interrupt to error, never to refused", () => {
    const result = normalizeLangGraphRun({ run: lgRun({ status: "interrupted" }), state: callLog(), irVersion: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.record.status).toBe("error");
  });

  it("puts a timeout on the node whose model call timed out", () => {
    const result = normalizeLangGraphRun({
      run: lgRun({ status: "timeout" }),
      state: callLog({
        modelCalls: [
          { nodeId: "explain", model: "claude-opus-5", provider: "anthropic", status: "timeout", ms: 20000 },
        ],
      }),
      irVersion: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.record).toMatchObject({ status: "timeout", nodeId: "explain" });
    expect(result.record.error).toMatchObject({ kind: "timeout", nodeId: "explain" });
  });

  it("refuses a response with no run_id at all", () => {
    expect(normalizeLangGraphRun({ run: { status: "success" }, irVersion: 1 }).ok).toBe(false);
    expect(normalizeLangGraphRun({ run: "nope", irVersion: 1 }).ok).toBe(false);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CALL_LOG_STATE_KEY,
  ensureStudioInitialized,
  inferredSchema,
  parseIr,
  projectRunsDir,
  readIrFile,
  registerProject,
  setOverlayIr,
  writeInferred,
  writeOverlayIfAbsent,
} from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { collectLangGraphRuns } from "./langgraphRuns.js";
import type { LangGraphPort } from "./langgraphAdapter.js";
import { loadRunsView, writeDraftEvalsView } from "./runsView.js";
import { draftEvalsAction, draftEvalsNote, isRunsViewOk } from "./runsContract.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_IR = path.resolve(HERE, "..", "..", "..", "packages", "core", "src", "ir", "__fixtures__", "valid.ir.yaml");
const RUNS_FIXTURES = path.resolve(HERE, "..", "..", "..", "packages", "core", "src", "runs", "__fixtures__");

const SAMPLE_INFERRED = inferredSchema.parse({
  discoveredPorts: ["source:README.md"],
  git: { branch: "main", head: "abc1234", recentCommitSubjects: ["init"] },
  agents: [],
});

async function adoptedStudio(alias = "demo"): Promise<string> {
  const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-runsview-"));
  await ensureStudioInitialized(studioHome);
  await registerProject(studioHome, { alias, kind: "local_repo", path: "/tmp/a" });
  await writeInferred(studioHome, alias, SAMPLE_INFERRED);
  await writeOverlayIfAbsent(studioHome, alias);
  const read = await readIrFile(FIXTURE_IR);
  if (!read.ok) throw new Error(read.error);
  const parsed = parseIr(read.raw);
  if (!parsed.ok) throw new Error(parsed.error);
  await setOverlayIr(studioHome, alias, parsed.ir);
  return studioHome;
}

function seedRuns(studioHome: string, alias: string, names: readonly string[]): void {
  const dir = projectRunsDir(studioHome, alias);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of names) {
    const raw = JSON.parse(fs.readFileSync(path.join(RUNS_FIXTURES, `${name}.json`), "utf8"));
    fs.writeFileSync(path.join(dir, `${raw.runId}.json`), JSON.stringify(raw, null, 2), "utf8");
  }
}

describe("loadRunsView", () => {
  it("answers with LangGraph down -- the files are the original", async () => {
    const studioHome = await adoptedStudio();
    seedRuns(studioHome, "demo", ["success", "refused", "timeout"]);
    const result = await loadRunsView(studioHome, "demo");
    expect(result.ok).toBe(true);
    if (!result.ok || !isRunsViewOk(result.body)) throw new Error("expected ok");
    expect(result.body.compare.byStatus).toEqual({ success: 1, refused: 1, timeout: 1, error: 0 });
    expect(result.body.drafts.ids).toEqual(["E7", "E8"]);
    expect(result.body.versions.map((entry) => entry.version)).toEqual([1]);
    // 버전이 하나면 나란히 놓을 것이 없다.
    expect(result.body.pair).toBeNull();
  });

  it("says there is no design rather than reporting an empty comparison", async () => {
    const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-runsview-"));
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
    await writeInferred(studioHome, "demo", SAMPLE_INFERRED);
    await writeOverlayIfAbsent(studioHome, "demo");
    const result = await loadRunsView(studioHome, "demo");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.body.status).toBe("no-design");
  });

  it("returns 400 without an alias and 404 for an unregistered one", async () => {
    const studioHome = await adoptedStudio();
    const missing = await loadRunsView(studioHome, undefined);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.status).toBe(400);
    const unknown = await loadRunsView(studioHome, "nope");
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.status).toBe(404);
  });
});

describe("collectLangGraphRuns", () => {
  const lgRun = (over: Record<string, unknown> = {}) => ({
    run_id: "lg-1",
    status: "success",
    created_at: "2026-09-30T01:00:00.000Z",
    updated_at: "2026-09-30T01:00:02.000Z",
    metadata: { graph_id: "triage" },
    ...over,
  });

  const port = (runs: unknown[], state: unknown): LangGraphPort =>
    ({
      url: "http://127.0.0.1:2024",
      probe: async () => true,
      listRuns: async () => runs,
      getState: async () => state,
    }) as unknown as LangGraphPort;

  const state = {
    values: {
      [CALL_LOG_STATE_KEY]: {
        modelCalls: [{ nodeId: "explain", model: "claude-opus-5", provider: "anthropic", status: "success", ms: 800 }],
        toolCalls: [{ nodeId: "pick", tool: "write-draft", caps: ["cap:draft"], status: "success" }],
        documentCalls: [{ nodeId: "pick", path: "guides/bug.md", level: 1 }],
        usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.001 },
      },
    },
  };

  it("writes one file per run and stamps it with the approved design's version", async () => {
    const studioHome = await adoptedStudio();
    const result = await collectLangGraphRuns(studioHome, "demo", "th-1", port([lgRun()], state));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.body.collected).toHaveLength(1);
    expect(result.body.collected[0]?.record.irVersion).toBe(1);
    expect(fs.existsSync(path.join(projectRunsDir(studioHome, "demo"), "lg-1.json"))).toBe(true);
  });

  /** 빈 배열로 채우지 않는다 — 「안 불렀다」와 「기록이 없다」는 다른 사실이다 (§5.2). */
  it("reports a run it cannot complete instead of writing one with empty arrays", async () => {
    const studioHome = await adoptedStudio();
    const result = await collectLangGraphRuns(studioHome, "demo", "th-1", port([lgRun()], {}));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.body.collected).toEqual([]);
    expect(result.body.incomplete[0]?.gaps).toContain("toolCalls");
    expect(fs.existsSync(path.join(projectRunsDir(studioHome, "demo"), "lg-1.json"))).toBe(false);
  });

  it("refuses without an approved design -- there would be no version to stamp", async () => {
    const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-runsview-"));
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
    await writeOverlayIfAbsent(studioHome, "demo");
    const result = await collectLangGraphRuns(studioHome, "demo", "th-1", port([lgRun()], state));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("should have refused");
    expect(result.status).toBe(404);
    expect(result.error).toContain("irVersion");
  });

  it("refuses with the sidecar down, and without a thread", async () => {
    const studioHome = await adoptedStudio();
    const down = { ...port([], null), probe: async () => false } as LangGraphPort;
    const offline = await collectLangGraphRuns(studioHome, "demo", "th-1", down);
    expect(offline.ok).toBe(false);
    if (!offline.ok) expect(offline.status).toBe(503);

    const noThread = await collectLangGraphRuns(studioHome, "demo", undefined, port([], null));
    expect(noThread.ok).toBe(false);
    if (!noThread.ok) expect(noThread.status).toBe(400);
  });
});

describe("writeDraftEvalsView — 「평가 초안 넣기」", () => {
  it("초안에만 쓰고 승인본은 그대로다 · 다 들어가면 버튼이 「검토」로 바뀐다", async () => {
    const studioHome = await adoptedStudio();
    seedRuns(studioHome, "demo", ["success", "refused", "timeout"]);
    const overlayFile = path.join(path.dirname(projectRunsDir(studioHome, "demo")), "overlay.yaml");
    const approvedBefore = fs.readFileSync(overlayFile, "utf8");

    const before = await loadRunsView(studioHome, "demo");
    if (!before.ok || !isRunsViewOk(before.body)) throw new Error("expected ok");
    expect(before.body.drafts.inDraft).toEqual([]);
    expect(draftEvalsAction(before.body.drafts)).toBe("write");

    const wrote = await writeDraftEvalsView(studioHome, "demo");
    if (!wrote.ok) throw new Error(wrote.error);
    expect(wrote.body.added).toEqual(["E7", "E8"]);
    expect(wrote.body.startedFrom).toBe("approved");
    expect(draftEvalsNote(wrote.body)).toContain("승인된 설계는 그대로다");
    expect(fs.readFileSync(overlayFile, "utf8")).toBe(approvedBefore);

    const after = await loadRunsView(studioHome, "demo");
    if (!after.ok || !isRunsViewOk(after.body)) throw new Error("expected ok");
    expect(after.body.drafts.inDraft).toEqual(["E7", "E8"]);
    expect(draftEvalsAction(after.body.drafts)).toBe("review");

    // 두 번 눌러도 같은 평가가 두 번 들어가지 않는다.
    const again = await writeDraftEvalsView(studioHome, "demo");
    expect(again).toMatchObject({ ok: false, status: 409 });
  });

  it("사람이 초안에 먼저 쓴 E7 이 있어도 실패 사례는 다른 id 로 다 들어가고, 화면은 들어간 것만 들어갔다고 한다", async () => {
    const studioHome = await adoptedStudio();
    seedRuns(studioHome, "demo", ["success", "refused", "timeout"]);
    const read = await readIrFile(FIXTURE_IR);
    if (!read.ok) throw new Error(read.error);
    const parsed = parseIr(read.raw);
    if (!parsed.ok) throw new Error(parsed.error);
    const human = { ...parsed.ir, evals: [...parsed.ir.evals, { ...parsed.ir.evals[0]!, id: "E7", input: "사람이 직접 쓴 평가" }] };
    const draftFile = path.join(path.dirname(projectRunsDir(studioHome, "demo")), "ir.proposed.yaml");
    // YAML 은 JSON 을 그대로 읽는다 — 콘솔은 yaml 패키지를 따로 갖지 않는다.
    fs.writeFileSync(draftFile, JSON.stringify(human, null, 2), "utf8");

    const before = await loadRunsView(studioHome, "demo");
    if (!before.ok || !isRunsViewOk(before.body)) throw new Error("expected ok");
    expect(before.body.drafts.ids).toEqual(["E8", "E9"]);
    expect(before.body.drafts.inDraft).toEqual([]);

    const wrote = await writeDraftEvalsView(studioHome, "demo");
    if (!wrote.ok) throw new Error(wrote.error);
    expect(wrote.body.added).toEqual(["E8", "E9"]);
    expect(fs.readFileSync(draftFile, "utf8")).toContain("사람이 직접 쓴 평가");

    const after = await loadRunsView(studioHome, "demo");
    if (!after.ok || !isRunsViewOk(after.body)) throw new Error("expected ok");
    expect(after.body.drafts.inDraft).toEqual(["E8", "E9"]);
    expect(draftEvalsAction(after.body.drafts)).toBe("review");
  });

  it("실패 기록이 없으면 409, 설계가 없으면 409, 모르는 이름은 404", async () => {
    const studioHome = await adoptedStudio();
    seedRuns(studioHome, "demo", ["success"]);
    expect(await writeDraftEvalsView(studioHome, "demo")).toMatchObject({ ok: false, status: 409 });
    expect(await writeDraftEvalsView(studioHome, "nope")).toMatchObject({ ok: false, status: 404 });

    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-runsview-"));
    await ensureStudioInitialized(bare);
    await registerProject(bare, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
    await writeOverlayIfAbsent(bare, "demo");
    expect(await writeDraftEvalsView(bare, "demo")).toMatchObject({ ok: false, status: 409 });
  });
});

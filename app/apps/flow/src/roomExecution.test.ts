import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readIrFile, parseIr, readRoom, readRoomMeta, readOverlay, registerProject, setOverlayIr } from "@patchbay/core";
import { createRoomExecutionHost, type CommandRunner } from "./roomExecution.js";
import { saveRoomCast, codexRoomArgs, type RoomRunner } from "./roomHost.js";
import { ROOM_WORKFLOW_SOURCE } from "./roomWorkflowTemplate.js";
import type { LangGraphPort } from "./langgraphAdapter.js";

/** Runs the actual generated node callbacks; only the LangGraph transport/interrupt scheduler is a test double. */
function graphPort(): LangGraphPort {
  type State = Record<string, any>;
  const nodes = new Map<string, (state: State) => State>();
  const routes = new Map<string, string | ((state: State) => string)>();
  let value: any; let pending: any; let state: State = {}; let node = "prepare";
  const interrupt = (request: any) => {
    if (value !== undefined) { const response = value; value = undefined; return response; }
    throw { request };
  };
  class Builder {
    addNode(id: string, fn: (s: State) => State) { nodes.set(id, fn); return this; }
    addEdge(id: string, next: string) { routes.set(id, next); return this; }
    addConditionalEdges(id: string, fn: (s: State) => string) { routes.set(id, fn); return this; }
    compile() { return this; }
  }
  const Annotation = Object.assign(() => ({}), { Root: (value: unknown) => value });
  const code = ts.transpileModule(ROOM_WORKFLOW_SOURCE, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  vm.runInNewContext(code.outputText, { exports: {}, require: () => ({ Annotation, StateGraph: Builder, START: "__start__", END: "__end__", interrupt }) });
  return {
    url: "http://graph.test", probe: async () => true,
    listAssistants: async () => [{ id: "ops", name: "Operations", graphId: "patchbay-operations" }],
    getGraph: async () => null, listThreads: async () => [], listRuns: async () => [], listHistory: async () => [],
    createThread: async () => "thread-1",
    getState: async () => ({ values: state, next: node === "__end__" ? [] : [node], tasks: pending ? [{ name: node, interrupts: [{ value: pending }] }] : [] }),
    waitRun: async input => {
      if (input.command) value = input.command.resume;
      else { state = input.input as State; node = "prepare"; }
      pending = undefined;
      for (let i = 0; i < 50 && node !== "__end__"; i++) {
        try { Object.assign(state, nodes.get(node)!(state)); }
        catch (e) { if ((e as { request?: unknown }).request) { pending = (e as { request: unknown }).request; break; } throw e; }
        const route = routes.get(node)!; node = typeof route === "string" ? route : route(state);
      }
      return { status: "ok", body: state };
    },
  };
}
async function setup(options: { testPass?: boolean; deploy?: boolean; leaderReply?: string; runnerGate?: Promise<void> } = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pb-operations-"));
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "pb-operations-repo-"));
  await registerProject(home, { alias: "demo", kind: "local_repo", path: repo });
  const fixture = await readIrFile(fileURLToPath(new URL("../../../packages/core/src/ir/__fixtures__/valid.ir.yaml", import.meta.url)));
  if (!fixture.ok) throw new Error(fixture.error);
  const parsed = parseIr(fixture.raw); if (!parsed.ok) throw new Error(parsed.error);
  await setOverlayIr(home, "demo", { ...parsed.ir, version: 1 });
  const cast = await saveRoomCast(home, { alias: "demo", members: [
    { id: "leader", speaker: "codex", model: "selected-model", effort: "high", role: "수행", enabled: true },
    { id: "reviewer", speaker: "claude-code", model: "review-model", effort: "high", role: "검토", enabled: true },
  ] });
  if (!cast.ok) throw new Error(cast.error);
  const calls: Parameters<RoomRunner>[0][] = []; const commands: string[][] = [];
  let testPass = options.testPass ?? true;
  const runner: RoomRunner = async req => {
    calls.push(req);
    await options.runnerGate;
    if (req.prompt.includes("너는 운영 리더")) return { ok: true, text: options.leaderReply ?? JSON.stringify({ assignments: [{ id: "T-1", memberId: "leader", requirementIds: parsed.ir.requirements.map(r => r.id), instruction: "승인본 구현", complexity: "low", reason: "범위가 명확하다", effort: "low" }] }), ms: 3 };
    if (req.prompt.includes("독립 검토자다")) return { ok: true, text: JSON.stringify({ outcome: "passed", reason: "승인 기준 확인", evidence: ["시험 로그와 변경 확인"] }), ms: 4 };
    return { ok: true, text: "승인본 구현 결과", ms: 5 };
  };
  const command: CommandRunner = async argv => { commands.push(argv); return { passed: argv[0] === "deploy-tool" || testPass, code: testPass ? 0 : 1, text: "검증 로그", ms: 2 }; };
  const port = graphPort();
  const host = createRoomExecutionHost(home, { port, runner, bin: "fake", command });
  const start = () => host.start({ alias: "demo", roomId: cast.roomId, leaderId: "leader", reviewerId: "reviewer", testCommand: ["test-tool"], allowEdits: true,
    ...(options.deploy ? { deployCommand: ["deploy-tool"], deployTarget: "staging" } : {}) });
  const read = async () => (await readRoomMeta(home, "demo", cast.roomId)).execution!;
  const action = async (name: string, extra: object = {}) => {
    const result = await host.action({ alias: "demo", roomId: cast.roomId, executionId: (await read()).id, action: name, ...extra });
    if (result.ok) await result.done; return result;
  };
  return { home, repo, roomId: cast.roomId, host, port, start, read, action, calls, commands, setTestPass: (pass: boolean) => { testPass = pass; } };
}
async function startAndWait(f: Awaited<ReturnType<typeof setup>>) { const r = await f.start(); if (!r.ok) throw new Error(r.error); await r.done; }

describe("상담 Plan을 받아 수행하는 운영 대화", () => {
  it("운영 실행 중인 프로젝트를 시작부터 끝까지 알린다", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const f = await setup({ runnerGate: gate });
    const result = await f.start();
    if (!result.ok) throw new Error(result.error);
    expect(f.host.busyAliases()).toEqual(["demo"]);
    release();
    await result.done;
    expect(f.host.busyAliases()).toEqual([]);
  });

  it("리더 배정을 확인한 뒤 수행·시험·독립 검토하며 사용자 모델·강도를 유지한다", async () => {
    const f = await setup(); await startAndWait(f);
    expect((await f.read()).phase).toBe("approval");
    expect(f.calls).toHaveLength(1);
    await f.action("approve");
    expect((await f.read()).phase).toBe("deploy_approval");
    expect(f.calls[1]?.effort).toBe("high");
    expect(f.calls[1]?.model).toBe("selected-model");
    expect(f.calls[1]?.execution).toBe("edit");
    expect(f.calls[2]?.execution).toBe("read");
    expect(f.commands).toEqual([["test-tool"]]);
    await f.action("finish"); expect((await f.read()).phase).toBe("done");
    expect((await readOverlay(f.home, "demo")).ir?.version).toBe(1);
    expect((await readRoom(f.home, "demo", f.roomId))?.messages.some(m => m.role === "operation" && m.stage === "check")).toBe(true);
  });
  it("자동 시험 실패는 LLM이 passed라고 해도 배포를 막고 Act로 돌아간다", async () => {
    const f = await setup({ testPass: false, deploy: true }); await startAndWait(f); await f.action("approve");
    expect((await f.read()).phase).toBe("check_failed");
    expect((await f.action("deploy", { target: "staging" })).ok).toBe(false);
    expect(f.commands.some(c => c[0] === "deploy-tool")).toBe(false);
    f.setTestPass(true); await f.action("retry");
    expect((await f.read()).phase).toBe("deploy_approval");
    expect((await f.action("deploy", { target: "production" })).ok).toBe(false);
    await f.action("deploy", { target: "staging" });
    expect((await f.read()).phase).toBe("done");
    expect(f.commands.filter(c => c[0] === "deploy-tool")).toHaveLength(1);
    expect((await f.action("deploy", { target: "staging" })).ok).toBe(false);
  });
  it("추천 강도는 사용자가 적용한 경우에만 사용한다", async () => {
    const f = await setup(); await startAndWait(f); await f.action("approve", { useRecommendedEffort: true });
    expect(f.calls[1]?.effort).toBe("low");
    expect(codexRoomArgs("hello", "chosen", "low")).toContain('model_reasoning_effort="low"');
  });
  it("요구 변경은 실행을 대기시키며 상담 원문·초안을 쓰지 않는다", async () => {
    const f = await setup(); await startAndWait(f);
    await f.action("consult", { note: "새 요구 검토" });
    expect((await f.read()).phase).toBe("consult");
    expect((await f.action("approve")).ok).toBe(false);
    expect(f.calls).toHaveLength(1);
    expect((await readRoom(f.home, "demo", f.roomId))?.messages.at(-1)?.role).toBe("operation");
    await expect(fs.access(path.join(f.home, "projects/demo/ir.proposed.yaml"))).rejects.toThrow();
    await expect(fs.access(path.join(f.home, "projects/demo/consult"))).rejects.toThrow();
  });
  it("채택본이 바뀌면 이전 실행의 승인을 거절한다", async () => {
    const f = await setup(); await startAndWait(f);
    const overlay = await readOverlay(f.home, "demo"); await setOverlayIr(f.home, "demo", { ...overlay.ir!, version: 2 });
    expect((await f.action("approve")).ok).toBe(false); expect(f.calls).toHaveLength(1);
  });
  it("완료 기록을 재사용해 체크포인트 재개가 실패해도 모델 작업을 중복 수행하지 않는다", async () => {
    const f = await setup(); let reject = true; const original = f.port.waitRun;
    f.port.waitRun = async input => { if (input.command && reject) { reject = false; return { status: "error", error: "connection lost" }; } return original(input); };
    await startAndWait(f); expect((await f.read()).phase).toBe("uncertain");
    expect(f.calls).toHaveLength(1); await f.action("sync"); expect(f.calls).toHaveLength(1);
    expect((await f.read()).phase).toBe("approval");
  });
  it("재시작 후 시작 기록만 남은 작업은 자동 재실행하지 않는다", async () => {
    const f = await setup(); await startAndWait(f);
    const ex = await f.read();
    const texts = (await readRoom(f.home, "demo", f.roomId))!.messages.filter(m => !(m.role === "operation" && m.status === "completed") && m.role !== "speaker");
    await fs.writeFile(path.join(f.home, "projects/demo/rooms", `${f.roomId}.jsonl`), texts.map(m => JSON.stringify(m)).join("\n") + "\n");
    // Put the graph back at the same request as a crash before resume.
    await f.port.waitRun({ threadId: ex.threadId, assistantId: ex.assistantId, input: { execution: ex, phase: "prepare" } });
    const restarted = createRoomExecutionHost(f.home, { port: f.port, runner: async () => { throw new Error("must not call"); }, bin: "fake" });
    const result = await restarted.action({ alias: "demo", roomId: f.roomId, executionId: ex.id, action: "sync" });
    if (!result.ok) throw new Error(result.error); await result.done;
    expect((await f.read()).phase).toBe("uncertain"); expect((await f.read()).error).toContain("시작 기록만");
  });
  it("리더의 미등록 담당 배정은 실패하고 프로젝트 설정의 다른 그래프는 보존한다", async () => {
    const f = await setup({ leaderReply: JSON.stringify({ assignments: [{ id: "T-1", memberId: "unknown", requirementIds: ["unknown"], instruction: "bad", complexity: "high", reason: "bad" }] }) });
    await startAndWait(f); expect((await f.read()).phase).toBe("failed");
    await fs.writeFile(path.join(f.repo, "langgraph.json"), JSON.stringify({ node_version: "20", graphs: { main: "./graph.ts:graph" }, env: ".env" }));
    await f.host.install("demo");
    const config = JSON.parse(await fs.readFile(path.join(f.repo, "langgraph.json"), "utf8"));
    expect(config.graphs.main).toBe("./graph.ts:graph"); expect(config.env).toBe(".env");
    expect(config.graphs["patchbay-operations"]).toBe("./patchbay-operations.ts:graph");
    expect(ROOM_WORKFLOW_SOURCE).not.toMatch(/sqlite|MemorySaver/);
    expect((await f.host.start({})).ok).toBe(false);
  });
  it("채택본이 없으면 LangGraph 실행을 시작하지 않는다", async () => {
    const f = await setup();
    const file = path.join(f.home, "projects/demo/overlay.yaml"); await fs.writeFile(file, "decisions: []\npatches: []\nwires: []\n");
    expect((await f.start()).ok).toBe(false); expect(f.calls).toHaveLength(0);
  });
});

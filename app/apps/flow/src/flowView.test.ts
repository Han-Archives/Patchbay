import { describe, expect, it } from "vitest";
import type { LangGraphPort } from "./langgraphAdapter.js";
import { delegateFlowRun, loadFlowView } from "./flowView.js";

const SAMPLE_GRAPH = {
  nodes: [
    { id: "__start__" },
    { id: "draft", data: { name: "draft" } },
    { id: "__end__" },
  ],
  edges: [
    { source: "__start__", target: "draft" },
    { source: "draft", target: "__end__" },
  ],
};

function fakePort(overrides: Partial<LangGraphPort> = {}): LangGraphPort {
  const port: LangGraphPort = {
    url: "http://langgraph.test",
    probe: async () => true,
    listAssistants: async () => [{ id: "agent", name: "agent", graphId: "agent" }],
    getGraph: async () => SAMPLE_GRAPH,
    listThreads: async () => [{ id: "t1", updatedAt: "2026-09-18T00:00:00Z" }],
    getState: async () => ({
      values: { original: "원문 샘플", summary: "정리 샘플" },
      next: ["draft"],
      checkpoint: { checkpoint_id: "ckpt-1", checkpoint_ns: "" },
      tasks: [],
    }),
    listRuns: async () => [{ status: "success" }],
    listHistory: async () => [],
    createThread: async () => "t-new",
    waitRun: async () => ({ status: "ok", body: {} }),
    ...overrides,
  };
  return port;
}

describe("loadFlowView", () => {
  it("returns disconnected without probing when no port is attached", async () => {
    const view = await loadFlowView(undefined, {}, "http://127.0.0.1:2024");
    expect(view).toEqual({ status: "disconnected", url: "http://127.0.0.1:2024" });
  });

  it("returns disconnected when probe fails, without throwing", async () => {
    const view = await loadFlowView(
      fakePort({
        probe: async () => {
          throw new Error("network");
        },
      }),
    );
    expect(view.status).toBe("disconnected");
  });

  it("maps graph, current node, checkpoint, original, and summary", async () => {
    const view = await loadFlowView(fakePort());
    expect(view.status).toBe("connected");
    if (view.status !== "connected") return;
    expect(view.selectedAssistantId).toBe("agent");
    expect(view.currentNodes).toEqual(["draft"]);
    expect(view.checkpoint).toEqual({ id: "ckpt-1", ns: null });
    expect(view.original).toBe("원문 샘플");
    expect(view.summary).toBe("정리 샘플");
    expect(view.graph.nodes.map((n) => n.id)).toEqual(["__start__", "draft", "__end__"]);
    expect(view.empty).toBe("none");
  });

  it("marks an empty assistant list and an empty graph separately", async () => {
    const none = await loadFlowView(fakePort({ listAssistants: async () => [] }));
    expect(none.status === "connected" && none.empty).toBe("no_assistants");

    const emptyGraph = await loadFlowView(fakePort({ getGraph: async () => ({ nodes: [], edges: [] }) }));
    expect(emptyGraph.status === "connected" && emptyGraph.empty).toBe("no_nodes");
  });

  it("surfaces a failed run and a task error", async () => {
    const view = await loadFlowView(
      fakePort({
        listRuns: async () => [{ status: "error", error: "node blew up" }],
        getState: async () => ({ values: {}, next: [], tasks: [{ error: "node blew up" }] }),
      }),
    );
    expect(view.status === "connected" && view.run).toEqual({ status: "error", error: "node blew up" });
  });
});

describe("delegateFlowRun", () => {
  it("returns 503 when disconnected and 400 without assistantId", async () => {
    const down = await delegateFlowRun(undefined, { assistantId: "agent" });
    expect(down).toEqual({ ok: false, status: 503, error: "LangGraph 연결 안 됨" });

    const missing = await delegateFlowRun(fakePort(), {});
    expect(missing).toEqual({ ok: false, status: 400, error: "assistantId is required." });
  });

  it("creates a thread when none is given and waits on LangGraph", async () => {
    let waited: unknown;
    const view = await delegateFlowRun(
      fakePort({
        waitRun: async (input) => {
          waited = input;
          return { status: "ok", body: {} };
        },
      }),
      { assistantId: "agent", input: { q: 1 } },
    );
    expect(view.ok).toBe(true);
    expect(waited).toEqual({ threadId: "t-new", assistantId: "agent", input: { q: 1 } });
    if (view.ok && view.body.status === "connected") {
      expect(view.body.selectedThreadId).toBe("t-new");
    }
  });

  it("runs one node from the newest checkpoint that was waiting on it", async () => {
    let waited: unknown;
    const view = await delegateFlowRun(
      fakePort({
        // LangGraph hands history newest first.
        listHistory: async () => [
          { checkpoint: { checkpoint_id: "c3" }, next: [] },
          { checkpoint: { checkpoint_id: "c2" }, next: ["draft"] },
          { checkpoint: { checkpoint_id: "c1" }, next: ["draft"] },
        ],
        waitRun: async (input) => {
          waited = input;
          return { status: "ok", body: {} };
        },
      }),
      { assistantId: "agent", threadId: "t1", node: "draft" },
    );
    expect(view.ok).toBe(true);
    expect(waited).toEqual({ threadId: "t1", assistantId: "agent", input: null, checkpointId: "c2", interruptAfter: ["draft"] });
  });

  it("refuses to run one node the thread never reached", async () => {
    const view = await delegateFlowRun(fakePort(), { assistantId: "agent", threadId: "t1", node: "draft" });
    expect(view).toMatchObject({ ok: false, status: 409 });
    const noThread = await delegateFlowRun(fakePort(), { assistantId: "agent", node: "draft" });
    expect(noThread).toMatchObject({ ok: false, status: 400 });
  });

  it("keeps the shell payload connected when a run times out", async () => {
    const view = await delegateFlowRun(
      fakePort({
        waitRun: async () => ({ status: "timeout" }),
      }),
      { assistantId: "agent", threadId: "t1" },
    );
    expect(view.ok).toBe(true);
    if (view.ok && view.body.status === "connected") {
      expect(view.body.run.status).toBe("running");
      expect(view.body.warning).toMatch(/시간 제한/);
    }
  });

  it("a checkpointId forks the thread there and sends no new input", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const port = fakePort({
      listHistory: async () => [
        { checkpoint: { checkpoint_id: "c1" }, next: ["draft"] },
        { checkpoint: { checkpoint_id: "c2" }, next: [] },
      ],
      waitRun: async (args) => {
        seen.push({ ...args });
        return { status: "ok", body: {} };
      },
    });

    const result = await delegateFlowRun(port, {
      assistantId: "agent",
      threadId: "t1",
      input: { should: "be ignored" },
      checkpointId: "c1",
    });

    expect(result.ok).toBe(true);
    expect(seen[0]).toMatchObject({ threadId: "t1", assistantId: "agent", checkpointId: "c1" });
    // Rewinding replays the values already stored at that checkpoint.
    expect(seen[0]!.input).toBeNull();
  });

  it("a normal run carries the input and no checkpoint", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const port = fakePort({
      waitRun: async (args) => {
        seen.push({ ...args });
        return { status: "ok", body: {} };
      },
    });

    await delegateFlowRun(port, { assistantId: "agent", threadId: "t1", input: { a: 1 } });
    expect(seen[0]).toMatchObject({ input: { a: 1 } });
    expect(seen[0]!.checkpointId).toBeUndefined();
  });

  it("history reaches the view oldest first", async () => {
    const port = fakePort({
      listHistory: async () => [
        { checkpoint: { checkpoint_id: "newest" }, next: [] },
        { checkpoint: { checkpoint_id: "oldest" }, next: ["draft"] },
      ],
    });
    const view = await loadFlowView(port, { threadId: "t1" });
    if (view.status !== "connected") throw new Error("expected connected");
    expect(view.history.map((entry) => entry.id)).toEqual(["oldest", "newest"]);
  });
});

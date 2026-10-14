import { describe, expect, it } from "vitest";
import {
  checkpointFromState,
  currentNodesFromState,
  DEFAULT_LANGGRAPH_URL,
  listFromSearchBody,
  normalizeLangGraph,
  ORIGINAL_STATE_KEYS,
  parseAssistant,
  parseHistory,
  parseRun,
  parseThread,
  pickStateText,
  resolveLangGraphUrl,
  SUMMARY_STATE_KEYS,
  taskErrorFromState,
} from "./langgraphContract.js";

describe("resolveLangGraphUrl", () => {
  it("freezes the spec default", () => {
    expect(DEFAULT_LANGGRAPH_URL).toBe("http://127.0.0.1:2024");
    expect(resolveLangGraphUrl()).toBe(DEFAULT_LANGGRAPH_URL);
    expect(resolveLangGraphUrl("  ")).toBe(DEFAULT_LANGGRAPH_URL);
  });

  it("strips a trailing slash from an override", () => {
    expect(resolveLangGraphUrl("http://127.0.0.1:9999/")).toBe("http://127.0.0.1:9999");
  });
});

describe("pickStateText", () => {
  it("returns the first matching original/summary key and otherwise null", () => {
    expect(pickStateText({ source_text: "원문" }, ORIGINAL_STATE_KEYS)).toBe("원문");
    expect(pickStateText({ digest: "짧은 정리" }, SUMMARY_STATE_KEYS)).toBe("짧은 정리");
    expect(pickStateText({ messages: [] }, ORIGINAL_STATE_KEYS)).toBeNull();
    expect(pickStateText(null, ORIGINAL_STATE_KEYS)).toBeNull();
  });
});

describe("normalizeLangGraph", () => {
  it("reads langgraph-sdk graph JSON (id/source/target and data.name)", () => {
    const graph = normalizeLangGraph({
      nodes: [
        { id: "__start__" },
        { id: "draft", data: { name: "draft" } },
        { id: ["nested", "node"] },
      ],
      edges: [
        { source: "__start__", target: "draft" },
        { from: "draft", to: "nested:node" },
      ],
    });
    expect(graph.nodes.map((n) => n.id)).toEqual(["__start__", "draft", "nested:node"]);
    expect(graph.nodes[1]?.label).toBe("draft");
    expect(graph.edges).toEqual([
      { from: "__start__", to: "draft" },
      { from: "draft", to: "nested:node" },
    ]);
  });
});

describe("parsers", () => {
  it("parses assistant/thread search rows", () => {
    expect(parseAssistant({ assistant_id: "agent", name: "Agent", graph_id: "g" })).toEqual({
      id: "agent",
      name: "Agent",
      graphId: "g",
    });
    expect(parseThread({ thread_id: "t1", updated_at: "2026-09-18T00:00:00Z" })).toEqual({
      id: "t1",
      updatedAt: "2026-09-18T00:00:00Z",
    });
    expect(listFromSearchBody({ assistants: [{ assistant_id: "a" }] }, "assistants")).toHaveLength(1);
  });

  it("reads current nodes from state.next and checkpoint_id", () => {
    const state = {
      next: ["draft"],
      checkpoint: { checkpoint_id: "ckpt-1", checkpoint_ns: "" },
      values: { original: "x" },
      tasks: [{ name: "draft", error: "boom" }],
    };
    expect(currentNodesFromState(state)).toEqual(["draft"]);
    expect(checkpointFromState(state)).toEqual({ id: "ckpt-1", ns: null });
    expect(taskErrorFromState(state)).toBe("boom");
  });

  it("maps run status pending→running and timeout→error", () => {
    expect(parseRun({ status: "pending" }).status).toBe("running");
    expect(parseRun({ status: "timeout", error: "timed out" })).toEqual({
      status: "error",
      error: "timed out",
    });
    expect(parseRun({ status: "success" }).status).toBe("success");
  });
});

describe("parseHistory", () => {
  /** Shape taken from a real `POST /threads/{id}/history` against langgraph dev. */
  const REAL = [
    { checkpoint: { checkpoint_id: "c4" }, next: [], created_at: "2026-09-26T14:32:56.900Z" },
    { checkpoint: { checkpoint_id: "c3" }, next: ["목록"], created_at: "2026-09-26T14:32:56.800Z" },
    { checkpoint: { checkpoint_id: "c2" }, next: ["분류"], created_at: "2026-09-26T14:32:56.700Z" },
    { checkpoint: { checkpoint_id: "c1" }, next: ["수집"], created_at: "2026-09-26T14:32:56.600Z" },
  ];

  it("reverses the API's newest-first order so the rail reads left to right", () => {
    expect(parseHistory(REAL).map((entry) => entry.id)).toEqual(["c1", "c2", "c3", "c4"]);
    expect(parseHistory(REAL)[0]).toEqual({
      id: "c1",
      next: ["수집"],
      createdAt: "2026-09-26T14:32:56.600Z",
    });
  });

  it("keeps the finished snapshot, whose next is empty", () => {
    expect(parseHistory(REAL).at(-1)).toMatchObject({ id: "c4", next: [] });
  });

  it("drops entries with no checkpoint id -- there is nothing to rewind to", () => {
    const mixed = [{ checkpoint: {}, next: ["a"] }, { next: ["b"] }, { checkpoint: { checkpoint_id: "ok" } }];
    expect(parseHistory(mixed).map((entry) => entry.id)).toEqual(["ok"]);
  });

  it("de-duplicates repeated checkpoint ids and tolerates junk", () => {
    const dupes = [{ checkpoint: { checkpoint_id: "x" } }, { checkpoint: { checkpoint_id: "x" } }];
    expect(parseHistory(dupes)).toHaveLength(1);
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory({ history: [] })).toEqual([]);
  });
});

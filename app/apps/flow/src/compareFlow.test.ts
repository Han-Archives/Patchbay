import { describe, expect, it } from "vitest";
import { compareFlowGraphs, planGraphFromProcess, runtimeGraph } from "./compareFlow.js";
import { EMPTY_PROCESS_VIEW } from "./projectContract.js";

describe("planGraphFromProcess", () => {
  it("uses step order as edges when overlay edges are empty", () => {
    const graph = planGraphFromProcess({
      ...EMPTY_PROCESS_VIEW,
      configured: true,
      steps: [
        { id: "a", label: "A", output: "table", filled: false },
        { id: "b", label: "B", output: "table", filled: false },
      ],
      edges: [],
    });
    expect(graph.edges).toEqual([{ from: "a", to: "b" }]);
  });
});

describe("runtimeGraph", () => {
  it("drops LangGraph __start__/__end__ bookends", () => {
    const graph = runtimeGraph({
      nodes: [
        { id: "__start__", label: "__start__" },
        { id: "intake", label: "intake" },
        { id: "__end__", label: "__end__" },
      ],
      edges: [
        { from: "__start__", to: "intake" },
        { from: "intake", to: "__end__" },
      ],
    });
    expect(graph.nodes.map((node) => node.id)).toEqual(["intake"]);
    expect(graph.edges).toEqual([]);
  });
});

describe("compareFlowGraphs", () => {
  it("marks matched nodes both, leftover plan blue, leftover actual as detour", () => {
    const compared = compareFlowGraphs(
      {
        nodes: [
          { id: "intake", label: "오답 접수" },
          { id: "diagnose", label: "약점 진단" },
          { id: "lecture", label: "강의 조각" },
          { id: "remediate", label: "재풀이" },
        ],
        edges: [
          { from: "intake", to: "diagnose" },
          { from: "diagnose", to: "lecture" },
          { from: "lecture", to: "remediate" },
        ],
      },
      {
        nodes: [
          { id: "intake", label: "intake" },
          { id: "diagnose", label: "diagnose" },
          { id: "plan", label: "plan" },
        ],
        edges: [
          { from: "intake", to: "diagnose" },
          { from: "diagnose", to: "plan" },
        ],
      },
      {},
    );

    const byId = Object.fromEntries(compared.nodes.map((node) => [node.id, node]));
    expect(byId.intake?.lane).toBe("both");
    expect(byId.diagnose?.lane).toBe("both");
    expect(byId["plan:lecture"]?.lane).toBe("plan");
    expect(byId["plan:remediate"]?.lane).toBe("plan");
    expect(byId.plan?.lane).toBe("actual");

    const lanes = Object.fromEntries(compared.edges.map((edge) => [`${edge.from}->${edge.to}`, edge.lane]));
    expect(lanes["intake->diagnose"]).toBe("both");
    expect(lanes["plan:lecture->plan:remediate"]).toBe("plan");
    expect(lanes["diagnose->plan"]).toBe("actual");
  });

  it("honors bind when plan ids differ from LangGraph ids", () => {
    const compared = compareFlowGraphs(
      {
        nodes: [
          { id: "step-1", label: "진단" },
          { id: "step-2", label: "보완" },
        ],
        edges: [{ from: "step-1", to: "step-2" }],
      },
      {
        nodes: [
          { id: "diagnose", label: "diagnose" },
          { id: "plan", label: "plan" },
        ],
        edges: [{ from: "diagnose", to: "plan" }],
      },
      { "step-1": "diagnose", "step-2": "plan" },
    );
    expect(compared.nodes.every((node) => node.lane === "both")).toBe(true);
    expect(compared.edges).toEqual([
      expect.objectContaining({ from: "diagnose", to: "plan", lane: "both" }),
    ]);
  });
});

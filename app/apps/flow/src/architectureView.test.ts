import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { parseIr, readIrFile } from "@patchbay/core";
import { matchAssistant, nodeDetail, nodeRunStates, threadForGraph, verticalPosition } from "./architectureView.js";
import { toIrCanvas } from "./irCanvas.js";
import type { Ir } from "./irContract.js";

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/core/src/ir/__fixtures__/valid.ir.yaml",
);

let ir: Ir;

beforeAll(async () => {
  const read = await readIrFile(FIXTURE);
  if (!read.ok) throw new Error(read.error);
  const parsed = parseIr(read.raw);
  if (!parsed.ok) throw new Error(parsed.error);
  ir = parsed.ir;
});

describe("matchAssistant", () => {
  const assistants = [
    { id: "a1", name: "other", graphId: "other" },
    { id: "a2", name: "Triage bot", graphId: "triage" },
  ];

  it("finds the sidecar graph named by the design's graph cell", () => {
    expect(matchAssistant(assistants, "triage")?.id).toBe("a2");
    expect(matchAssistant(assistants, "Triage bot")?.id).toBe("a2");
  });

  it("returns null rather than guessing when nothing matches", () => {
    expect(matchAssistant(assistants, "missing")).toBeNull();
    expect(matchAssistant(assistants, "  ")).toBeNull();
  });
});

describe("threadForGraph", () => {
  it("skips newer threads of another graph", () => {
    const threads = [
      { id: "t3", updatedAt: null, graphId: "other" },
      { id: "t2", updatedAt: null },
      { id: "t1", updatedAt: null, graphId: "triage" },
    ];
    expect(threadForGraph(threads, "triage")?.id).toBe("t1");
    expect(threadForGraph(threads, "none")).toBeNull();
    expect(threadForGraph(threads, null)).toBeNull();
  });
});

describe("nodeRunStates", () => {
  it("marks the waiting node now and every queued node reached", () => {
    const states = nodeRunStates({
      currentNodes: ["explain"],
      history: [
        { id: "c1", next: ["intake"], createdAt: null },
        { id: "c2", next: ["classify"], createdAt: null },
        { id: "c3", next: ["explain"], createdAt: null },
      ],
    });
    expect(states.get("intake")).toBe("reached");
    expect(states.get("explain")).toBe("now");
    expect(states.has("pick")).toBe(false);
  });

  it("is empty without a LangGraph connection", () => {
    expect(nodeRunStates(null).size).toBe(0);
  });
});

describe("nodeDetail", () => {
  it("gathers what one node touches from across the design", () => {
    const pick = nodeDetail(ir, "pick");
    expect(pick?.label).toBe("안내 문서 고르기");
    expect(pick?.tools).toEqual([
      { id: "write-draft", what: "out/triage.md 에 결과를 적는다", via: null, server: null, caps: ["cap:draft"] },
    ]);
    expect(pick?.documents.map((doc) => doc.path)).toContain("guides/bug.md");
    expect(pick?.incoming.sort()).toEqual(["classify", "explain"]);
    expect(pick?.outgoing).toEqual([{ to: "__end__", when: null }]);
  });

  it("names the provider of each model a node calls", () => {
    expect(nodeDetail(ir, "explain")?.models).toEqual([{ id: "claude-opus-5", provider: "anthropic" }]);
  });

  it("has no detail for the terminals or unknown ids", () => {
    expect(nodeDetail(ir, "__start__")).toBeNull();
    expect(nodeDetail(ir, "nope")).toBeNull();
  });
});

describe("verticalPosition", () => {
  it("puts each layer one row lower and keeps siblings side by side", () => {
    const at = new Map(toIrCanvas(ir).nodes.map((node) => [node.id, verticalPosition(node.position)]));
    expect(at.get("__start__")).toEqual({ x: 0, y: 0 });
    expect(at.get("intake")!.y).toBeGreaterThan(at.get("__start__")!.y);
    expect(at.get("pick")!.y).toBeGreaterThan(at.get("explain")!.y);
    expect(at.get("__end__")!.y).toBeGreaterThan(at.get("pick")!.y);
  });
});

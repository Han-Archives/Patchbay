import { describe, expect, it } from "vitest";
import { kindOf, layout } from "./layout.js";

describe("kindOf", () => {
  it("extracts the kind prefix before the colon", () => {
    expect(kindOf("skill:map-project")).toBe("skill");
    expect(kindOf("artifact:packages/core/src/render/layers.ts")).toBe("artifact");
  });

  it("returns an empty string for a PortId with no colon", () => {
    expect(kindOf("not-a-portid")).toBe("");
  });
});

describe("layout", () => {
  it("places every node with no incoming edge in column 0 (x = 0)", () => {
    const nodes = [{ id: "a", portId: "skill:a" }, { id: "b", portId: "skill:b" }];
    const positions = layout(nodes, []);
    expect(positions.get("a")?.x).toBe(0);
    expect(positions.get("b")?.x).toBe(0);
  });

  it("places a node one column past its source", () => {
    const nodes = [{ id: "a", portId: "skill:a" }, { id: "b", portId: "skill:b" }];
    const edges = [{ from: "a", to: "b", kind: "uses" }];
    const positions = layout(nodes, edges);
    expect(positions.get("a")?.x).toBe(0);
    expect(positions.get("b")?.x).toBeGreaterThan(positions.get("a")?.x ?? 0);
  });

  it("places a node at the column past its furthest-upstream predecessor, not the nearest", () => {
    // a -> b -> c, and a -> c directly. c must land past b, not right after a.
    const nodes = [
      { id: "a", portId: "skill:a" },
      { id: "b", portId: "skill:b" },
      { id: "c", portId: "skill:c" },
    ];
    const edges = [
      { from: "a", to: "b", kind: "uses" },
      { from: "b", to: "c", kind: "uses" },
      { from: "a", to: "c", kind: "uses" },
    ];
    const positions = layout(nodes, edges);
    expect(positions.get("c")?.x).toBeGreaterThan(positions.get("b")?.x ?? 0);
  });

  it("gives every node in the same column a distinct row (never overlapping)", () => {
    const nodes = [
      { id: "a", portId: "skill:a" },
      { id: "b", portId: "skill:b" },
      { id: "c", portId: "skill:c" },
    ];
    const positions = layout(nodes, []);
    const ys = [positions.get("a")?.y, positions.get("b")?.y, positions.get("c")?.y];
    expect(new Set(ys).size).toBe(3);
  });

  it("never drops a node that's part of a cycle -- it still gets a position", () => {
    const nodes = [{ id: "a", portId: "skill:a" }, { id: "b", portId: "skill:b" }];
    const edges = [
      { from: "a", to: "b", kind: "uses" },
      { from: "b", to: "a", kind: "uses" },
    ];
    const positions = layout(nodes, edges);
    expect(positions.has("a")).toBe(true);
    expect(positions.has("b")).toBe(true);
  });

  it("positions every node exactly once, matching the node list", () => {
    const nodes = [{ id: "a", portId: "skill:a" }, { id: "b", portId: "skill:b" }, { id: "c", portId: "skill:c" }];
    const positions = layout(nodes, []);
    expect(positions.size).toBe(3);
  });
});

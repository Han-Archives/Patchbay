import { describe, expect, it } from "vitest";
import { toFlowCanvas } from "./flowCanvas.js";

describe("toFlowCanvas", () => {
  it("reuses layout() so sources sit in column 0 and current nodes are flagged", () => {
    const { nodes, edges } = toFlowCanvas(
      {
        nodes: [
          { id: "a", label: "a" },
          { id: "b", label: "b" },
        ],
        edges: [{ from: "a", to: "b" }],
      },
      ["b"],
    );
    expect(nodes[0]?.position.x).toBe(0);
    expect(nodes[1]?.position.x).toBeGreaterThan(nodes[0]?.position.x ?? 0);
    expect(nodes[1]?.data.current).toBe(true);
    expect(nodes[1]?.className).toBe("flow-node-actual flow-node-current");
    expect(edges).toEqual([{ id: "a->b:0", source: "a", target: "b", className: "flow-edge-actual" }]);
  });
});

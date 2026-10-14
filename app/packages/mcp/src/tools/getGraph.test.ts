import { computeFlowGraph, type FlowGraph } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { setupScannedProject, setupUnscannedProject } from "../testFixtures.js";
import { callTool, connectInProcess, resultJson, resultText } from "../testSupport.js";

describe("get_graph (in-process MCP)", () => {
  it("defaults to level 1: summary counts, computed on the spot (no digest file)", async () => {
    const fixture = await setupScannedProject();
    const expectedGraph = computeFlowGraph(fixture.inferred, fixture.overlay);

    const { client, close } = await connectInProcess(fixture.studioHome);
    try {
      const result = await callTool(client, "get_graph", { alias: fixture.alias });
      expect(result.isError).toBeFalsy();

      const payload = resultJson(result) as {
        alias: string;
        level: number;
        nodeCount: number;
        edgeCount: number;
        patchesWithoutWireCount: number;
        wiresWithoutPatchCount: number;
      };
      expect(payload.level).toBe(1);
      expect(payload.nodeCount).toBe(expectedGraph.nodes.length);
      expect(payload.edgeCount).toBe(expectedGraph.edges.length);
      expect(payload.patchesWithoutWireCount).toBe(0);
      expect(payload.wiresWithoutPatchCount).toBe(0);
    } finally {
      await close();
    }
  });

  it("level 2 returns the full FlowGraph node/edge JSON, matching computeFlowGraph exactly", async () => {
    const fixture = await setupScannedProject();
    const expectedGraph = computeFlowGraph(fixture.inferred, fixture.overlay);

    const { client, close } = await connectInProcess(fixture.studioHome);
    try {
      const result = await callTool(client, "get_graph", { alias: fixture.alias, level: 2 });
      const payload = resultJson(result) as { graph: FlowGraph };
      expect(payload.graph).toEqual(expectedGraph);
    } finally {
      await close();
    }
  });

  it("level 3 returns the same raw inferred.json source as get_atlas level 3", async () => {
    const fixture = await setupScannedProject();
    const { client, close } = await connectInProcess(fixture.studioHome);
    try {
      const result = await callTool(client, "get_graph", { alias: fixture.alias, level: 3 });
      const payload = resultJson(result) as { content: string };
      expect(JSON.parse(payload.content)).toEqual(fixture.inferred);
    } finally {
      await close();
    }
  });

  it("errors clearly when the project hasn't been scanned yet", async () => {
    const { studioHome } = await setupUnscannedProject("demo");
    const { client, close } = await connectInProcess(studioHome);
    try {
      const result = await callTool(client, "get_graph", { alias: "demo" });
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain("has not been scanned yet");
    } finally {
      await close();
    }
  });
});

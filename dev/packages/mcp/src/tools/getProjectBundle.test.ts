import { describe, expect, it } from "vitest";
import { setupScannedProject, setupUnscannedProject } from "../testFixtures.js";
import { callTool, connectInProcess, resultJson, resultText } from "../testSupport.js";

interface BundlePayload {
  alias: string;
  level: number;
  scope: string;
  atlas: string;
  graph: unknown;
  excerpts?: Array<{ port: string; path: string; content: string; truncated: boolean }>;
}

describe("get_project_bundle (in-process MCP)", () => {
  it("defaults to level 1 + scope full, including a signal-file excerpt", async () => {
    const fixture = await setupScannedProject({ readmeContent: "short readme\n" });
    const { client, close } = await connectInProcess(fixture.studioHome);
    try {
      const result = await callTool(client, "get_project_bundle", { alias: fixture.alias });
      expect(result.isError).toBeFalsy();

      const payload = resultJson(result) as BundlePayload;
      expect(payload.level).toBe(1);
      expect(payload.scope).toBe("full");
      expect(typeof payload.atlas).toBe("string");
      expect(payload.graph).toBeDefined();
      expect(payload.excerpts).toBeDefined();

      const readmeExcerpt = payload.excerpts?.find((excerpt) => excerpt.port === "source:README.md");
      expect(readmeExcerpt).toBeDefined();
      expect(readmeExcerpt?.path).toBe("README.md");
      expect(readmeExcerpt?.content).toBe("short readme\n");
      expect(readmeExcerpt?.truncated).toBe(false);
    } finally {
      await close();
    }
  });

  it("truncates a signal file excerpt to exactly 2000 chars and marks it truncated", async () => {
    const longReadme = "x".repeat(3000);
    const fixture = await setupScannedProject({ readmeContent: longReadme });
    const { client, close } = await connectInProcess(fixture.studioHome);
    try {
      const result = await callTool(client, "get_project_bundle", { alias: fixture.alias });
      const payload = resultJson(result) as BundlePayload;
      const readmeExcerpt = payload.excerpts?.find((excerpt) => excerpt.port === "source:README.md");
      expect(readmeExcerpt?.content.length).toBe(2000);
      expect(readmeExcerpt?.content).toBe(longReadme.slice(0, 2000));
      expect(readmeExcerpt?.truncated).toBe(true);
    } finally {
      await close();
    }
  });

  it("scope: summary omits excerpts entirely (no file reads beyond atlas/graph)", async () => {
    const fixture = await setupScannedProject();
    const { client, close } = await connectInProcess(fixture.studioHome);
    try {
      const result = await callTool(client, "get_project_bundle", { alias: fixture.alias, scope: "summary" });
      const payload = resultJson(result) as BundlePayload;
      expect(payload.scope).toBe("summary");
      expect(payload.excerpts).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("level 2 embeds the full graph result and level-2 atlas content, same as get_atlas/get_graph", async () => {
    const fixture = await setupScannedProject();
    const { client, close } = await connectInProcess(fixture.studioHome);
    try {
      const result = await callTool(client, "get_project_bundle", {
        alias: fixture.alias,
        level: 2,
        scope: "summary",
      });
      const payload = resultJson(result) as BundlePayload & { graph: { graph: { nodes: unknown[] } } };
      expect(payload.level).toBe(2);
      expect(payload.graph.graph.nodes).toBeInstanceOf(Array);
    } finally {
      await close();
    }
  });

  it("errors clearly when the project hasn't been scanned yet", async () => {
    const { studioHome } = await setupUnscannedProject("demo");
    const { client, close } = await connectInProcess(studioHome);
    try {
      const result = await callTool(client, "get_project_bundle", { alias: "demo" });
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain("has not been scanned yet");
    } finally {
      await close();
    }
  });
});

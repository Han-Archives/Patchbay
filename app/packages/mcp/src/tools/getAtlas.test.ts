import { readAtlas, readAtlasDigest } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { setupScannedProject, setupUnscannedProject } from "../testFixtures.js";
import { callTool, connectInProcess, resultJson, resultText } from "../testSupport.js";

describe("get_atlas (in-process MCP)", () => {
  it("defaults to level 1 (digest), distinct from the CLI's level-2 default -- spec Phase 4 checklist", async () => {
    const fixture = await setupScannedProject();
    const { client, close } = await connectInProcess(fixture.studioHome);
    try {
      const result = await callTool(client, "get_atlas", { alias: fixture.alias });
      expect(result.isError).toBeFalsy();

      const payload = resultJson(result) as { alias: string; level: number; content: string };
      expect(payload.level).toBe(1);
      expect(payload.content).toBe(await readAtlasDigest(fixture.studioHome, fixture.alias));
    } finally {
      await close();
    }
  });

  it("level 2 returns the full ATLAS.md content", async () => {
    const fixture = await setupScannedProject();
    const { client, close } = await connectInProcess(fixture.studioHome);
    try {
      const result = await callTool(client, "get_atlas", { alias: fixture.alias, level: 2 });
      const payload = resultJson(result) as { content: string };
      expect(payload.content).toBe(await readAtlas(fixture.studioHome, fixture.alias));
    } finally {
      await close();
    }
  });

  it("level 3 returns raw inferred.json, parseable and matching the scan output", async () => {
    const fixture = await setupScannedProject();
    const { client, close } = await connectInProcess(fixture.studioHome);
    try {
      const result = await callTool(client, "get_atlas", { alias: fixture.alias, level: 3 });
      const payload = resultJson(result) as { content: string };
      expect(JSON.parse(payload.content)).toEqual(fixture.inferred);
    } finally {
      await close();
    }
  });

  it("resolves alias omission to the sole registered project", async () => {
    const fixture = await setupScannedProject();
    const { client, close } = await connectInProcess(fixture.studioHome);
    try {
      const result = await callTool(client, "get_atlas");
      const payload = resultJson(result) as { alias: string };
      expect(payload.alias).toBe(fixture.alias);
    } finally {
      await close();
    }
  });

  it("errors clearly when the project hasn't been scanned yet", async () => {
    const { studioHome } = await setupUnscannedProject("demo");
    const { client, close } = await connectInProcess(studioHome);
    try {
      const result = await callTool(client, "get_atlas", { alias: "demo" });
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain("has not been scanned yet");
    } finally {
      await close();
    }
  });

  it("errors clearly when the alias isn't registered at all", async () => {
    const fixture = await setupScannedProject();
    const { client, close } = await connectInProcess(fixture.studioHome);
    try {
      const result = await callTool(client, "get_atlas", { alias: "nope" });
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain("nope");
    } finally {
      await close();
    }
  });
});

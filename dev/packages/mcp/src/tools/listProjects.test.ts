import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerProject } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { callTool, connectInProcess, resultJson } from "../testSupport.js";

describe("list_projects (in-process MCP)", () => {
  it("returns every registered project, straight from the studio registry", async () => {
    const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-mcp-home-"));
    await registerProject(studioHome, { alias: "a", kind: "local_repo", path: "/tmp/a" });
    await registerProject(studioHome, { alias: "b", kind: "local_repo", path: "/tmp/b" });

    const { client, close } = await connectInProcess(studioHome);
    try {
      const result = await callTool(client, "list_projects");
      expect(result.isError).toBeFalsy();

      const payload = resultJson(result) as { projects: Array<{ alias: string; kind: string; path: string }> };
      expect(payload.projects).toEqual([
        { alias: "a", kind: "local_repo", path: "/tmp/a" },
        { alias: "b", kind: "local_repo", path: "/tmp/b" },
      ]);
    } finally {
      await close();
    }
  });

  it("returns an empty list for a fresh studio with nothing registered", async () => {
    const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-mcp-home-"));

    const { client, close } = await connectInProcess(studioHome);
    try {
      const result = await callTool(client, "list_projects");
      const payload = resultJson(result) as { projects: unknown[] };
      expect(payload.projects).toEqual([]);
    } finally {
      await close();
    }
  });
});

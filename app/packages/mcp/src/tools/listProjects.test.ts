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

describe("tool inventory", () => {
  it("exposes the read tools, the P4 writes, the conversation tools (2026-10-05) and the consultation tools (2026-10-06, 지난 상담 찾기 2026-10-08)", async () => {
    const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-mcp-home-"));
    const { client, close } = await connectInProcess(studioHome);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
        "answer_request",
        "consult_history",
        "consult_update",
        "find_documents",
        "get_atlas",
        "get_graph",
        "get_impact",
        "get_prd",
        "get_progress",
        "get_project_bundle",
        "get_room",
        "get_runs",
        "get_thread",
        "list_pending_requests",
        "list_projects",
        "llm_status",
        "log_build",
        "log_read",
        "place_on_board",
        "progress_write",
        "room_bind",
      ]);
    } finally {
      await close();
    }
  });

  // Codex exec(approval never)는 읽기 전용이거나 비파괴 · 외부 접속 없음 표시가 없는 도구를 거절한다 (2026-10-19).
  it("marks the consultation tools so Codex calls them without approval", async () => {
    const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-mcp-home-"));
    const { client, close } = await connectInProcess(studioHome);
    try {
      const byName = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool.annotations]));
      for (const name of ["get_prd", "consult_history", "get_atlas", "get_project_bundle", "find_documents"]) {
        expect(byName.get(name)?.readOnlyHint, name).toBe(true);
      }
      expect(byName.get("consult_update")).toMatchObject({ destructiveHint: false, openWorldHint: false });
    } finally {
      await close();
    }
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readProgress, readProgressMd, registerProject } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { callTool, connectInProcess, resultJson, resultText } from "../testSupport.js";

function tmpStudioHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-mcp-progress-write-"));
}

describe("progress_write (in-process MCP)", () => {
  it("records via the same Core path as CLI progress write", async () => {
    const studioHome = tmpStudioHome();
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });

    const { client, close } = await connectInProcess(studioHome);
    try {
      const result = await callTool(client, "progress_write", {
        alias: "demo",
        summary: "mcp write path",
        skill: "map-project",
        step: "start",
      });
      expect(result.isError).toBeFalsy();
      const payload = resultJson(result) as {
        ok: true;
        alias: string;
        summary: string;
        current: { summary: string; skill?: string; step?: string };
      };
      expect(payload.ok).toBe(true);
      expect(payload.alias).toBe("demo");
      expect(payload.summary).toBe("mcp write path");
      expect(payload.current.skill).toBe("map-project");
      expect(payload.current.step).toBe("start");

      const progress = await readProgress(studioHome, "demo");
      expect(progress.current?.summary).toBe("mcp write path");
      expect(fs.existsSync(path.join(studioHome, "projects", "demo", "PROGRESS.md"))).toBe(true);
      expect(fs.existsSync(path.join(studioHome, "progress.md"))).toBe(true);
    } finally {
      await close();
    }
  });

  it("errors for an unregistered alias", async () => {
    const studioHome = tmpStudioHome();
    const { client, close } = await connectInProcess(studioHome);
    try {
      const result = await callTool(client, "progress_write", { alias: "nope", summary: "x" });
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain("No project registered");
    } finally {
      await close();
    }
  });
});

describe("progress_write: asked/did", () => {
  it("records the request and what shipped, and renders both into PROGRESS.md", async () => {
    const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-mcp-asked-"));
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });

    const { client, close } = await connectInProcess(studioHome);
    try {
      const result = await callTool(client, "progress_write", {
        alias: "demo",
        summary: "민감도 게이트",
        asked: "5단계 접근 권한을 줘서 단계별로 데이터를 관리했으면 좋겠어",
        did: "classifyPath + /api/source L4 차단",
      });
      expect(result.isError).toBeFalsy();
      const payload = resultJson(result) as { current: { asked?: string; did?: string } };
      expect(payload.current.asked).toContain("5단계");
      expect(payload.current.did).toContain("classifyPath");

      const md = await readProgressMd(studioHome, "demo");
      expect(md).toContain("asked: 5단계");
      expect(md).toContain("did: classifyPath");
    } finally {
      await close();
    }
  });

  it("stays optional -- a skill mid-run records a summary with no request behind it", async () => {
    const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-mcp-asked-"));
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });

    const { client, close } = await connectInProcess(studioHome);
    try {
      const result = await callTool(client, "progress_write", { alias: "demo", summary: "스캔 완료" });
      expect(result.isError).toBeFalsy();
      const md = await readProgressMd(studioHome, "demo");
      expect(md).toContain("summary: 스캔 완료");
      expect(md).not.toContain("asked:");
      expect(md).not.toContain("did:");
    } finally {
      await close();
    }
  });
});

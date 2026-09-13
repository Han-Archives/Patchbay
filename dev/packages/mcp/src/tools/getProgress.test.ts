import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readAllProjectsProgress,
  readProgressMd,
  readProgressRaw,
  registerProject,
  renderProgressMd,
  renderStudioProgressRollup,
  writeProgressEntry,
  writeProgressMd,
  writeStudioProgressRollup,
} from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { callTool, connectInProcess, resultJson, resultText } from "../testSupport.js";

function tmpStudioHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-mcp-progress-home-"));
}

/** Registers a project and records progress for it via the exact same Core calls `patchbay progress write` uses, so the on-disk state matches what the real CLI would produce. */
async function setupProjectWithProgress(
  studioHome: string,
  alias: string,
  entry: { summary: string; skill?: string; step?: string },
): Promise<void> {
  await registerProject(studioHome, { alias, kind: "local_repo", path: `/tmp/${alias}` });
  const progress = await writeProgressEntry(studioHome, alias, entry);
  await writeProgressMd(studioHome, alias, renderProgressMd(progress));
  const all = await readAllProjectsProgress(studioHome);
  await writeStudioProgressRollup(studioHome, renderStudioProgressRollup(all));
}

describe("get_progress (in-process MCP)", () => {
  it("alias omitted returns the studio-wide rollup, not a sole-registered-project default", async () => {
    const studioHome = tmpStudioHome();
    await setupProjectWithProgress(studioHome, "demo", { summary: "solo project work" });

    const { client, close } = await connectInProcess(studioHome);
    try {
      const result = await callTool(client, "get_progress", {});
      expect(result.isError).toBeFalsy();
      const payload = resultJson(result) as { alias: null; level: null; content: string };
      expect(payload.alias).toBeNull();
      expect(payload.level).toBeNull();
      expect(payload.content).toContain("demo");
      expect(payload.content).toContain("solo project work");
      // Proves this took the studio-wide rollup path, not the per-project
      // level-1 one-liner a sole-project default would have produced.
      expect(payload.content).toContain("Studio Progress");
    } finally {
      await close();
    }
  });

  it("alias omitted errors clearly when no progress has ever been recorded for any project", async () => {
    const studioHome = tmpStudioHome();
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });

    const { client, close } = await connectInProcess(studioHome);
    try {
      const result = await callTool(client, "get_progress", {});
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain("No progress has been recorded yet");
    } finally {
      await close();
    }
  });

  it("errors clearly when the given alias isn't registered -- distinct from alias omitted, which never errors for that reason", async () => {
    const studioHome = tmpStudioHome();
    await setupProjectWithProgress(studioHome, "demo", { summary: "work" });

    const { client, close } = await connectInProcess(studioHome);
    try {
      const omitted = await callTool(client, "get_progress", {});
      expect(omitted.isError).toBeFalsy();

      const unregistered = await callTool(client, "get_progress", { alias: "nope" });
      expect(unregistered.isError).toBe(true);
      expect(resultText(unregistered)).toContain("nope");
    } finally {
      await close();
    }
  });

  it("level defaults to 1 (one-line current summary) when alias is given", async () => {
    const studioHome = tmpStudioHome();
    await setupProjectWithProgress(studioHome, "demo", {
      summary: "level 1 default check",
      skill: "skill:map-project",
      step: "scan",
    });

    const { client, close } = await connectInProcess(studioHome);
    try {
      const result = await callTool(client, "get_progress", { alias: "demo" });
      expect(result.isError).toBeFalsy();
      const payload = resultJson(result) as { alias: string; level: number; content: string };
      expect(payload.alias).toBe("demo");
      expect(payload.level).toBe(1);
      expect(payload.content).toContain("level 1 default check");
      expect(payload.content).not.toContain("# Progress");
    } finally {
      await close();
    }
  });

  it("level 1 works for a registered project that's never had progress written (idle marker, not an error)", async () => {
    const studioHome = tmpStudioHome();
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });

    const { client, close } = await connectInProcess(studioHome);
    try {
      const result = await callTool(client, "get_progress", { alias: "demo" });
      expect(result.isError).toBeFalsy();
      const payload = resultJson(result) as { content: string };
      expect(payload.content).toContain("진행 중인 작업 없음");
    } finally {
      await close();
    }
  });

  it("level 2 returns the full PROGRESS.md content", async () => {
    const studioHome = tmpStudioHome();
    await setupProjectWithProgress(studioHome, "demo", { summary: "level 2 check" });

    const { client, close } = await connectInProcess(studioHome);
    try {
      const result = await callTool(client, "get_progress", { alias: "demo", level: 2 });
      const payload = resultJson(result) as { content: string };
      expect(payload.content).toBe(await readProgressMd(studioHome, "demo"));
      expect(payload.content).toContain("level 2 check");
    } finally {
      await close();
    }
  });

  it("level 2 errors clearly when PROGRESS.md hasn't been generated yet", async () => {
    const studioHome = tmpStudioHome();
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });

    const { client, close } = await connectInProcess(studioHome);
    try {
      const result = await callTool(client, "get_progress", { alias: "demo", level: 2 });
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain("No progress has been recorded yet");
    } finally {
      await close();
    }
  });

  it("level 3 returns raw progress.yaml content, matching readProgressRaw", async () => {
    const studioHome = tmpStudioHome();
    await setupProjectWithProgress(studioHome, "demo", { summary: "level 3 check" });

    const { client, close } = await connectInProcess(studioHome);
    try {
      const result = await callTool(client, "get_progress", { alias: "demo", level: 3 });
      const payload = resultJson(result) as { content: string };
      expect(payload.content).toBe(await readProgressRaw(studioHome, "demo"));
      expect(payload.content).toContain("level 3 check");
    } finally {
      await close();
    }
  });
});

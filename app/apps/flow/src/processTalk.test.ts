import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureStudioInitialized, registerProject, writeOverlayIfAbsent } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import type { LangGraphPort } from "./langgraphAdapter.js";
import { loadProcessStep, talkProcessStep } from "./processTalk.js";
import { addProcessStep } from "./processView.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fakePort(overrides: Partial<LangGraphPort> = {}): LangGraphPort {
  return {
    url: "http://langgraph.test",
    probe: async () => true,
    listAssistants: async () => [{ id: "agent", name: "agent", graphId: "agent" }],
    getGraph: async () => null,
    listThreads: async () => [],
    getState: async () => ({
      values: {
        original: "오답",
        summary: ["영역: reading", "약점: 문장삽입", "다음 강의: lectures/reading.md"].join("\n"),
      },
    }),
    listRuns: async () => [],
    listHistory: async () => [],
    createThread: async () => "thread-1",
    waitRun: async () => ({ status: "ok", body: {} }),
    ...overrides,
  };
}

describe("talkProcessStep", () => {
  it("returns 503 when LangGraph is missing", async () => {
    const studioHome = tmpDir("patchbay-talk-studio-");
    const projectPath = tmpDir("patchbay-talk-repo-");
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectPath });
    await writeOverlayIfAbsent(studioHome, "demo");
    const added = await addProcessStep(studioHome, { alias: "demo", label: "약점 진단" });
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const result = await talkProcessStep(studioHome, undefined, {
      alias: "demo",
      stepId: added.step.id,
      message: "이 오답을 진단해 줘",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(503);
  });

  it("writes a table artifact from key-value summary", async () => {
    const studioHome = tmpDir("patchbay-talk-studio-");
    const projectPath = tmpDir("patchbay-talk-repo-");
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectPath });
    await writeOverlayIfAbsent(studioHome, "demo");
    const added = await addProcessStep(studioHome, { alias: "demo", label: "약점 진단", output: "table" });
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const result = await talkProcessStep(studioHome, fakePort(), {
      alias: "demo",
      stepId: added.step.id,
      message: "문장삽입 오답",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.type).toBe("table");
    expect(result.artifact.rows[0]).toEqual(["영역", "reading"]);
    expect(result.artifact.messages).toHaveLength(2);
    expect(fs.existsSync(path.join(projectPath, "docs", "절차", `${added.step.id}.artifact.json`))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, "docs", "절차", `${added.step.id}.md`))).toBe(true);

    const loaded = await loadProcessStep(studioHome, "demo", added.step.id);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.step.filled).toBe(true);
    expect(loaded.artifact.threadId).toBe("thread-1");
  });

  it("writes a diagram when the step output is diagram and the model returns arrows", async () => {
    const studioHome = tmpDir("patchbay-talk-studio-");
    const projectPath = tmpDir("patchbay-talk-repo-");
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectPath });
    await writeOverlayIfAbsent(studioHome, "demo");
    const added = await addProcessStep(studioHome, { alias: "demo", label: "워크플로", output: "diagram" });
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const result = await talkProcessStep(
      studioHome,
      fakePort({
        getState: async () => ({
          values: { original: "흐름", summary: "접수 → 진단\n진단 → 강의" },
        }),
      }),
      { alias: "demo", stepId: added.step.id, message: "과정을 그려 줘" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.type).toBe("diagram");
    expect(result.artifact.nodes.length).toBeGreaterThanOrEqual(3);
  });

  it("turns a constitution talk into overlay steps", async () => {
    const studioHome = tmpDir("patchbay-talk-studio-");
    const projectPath = tmpDir("patchbay-talk-repo-");
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectPath });
    await writeOverlayIfAbsent(studioHome, "demo");

    const result = await talkProcessStep(
      studioHome,
      fakePort({
        getState: async () => ({
          values: {
            original: "방향",
            summary: ["목표: 빠른 출시", "채택: 약점 루프", "1. 오답 접수", "2. 약점 진단"].join("\n"),
          },
        }),
      }),
      {
        alias: "demo",
        stepId: "plan-proceed",
        message: "약점 루프로 가자. 순서는 오답 접수 다음 진단.",
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.process.goal).toBe("빠른 출시");
    expect(result.process.steps.map((step) => step.label)).toEqual(["오답 접수", "약점 진단"]);
    expect(result.process.planBeats.find((beat) => beat.id === "plan-proceed")?.filled).toBe(true);
    const loaded = await loadProcessStep(studioHome, "demo", "plan-proceed");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.step.label).toBe("실행 단계");
  });
});

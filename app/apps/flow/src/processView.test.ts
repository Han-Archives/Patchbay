import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureStudioInitialized, readOverlay, registerProject, writeOverlayIfAbsent } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { saveProjectProcess, addProcessStep } from "./processView.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("saveProjectProcess", () => {
  it("rejects a process with fewer than two steps", async () => {
    const studioHome = tmpDir("patchbay-process-studio-");
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: tmpDir("patchbay-process-repo-") });
    const result = await saveProjectProcess(studioHome, {
      alias: "demo",
      goal: "출시",
      folders: ["docs/기획"],
      steps: [{ label: "하나만" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("두 단계");
  });

  it("writes overlay.process, creates folders, and records progress", async () => {
    const studioHome = tmpDir("patchbay-process-studio-");
    const projectPath = tmpDir("patchbay-process-repo-");
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectPath });
    await writeOverlayIfAbsent(studioHome, "demo");

    const result = await saveProjectProcess(studioHome, {
      alias: "demo",
      goal: "빠른 출시",
      folders: ["docs/기획", "lectures"],
      steps: [{ label: "오답 접수", bind: "intake" }, { label: "진단", bind: "diagnose" }, { label: "강의 조각" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.process.configured).toBe(true);
    expect(result.process.steps.map((step) => step.id)).toEqual(["intake", "diagnose", "step-3"]);
    expect(fs.existsSync(path.join(projectPath, "docs", "기획"))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, "lectures"))).toBe(true);
    const overlay = await readOverlay(studioHome, "demo");
    expect(overlay.process.goal).toBe("빠른 출시");
    expect(overlay.process.edges).toEqual([
      { from: "intake", to: "diagnose" },
      { from: "diagnose", to: "step-3" },
    ]);
    expect(result.process.steps[0]?.output).toBe("table");
  });
});

describe("addProcessStep", () => {
  it("lets the first step stand alone and creates docs/절차", async () => {
    const studioHome = tmpDir("patchbay-process-studio-");
    const projectPath = tmpDir("patchbay-process-repo-");
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectPath });
    await writeOverlayIfAbsent(studioHome, "demo");

    const first = await addProcessStep(studioHome, { alias: "demo", label: "목표설계", output: "table" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.process.configured).toBe(true);
    expect(first.step.label).toBe("목표설계");
    expect(first.process.steps).toHaveLength(1);
    expect(fs.existsSync(path.join(projectPath, "docs", "절차"))).toBe(true);

    const second = await addProcessStep(studioHome, { alias: "demo", label: "방향 비교", output: "diagram" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.process.steps.map((step) => step.label)).toEqual(["목표설계", "방향 비교"]);
    expect(second.process.edges).toEqual([{ from: first.step.id, to: second.step.id }]);
    expect(second.step.output).toBe("diagram");
  });
});

describe("applyConstitutionToProcess", () => {
  it("writes goal and ordered steps from a constitution artifact", async () => {
    const { applyConstitutionToProcess } = await import("./processView.js");
    const { artifactFromTalk } = await import("./processArtifact.js");
    const artifact = artifactFromTalk({
      output: "table",
      title: "기획",
      original: "1. 접수\n2. 진단",
      summary: "목표: 출시\n채택: 루프",
      constitution: true,
    });
    const next = applyConstitutionToProcess(
      {
        configured: false,
        goal: "",
        folders: [],
        steps: [],
        edges: [],
        bind: {},
      },
      artifact,
    );
    expect(next.goal).toBe("출시");
    expect(next.steps.map((step) => step.label)).toEqual(["접수", "진단"]);
    expect(next.configured).toBe(true);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureStudioInitialized, registerProject, writeOverlayIfAbsent } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { launchPlanHost } from "./processHost.js";
import { buildPlanBrief, planPaths, preparePlanHostSession, readPlanMemory } from "./processMemory.js";
import { loadProcessStep } from "./processTalk.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("plan host memory", () => {
  it("writes under the project's own docs folder when the registry names one", async () => {
    const root = tmpDir("patchbay-plan-docs-");
    const docs = "knowledge/patchbay";
    const prepared = await preparePlanHostSession(root, "plan-goal", "claude", "문서 폴더", docs);
    expect(prepared.briefRel).toBe("knowledge/patchbay/기획/브리핑.md");
    expect(fs.existsSync(path.join(root, "knowledge/patchbay/기획/기억.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "docs"))).toBe(false);
    const brief = fs.readFileSync(path.join(root, prepared.briefRel), "utf8");
    expect(brief).toContain("knowledge/patchbay/기획/목표.md");
    expect(brief).not.toContain("docs/기획");
  });

  it("writes 기억/대화/브리핑 so the next beat can continue", async () => {
    const root = tmpDir("patchbay-plan-mem-");
    const first = await preparePlanHostSession(root, "plan-goal", "cursor", "빨리 출시");
    expect(first.files.host?.status).toBe("running");
    const paths = planPaths();
    expect(fs.existsSync(path.join(root, paths.memory))).toBe(true);
    expect(fs.existsSync(path.join(root, paths.thread))).toBe(true);
    expect(fs.readFileSync(path.join(root, paths.brief), "utf8")).toContain("빨리 출시");

    fs.writeFileSync(path.join(root, "docs/기획/목표.md"), "# 목표\n\n목표: 빠른 출시\n", "utf8");
    const files = await readPlanMemory(root);
    const brief = buildPlanBrief({ beatId: "plan-direction", files, note: "약점 루프로", resume: true });
    expect(brief).toContain("이어서");
    expect(brief).toContain("빠른 출시");
    expect(brief).toContain("status를 done");

    const second = await preparePlanHostSession(root, "plan-direction", "claude", "약점 루프");
    expect(second.resumed).toBe(true);
    expect(second.files.thread).toContain("방향");
    expect(second.files.host?.host).toBe("claude");
  });
});

describe("launchPlanHost", () => {
  it("opens the injected host and records the session files", async () => {
    const studioHome = tmpDir("patchbay-host-studio-");
    const projectPath = tmpDir("patchbay-host-repo-");
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectPath });
    await writeOverlayIfAbsent(studioHome, "demo");

    const launched: string[] = [];
    const result = await launchPlanHost(
      studioHome,
      { alias: "demo", stepId: "plan-goal", host: "cursor", note: "끝나는 상태는 출시" },
      async (req) => {
        launched.push(`${req.kind}:${req.briefRel}:${req.resume}`);
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(launched).toEqual(["cursor:docs/기획/브리핑.md:false"]);
    expect(result.resumed).toBe(false);
    expect(result.host.status).toBe("running");
    expect(result.briefRel).toBe("docs/기획/브리핑.md");
    expect(fs.existsSync(path.join(projectPath, "docs/기획/기억.md"))).toBe(true);

    fs.writeFileSync(path.join(projectPath, "docs/기획/목표.md"), "목표: 빠른 출시\n채택: 약점 루프\n", "utf8");
    const again = await launchPlanHost(
      studioHome,
      { alias: "demo", stepId: "plan-direction", host: "claude" },
      async () => undefined,
    );
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.resumed).toBe(true);
    expect(again.memory).toContain("기억");
  });

  it("does not copy 방향 arrows from 기억.md into 실행 순서", async () => {
    const studioHome = tmpDir("patchbay-host-no-dir-steps-");
    const projectPath = tmpDir("patchbay-host-no-dir-steps-repo-");
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectPath });
    await writeOverlayIfAbsent(studioHome, "demo");
    fs.mkdirSync(path.join(projectPath, "docs/기획"), { recursive: true });
    fs.writeFileSync(
      path.join(projectPath, "docs/기획/목표.md"),
      ["# 목표", "", "| 항목 | 값 |", "| --- | --- |", "| 목표 | 6주 105점 |"].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(projectPath, "docs/기획/기억.md"),
      [
        "# 기억",
        "",
        "## 목표",
        "",
        "6주 105점",
        "",
        "## 방향",
        "",
        "채택: 약점 루프 (오답 유형 → 강의 조각 → 같은 유형 한 문항).",
        "",
        "## 실행",
        "",
        "(아직 없음)",
      ].join("\n"),
      "utf8",
    );
    const loaded = await loadProcessStep(studioHome, "demo", "plan-goal");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.artifact.nodes).toEqual([]);
    const { readOverlay } = await import("@patchbay/core");
    const overlay = await readOverlay(studioHome, "demo");
    expect(overlay.process.goal).toBe("6주 105점");
    expect(overlay.process.steps).toEqual([]);
  });

  it("drops 실행 순서 rows that were copied from 방향 arrows", async () => {
    const studioHome = tmpDir("patchbay-host-drop-arrows-");
    const projectPath = tmpDir("patchbay-host-drop-arrows-repo-");
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectPath });
    await writeOverlayIfAbsent(studioHome, "demo");
    const { writeOverlayProcess } = await import("@patchbay/core");
    await writeOverlayProcess(studioHome, "demo", {
      configured: true,
      goal: "6주 105점",
      folders: [],
      steps: [{ id: "step-1", label: "오답 유형 → 강의 조각", output: "table" }],
      edges: [],
      bind: {},
    });
    fs.mkdirSync(path.join(projectPath, "docs/기획"), { recursive: true });
    fs.writeFileSync(path.join(projectPath, "docs/기획/목표.md"), "| 항목 | 값 |\n| --- | --- |\n| 목표 | 6주 105점 |\n", "utf8");
    const loaded = await loadProcessStep(studioHome, "demo", "plan-goal");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const { readOverlay } = await import("@patchbay/core");
    const overlay = await readOverlay(studioHome, "demo");
    expect(overlay.process.steps).toEqual([]);
  });

  it("fills 실행 순서 from 실행.md after a host session", async () => {
    const studioHome = tmpDir("patchbay-host-order-");
    const projectPath = tmpDir("patchbay-host-order-repo-");
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectPath });
    await writeOverlayIfAbsent(studioHome, "demo");
    await launchPlanHost(studioHome, { alias: "demo", stepId: "plan-proceed", host: "cursor" }, async () => undefined);
    fs.writeFileSync(
      path.join(projectPath, "docs/기획/실행.md"),
      ["# 실행", "", "1. 오답 접수", "2. 약점 진단"].join("\n"),
      "utf8",
    );
    const loaded = await loadProcessStep(studioHome, "demo", "plan-proceed");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.step.filled).toBe(true);
    expect(loaded.host?.status).toBe("running");
    const { readOverlay } = await import("@patchbay/core");
    const overlay = await readOverlay(studioHome, "demo");
    expect(overlay.process.steps.map((step) => step.label)).toEqual(["오답 접수", "약점 진단"]);
  });

  it("keeps a filled draft running until the host explicitly completes it", async () => {
    const studioHome = tmpDir("patchbay-host-done-");
    const projectPath = tmpDir("patchbay-host-done-repo-");
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectPath });
    await writeOverlayIfAbsent(studioHome, "demo");
    const opened = await launchPlanHost(
      studioHome,
      { alias: "demo", stepId: "plan-goal", host: "cursor" },
      async () => undefined,
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.host.status).toBe("running");
    fs.writeFileSync(path.join(projectPath, "docs/기획/목표.md"), "목표: 빠른 출시\n", "utf8");
    const loaded = await loadProcessStep(studioHome, "demo", "plan-goal");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.host?.status).toBe("running");
    expect(loaded.step.filled).toBe(true);
    fs.writeFileSync(
      path.join(projectPath, "docs/기획/host.json"),
      JSON.stringify(
        {
          host: "cursor",
          beatId: "plan-goal",
          openedAt: opened.host.openedAt,
          status: "done",
          doneAt: new Date().toISOString(),
          completed: ["plan-goal"],
        },
        null,
        2,
      ),
      "utf8",
    );
    const completed = await loadProcessStep(studioHome, "demo", "plan-goal");
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.host?.status).toBe("done");
    expect(completed.host?.completed).toEqual(["plan-goal"]);
    const { readOverlay } = await import("@patchbay/core");
    const overlay = await readOverlay(studioHome, "demo");
    expect(overlay.process.goal).toBe("빠른 출시");
  });

  it("does not mark 방향 complete from a draft written before this session", async () => {
    const studioHome = tmpDir("patchbay-host-draft-");
    const projectPath = tmpDir("patchbay-host-draft-repo-");
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectPath });
    await writeOverlayIfAbsent(studioHome, "demo");
    fs.mkdirSync(path.join(projectPath, "docs/기획"), { recursive: true });
    fs.writeFileSync(
      path.join(projectPath, "docs/기획/방향.md"),
      ["# 방향", "", "| 구분 | 방향 |", "| --- | --- |", "| 채택 | 약점 루프 |"].join("\n"),
      "utf8",
    );
    const past = new Date(Date.now() - 60_000).toISOString();
    fs.utimesSync(path.join(projectPath, "docs/기획/방향.md"), new Date(past), new Date(past));
    const opened = await launchPlanHost(
      studioHome,
      { alias: "demo", stepId: "plan-direction", host: "cursor" },
      async () => undefined,
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const loaded = await loadProcessStep(studioHome, "demo", "plan-direction");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.host?.status).toBe("running");
    expect(loaded.step.filled).toBe(true);
  });
});

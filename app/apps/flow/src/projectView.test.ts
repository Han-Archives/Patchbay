import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendWire,
  ensureStudioInitialized,
  inferredSchema,
  projectStudioDir,
  readOverlay,
  registerProject,
  type Wire,
  writeInferred,
  writeOverlayIfAbsent,
  writeProgressEntry,
} from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { loadProjectView } from "./projectView.js";
import { isProjectViewOk, EMPTY_PROCESS_VIEW, structureKey } from "./projectContract.js";

function tmpStudioHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-project-view-"));
}

const SAMPLE_INFERRED = inferredSchema.parse({
  discoveredPorts: ["skill:map-project", "source:README.md"],
  git: { branch: "main", head: "abc1234", recentCommitSubjects: ["init"] },
  agents: [],
});

async function seedScanned(studioHome: string, alias: string, projectPath: string): Promise<void> {
  await ensureStudioInitialized(studioHome);
  await registerProject(studioHome, { alias, kind: "local_repo", path: projectPath });
  await writeOverlayIfAbsent(studioHome, alias);
  await writeInferred(studioHome, alias, SAMPLE_INFERRED);
}

describe("loadProjectView", () => {
  it("returns 400 when alias is missing", async () => {
    const result = await loadProjectView(tmpStudioHome(), undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("returns 404 for an unregistered alias", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    const result = await loadProjectView(studioHome, "nope");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error).toContain("No project registered");
    }
  });

  it("returns unscanned when inferred.json is missing", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "bare", kind: "local_repo", path: "/tmp/bare" });

    const result = await loadProjectView(studioHome, "bare");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toEqual({
        status: "unscanned",
        alias: "bare",
        path: "/tmp/bare",
        process: EMPTY_PROCESS_VIEW,
        design: null,
      });
    }
  });

  it("returns Core Atlas sections and idle progress for a scanned project", async () => {
    const studioHome = tmpStudioHome();
    await seedScanned(studioHome, "demo", "/tmp/does-not-matter");

    const result = await loadProjectView(studioHome, "demo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isProjectViewOk(result.body)).toBe(true);
    if (!isProjectViewOk(result.body)) return;

    expect(result.body.sections.unlabeledPorts).toEqual(["skill:map-project"]);
    expect(result.body.sections.rules).toEqual(["source:README.md"]);
    expect(result.body.sections.skills).toEqual([]);
    expect(result.body.counts.unlabeledPorts).toBe(1);
    expect(result.body.currentLine).toBe("진행 중인 작업 없음");
    expect(result.body.progress.current).toBeNull();
    expect(result.body.decisions).toEqual([]);
    expect(result.body.process).toEqual(EMPTY_PROCESS_VIEW);
    expect(result.body.clarity).toBeNull();
    expect(result.body.git.branch).toBe("main");
  });

  it("surfaces a recorded progress current line and overlay wires without a patch", async () => {
    const studioHome = tmpStudioHome();
    await seedScanned(studioHome, "demo", "/tmp/does-not-matter");
    await writeProgressEntry(studioHome, "demo", { summary: "wiring atlas into the console", skill: "map-project" });
    await appendWire(studioHome, "demo", {
      project: "demo",
      from: "skill:map-project",
      to: "skill:skills/map-project/SKILL.md",
      kind: "uses",
      install: "symlink",
    } as Wire);

    const result = await loadProjectView(studioHome, "demo");
    expect(result.ok).toBe(true);
    if (!result.ok || !isProjectViewOk(result.body)) return;

    expect(result.body.currentLine).toContain("wiring atlas into the console");
    expect(result.body.progress.current?.summary).toBe("wiring atlas into the console");
    expect(result.body.sections.wiresWithoutPatch).toHaveLength(1);
    expect(result.body.sections.wiresWithoutPatch[0]?.from).toBe("skill:map-project");
    expect(result.body.sections.matched).toEqual([]);
  });

  it("surfaces a matched patch/wire pair as one cable, not a gap", async () => {
    const studioHome = tmpStudioHome();
    await seedScanned(studioHome, "demo", "/tmp/does-not-matter");
    await appendWire(studioHome, "demo", {
      project: "demo",
      from: "skill:map-project",
      to: "skill:skills/map-project/SKILL.md",
      kind: "uses",
      install: "symlink",
    } as Wire);
    // No `appendPatch` helper exists yet (patches are written by `patchbay
    // patch`, spec Phase 5) -- write the overlay's `patches` array directly.
    // JSON is valid YAML, so this round-trips through `readOverlay`'s parser
    // without pulling the `yaml` package into this test.
    const overlay = await readOverlay(studioHome, "demo");
    const withPatch = {
      ...overlay,
      patches: [{ project: "demo", from: "skill:map-project", to: "skill:skills/map-project/SKILL.md", kind: "uses" }],
    };
    const overlayPath = path.join(projectStudioDir(studioHome, "demo"), "overlay.yaml");
    fs.writeFileSync(overlayPath, JSON.stringify(withPatch), "utf8");

    const result = await loadProjectView(studioHome, "demo");
    expect(result.ok).toBe(true);
    if (!result.ok || !isProjectViewOk(result.body)) return;

    expect(result.body.sections.wiresWithoutPatch).toEqual([]);
    expect(result.body.sections.matched).toEqual([
      { from: "skill:map-project", to: "skill:skills/map-project/SKILL.md", kind: "uses" },
    ]);
  });

  it("recomputes clarity when the registered path exists on disk", async () => {
    const studioHome = tmpStudioHome();
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-clarity-"));
    fs.writeFileSync(path.join(projectPath, "README.md"), "# demo\n");
    await seedScanned(studioHome, "demo", projectPath);

    const result = await loadProjectView(studioHome, "demo");
    expect(result.ok).toBe(true);
    if (!result.ok || !isProjectViewOk(result.body)) return;
    expect(result.body.clarity).toBe(100);
  });

  it("surfaces overlay decisions on the project view without changing Atlas sections", async () => {
    const studioHome = tmpStudioHome();
    await seedScanned(studioHome, "demo", "/tmp/does-not-matter");
    fs.writeFileSync(
      path.join(studioHome, "projects", "demo", "overlay.yaml"),
      [
        "patches: []",
        "wires: []",
        "decisions:",
        "  - id: adopt-a",
        "    concept: path",
        "    summary: 채택 — 약점 루프",
        "    rationale: 진행이 파일에 남는다",
        '    date: "2026-09-21"',
        "accepted_guides: []",
        "",
      ].join("\n"),
    );

    const result = await loadProjectView(studioHome, "demo");
    expect(result.ok).toBe(true);
    if (!result.ok || !isProjectViewOk(result.body)) return;

    expect(result.body.decisions).toEqual([
      {
        id: "adopt-a",
        concept: "path",
        summary: "채택 — 약점 루프",
        rationale: "진행이 파일에 남는다",
        date: "2026-09-21",
      },
    ]);
    expect(result.body.sections.unlabeledPorts).toEqual(["skill:map-project"]);
  });

  it("surfaces overlay.process on the project view", async () => {
    const studioHome = tmpStudioHome();
    await seedScanned(studioHome, "demo", "/tmp/does-not-matter");
    fs.writeFileSync(
      path.join(studioHome, "projects", "demo", "overlay.yaml"),
      [
        "patches: []",
        "wires: []",
        "decisions: []",
        "accepted_guides: []",
        "process:",
        "  configured: true",
        "  goal: 빠른 출시",
        "  folders:",
        "    - docs/기획",
        "  steps:",
        "    - id: intake",
        "      label: 오답 접수",
        "    - id: diagnose",
        "      label: 진단",
        "  edges:",
        "    - from: intake",
        "      to: diagnose",
        "  bind: {}",
        "",
      ].join("\n"),
    );

    const result = await loadProjectView(studioHome, "demo");
    expect(result.ok).toBe(true);
    if (!result.ok || !isProjectViewOk(result.body)) return;
    expect(result.body.process.configured).toBe(true);
    expect(result.body.process.goal).toBe("빠른 출시");
    expect(result.body.process.steps.map((step) => step.id)).toEqual(["intake", "diagnose"]);
    expect(result.body.process.steps.map((step) => step.output)).toEqual(["table", "table"]);
    expect(result.body.process.steps.every((step) => step.filled === false)).toBe(true);
  });
});

describe("structureKey", () => {
  const sections = {
    skills: ["skill:a"],
    rules: ["source:README.md"],
    unlabeledPorts: [],
    matched: [],
    patchesWithoutWire: [],
    wiresWithoutPatch: [],
  };

  it("구조 칸이 같으면 같다 — 진행 기록만 바뀐 새로고침에서는 다시 읽지 않는다", () => {
    expect(structureKey({ alias: "demo", sections })).toBe(structureKey({ alias: "demo", sections: { ...sections } }));
  });

  it("항목이 늘거나 프로젝트가 바뀌면 달라진다", () => {
    const base = structureKey({ alias: "demo", sections });
    expect(structureKey({ alias: "demo", sections: { ...sections, rules: ["source:README.md", "source:CLAUDE.md"] } })).not.toBe(base);
    expect(structureKey({ alias: "other", sections })).not.toBe(base);
  });
});

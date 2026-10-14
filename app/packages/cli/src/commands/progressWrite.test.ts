import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readProgress, registerProject } from "@patchbay/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runProgressWrite } from "./progressWrite.js";

// Safety: every test sets PATCHBAY_HOME to a freshly created OS tmpdir --
// never the real ~/.patchbay.
let studioHome: string;
let originalPatchbayHome: string | undefined;

beforeEach(() => {
  originalPatchbayHome = process.env.PATCHBAY_HOME;
  studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-progress-write-home-"));
  process.env.PATCHBAY_HOME = studioHome;
});

afterEach(() => {
  if (originalPatchbayHome === undefined) delete process.env.PATCHBAY_HOME;
  else process.env.PATCHBAY_HOME = originalPatchbayHome;
  vi.restoreAllMocks();
});

describe("runProgressWrite", () => {
  it("exit 1 when --project is missing", async () => {
    const exitCode = await runProgressWrite({ summary: "doing a thing" }, studioHome);
    expect(exitCode).toBe(1);
  });

  it("exit 1 when --summary is missing", async () => {
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    const exitCode = await runProgressWrite({ project: "demo" }, studioHome);
    expect(exitCode).toBe(1);
  });

  it("exit 1 when --project isn't a registered alias", async () => {
    const exitCode = await runProgressWrite({ project: "nope", summary: "x" }, studioHome);
    expect(exitCode).toBe(1);
  });

  it("a single call writes progress.yaml, PROGRESS.md, and the studio-wide progress.md all at once", async () => {
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });

    const exitCode = await runProgressWrite(
      { project: "demo", summary: "wiring up the progress surface", skill: "skill:map-project", step: "scan" },
      studioHome,
    );
    expect(exitCode).toBe(0);

    const progressYamlPath = path.join(studioHome, "projects", "demo", "progress.yaml");
    const progressMdPath = path.join(studioHome, "projects", "demo", "PROGRESS.md");
    const studioRollupPath = path.join(studioHome, "progress.md");

    expect(fs.existsSync(progressYamlPath)).toBe(true);
    expect(fs.existsSync(progressMdPath)).toBe(true);
    expect(fs.existsSync(studioRollupPath)).toBe(true);

    const progress = await readProgress(studioHome, "demo");
    expect(progress.current?.summary).toBe("wiring up the progress surface");
    expect(progress.current?.skill).toBe("skill:map-project");
    expect(progress.current?.step).toBe("scan");
    expect(progress.current?.project).toBe("demo");

    const progressMd = fs.readFileSync(progressMdPath, "utf8");
    expect(progressMd).toContain("wiring up the progress surface");

    const rollup = fs.readFileSync(studioRollupPath, "utf8");
    expect(rollup).toContain("demo");
    expect(rollup).toContain("wiring up the progress surface");
  });

  it("current's content comes only from the given arguments -- summary/skill/step are exactly what was passed, nothing derived", async () => {
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    await runProgressWrite({ project: "demo", summary: "exact text here" }, studioHome);

    const progress = await readProgress(studioHome, "demo");
    expect(progress.current?.summary).toBe("exact text here");
    expect(progress.current?.skill).toBeUndefined();
    expect(progress.current?.step).toBeUndefined();
  });

  it("the studio-wide rollup reflects every registered project, not just the one just written", async () => {
    await registerProject(studioHome, { alias: "alpha", kind: "local_repo", path: "/tmp/alpha" });
    await registerProject(studioHome, { alias: "beta", kind: "local_repo", path: "/tmp/beta" });

    await runProgressWrite({ project: "alpha", summary: "alpha's work" }, studioHome);

    const rollupPath = path.join(studioHome, "progress.md");
    const rollup = fs.readFileSync(rollupPath, "utf8");
    expect(rollup).toContain("alpha");
    expect(rollup).toContain("alpha's work");
    expect(rollup).toContain("beta");
  });

  it("a second write for the same project moves the old current into history and updates the rollup", async () => {
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    await runProgressWrite({ project: "demo", summary: "first" }, studioHome);
    await runProgressWrite({ project: "demo", summary: "second" }, studioHome);

    const progress = await readProgress(studioHome, "demo");
    expect(progress.current?.summary).toBe("second");
    expect(progress.history.map((entry) => entry.summary)).toEqual(["first"]);

    const rollup = fs.readFileSync(path.join(studioHome, "progress.md"), "utf8");
    expect(rollup).toContain("second");
  });

  it("--json prints a machine-readable success payload with the written paths", async () => {
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const exitCode = await runProgressWrite({ project: "demo", summary: "json check", json: true }, studioHome);
    expect(exitCode).toBe(0);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(payload.ok).toBe(true);
    expect(payload.alias).toBe("demo");
    expect(path.isAbsolute(payload.progressMdPath)).toBe(true);
    expect(path.isAbsolute(payload.rollupPath)).toBe(true);
  });

  it("never prompts (no readline / stdin interaction)", async () => {
    // Nothing here can block on stdin -- this test documents the contract
    // rather than exercising a TTY, matching the style of projectAdd's own
    // "never prompts" note.
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    const exitCode = await runProgressWrite({ project: "demo", summary: "no prompt" }, studioHome);
    expect(exitCode).toBe(0);
  });
});

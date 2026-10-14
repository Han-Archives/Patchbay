import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerProject } from "@patchbay/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runProgress } from "./progress.js";
import { runProgressWrite } from "./progressWrite.js";

// Safety: every test sets PATCHBAY_HOME to a freshly created OS tmpdir --
// never the real ~/.patchbay.
let studioHome: string;
let originalPatchbayHome: string | undefined;

beforeEach(() => {
  originalPatchbayHome = process.env.PATCHBAY_HOME;
  studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-progress-home-"));
  process.env.PATCHBAY_HOME = studioHome;
});

afterEach(() => {
  if (originalPatchbayHome === undefined) delete process.env.PATCHBAY_HOME;
  else process.env.PATCHBAY_HOME = originalPatchbayHome;
  vi.restoreAllMocks();
});

describe("runProgress: --project omitted (studio-wide rollup)", () => {
  it("exit 1 with a clear error when nothing has ever been written (rollup doesn't exist yet)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitCode = await runProgress({}, studioHome);
    expect(exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("does NOT default to a sole registered project -- prints the studio rollup even with exactly one project registered", async () => {
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    await runProgressWrite({ project: "demo", summary: "solo project work" }, studioHome);

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const exitCode = await runProgress({}, studioHome);
    expect(exitCode).toBe(0);

    const printed = writeSpy.mock.calls[0]?.[0] as string;
    // The rollup format ("# Studio Progress"), not the per-project level-1
    // one-liner -- proves --project omission took the studio-wide path, not
    // a sole-project default.
    expect(printed).toContain("# Studio Progress");
    expect(printed).toContain("demo");
    expect(printed).toContain("solo project work");
  });

  it("prints every registered project's current status, not just one", async () => {
    await registerProject(studioHome, { alias: "alpha", kind: "local_repo", path: "/tmp/alpha" });
    await registerProject(studioHome, { alias: "beta", kind: "local_repo", path: "/tmp/beta" });
    await runProgressWrite({ project: "alpha", summary: "alpha work" }, studioHome);

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const exitCode = await runProgress({}, studioHome);
    expect(exitCode).toBe(0);

    const printed = writeSpy.mock.calls[0]?.[0] as string;
    expect(printed).toContain("alpha");
    expect(printed).toContain("alpha work");
    expect(printed).toContain("beta");
  });
});

describe("runProgress: --project <alias> given", () => {
  it("exit 1 when the alias isn't registered", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitCode = await runProgress({ project: "nope" }, studioHome);
    expect(exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("this is distinct from --project omitted: an unregistered alias errors, while omission never errors for that reason", async () => {
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    await runProgressWrite({ project: "demo", summary: "work" }, studioHome);

    const omittedExit = await runProgress({}, studioHome);
    const unregisteredExit = await runProgress({ project: "nope" }, studioHome);
    expect(omittedExit).toBe(0);
    expect(unregisteredExit).toBe(1);
  });

  it("level 1 (default) prints just the current summary for a registered-but-never-written project", async () => {
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const exitCode = await runProgress({ project: "demo" }, studioHome);
    expect(exitCode).toBe(0);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("진행 중인 작업 없음"));
  });

  it("level 1 prints the recorded summary after a write", async () => {
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    await runProgressWrite({ project: "demo", summary: "level 1 check" }, studioHome);

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const exitCode = await runProgress({ project: "demo", level: "1" }, studioHome);
    expect(exitCode).toBe(0);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("level 1 check"));
  });

  it("level 2 prints the full PROGRESS.md content", async () => {
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    await runProgressWrite({ project: "demo", summary: "level 2 check" }, studioHome);

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const exitCode = await runProgress({ project: "demo", level: "2" }, studioHome);
    expect(exitCode).toBe(0);
    const printed = writeSpy.mock.calls[0]?.[0] as string;
    expect(printed).toContain("# Progress");
    expect(printed).toContain("level 2 check");
  });

  it("level 2 exit 1 with a clear error when PROGRESS.md hasn't been generated yet", async () => {
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitCode = await runProgress({ project: "demo", level: "2" }, studioHome);
    expect(exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("level 3 prints raw progress.yaml content", async () => {
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    await runProgressWrite({ project: "demo", summary: "level 3 check" }, studioHome);

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const exitCode = await runProgress({ project: "demo", level: "3" }, studioHome);
    expect(exitCode).toBe(0);
    const printed = writeSpy.mock.calls[0]?.[0] as string;
    expect(printed).toContain("level 3 check");
    expect(printed).toContain("current");
  });

  it("level 3 works even before any progress write (default empty progress.yaml, still exit 0)", async () => {
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const exitCode = await runProgress({ project: "demo", level: "3" }, studioHome);
    expect(exitCode).toBe(0);
    expect(writeSpy).toHaveBeenCalled();
  });

  it("rejects an invalid --level value with exit 1, no silent fallback", async () => {
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitCode = await runProgress({ project: "demo", level: "9" }, studioHome);
    expect(exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});

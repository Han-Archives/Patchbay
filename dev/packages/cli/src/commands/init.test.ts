import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readStudio } from "@patchbay/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInit } from "./init.js";

// Safety: every test sets PATCHBAY_HOME to a freshly created OS tmpdir --
// never the real ~/.patchbay -- even though runInit is also given an
// explicit studioHome below.
let studioHome: string;
let originalPatchbayHome: string | undefined;

beforeEach(() => {
  originalPatchbayHome = process.env.PATCHBAY_HOME;
  studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-init-"));
  process.env.PATCHBAY_HOME = studioHome;
});

afterEach(() => {
  if (originalPatchbayHome === undefined) delete process.env.PATCHBAY_HOME;
  else process.env.PATCHBAY_HOME = originalPatchbayHome;
  vi.restoreAllMocks();
});

describe("runInit", () => {
  it("exits 0 and writes studio.yaml with the given name", async () => {
    const exitCode = await runInit({ name: "My Studio" }, studioHome);
    expect(exitCode).toBe(0);
    const studio = await readStudio(studioHome);
    expect(studio.name).toBe("My Studio");
    expect(studio.projects).toEqual([]);
  });

  it("defaults the name to something reasonable (no prompting) when omitted", async () => {
    const exitCode = await runInit({}, studioHome);
    expect(exitCode).toBe(0);
    const studio = await readStudio(studioHome);
    expect(studio.name.length).toBeGreaterThan(0);
  });

  it("is idempotent and preserves already-registered projects on a second init", async () => {
    await runInit({ name: "First" }, studioHome);
    // Simulate a project already registered before a second `init` call.
    const studio = await readStudio(studioHome);
    const { writeStudio } = await import("@patchbay/core");
    await writeStudio(studioHome, {
      ...studio,
      projects: [{ alias: "demo", kind: "local_repo", path: "/tmp/demo" }],
    });

    await runInit({ name: "Second" }, studioHome);
    const updated = await readStudio(studioHome);
    expect(updated.name).toBe("Second");
    expect(updated.projects).toEqual([{ alias: "demo", kind: "local_repo", path: "/tmp/demo" }]);
  });

  it("prints JSON when --json is passed", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runInit({ name: "JSON Studio", json: true }, studioHome);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(printed).toMatchObject({ ok: true, name: "JSON Studio" });
  });
});

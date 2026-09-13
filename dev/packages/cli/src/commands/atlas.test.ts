import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerProject, writeAtlas } from "@patchbay/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAtlas } from "./atlas.js";

// Safety: every test sets PATCHBAY_HOME to a freshly created OS tmpdir --
// never the real ~/.patchbay.
let studioHome: string;
let originalPatchbayHome: string | undefined;

beforeEach(() => {
  originalPatchbayHome = process.env.PATCHBAY_HOME;
  studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-atlas-home-"));
  process.env.PATCHBAY_HOME = studioHome;
});

afterEach(() => {
  if (originalPatchbayHome === undefined) delete process.env.PATCHBAY_HOME;
  else process.env.PATCHBAY_HOME = originalPatchbayHome;
  vi.restoreAllMocks();
});

describe("runAtlas", () => {
  it("exit 1 when the alias isn't registered", async () => {
    const exitCode = await runAtlas({ project: "nope" }, studioHome);
    expect(exitCode).toBe(1);
  });

  it("exit 1 when nothing is registered and no --project is given", async () => {
    const exitCode = await runAtlas({}, studioHome);
    expect(exitCode).toBe(1);
  });

  it("prints the current ATLAS.md content to stdout and exits 0", async () => {
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    await writeAtlas(studioHome, "demo", "## Skills\n\n없음\n");

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const exitCode = await runAtlas({ project: "demo" }, studioHome);

    expect(exitCode).toBe(0);
    expect(writeSpy).toHaveBeenCalledWith("## Skills\n\n없음\n");
  });

  it("exit 1 with a clear error when ATLAS.md hasn't been generated yet", async () => {
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    const exitCode = await runAtlas({ project: "demo" }, studioHome);
    expect(exitCode).toBe(1);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readStudio } from "@patchbay/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runProjectNew } from "./projectNew.js";

// Safety: every test sets PATCHBAY_HOME to a freshly created OS tmpdir --
// never the real ~/.patchbay.
let studioHome: string;
let originalPatchbayHome: string | undefined;

beforeEach(() => {
  originalPatchbayHome = process.env.PATCHBAY_HOME;
  studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-project-new-home-"));
  process.env.PATCHBAY_HOME = studioHome;
});

afterEach(() => {
  if (originalPatchbayHome === undefined) delete process.env.PATCHBAY_HOME;
  else process.env.PATCHBAY_HOME = originalPatchbayHome;
});

describe("runProjectNew", () => {
  it("exit 1 when --path is missing", async () => {
    const exitCode = await runProjectNew("demo", {}, studioHome);
    expect(exitCode).toBe(1);
    const studio = await readStudio(studioHome);
    expect(studio.projects).toEqual([]);
  });

  it("creates the directory when it doesn't exist, and registers the project", async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-project-new-parent-"));
    const target = path.join(parent, "brand-new");

    const exitCode = await runProjectNew("demo", { path: target }, studioHome);
    expect(exitCode).toBe(0);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.statSync(target).isDirectory()).toBe(true);

    const studio = await readStudio(studioHome);
    expect(studio.projects).toEqual([{ alias: "demo", kind: "local_repo", path: target }]);
  });

  it("exit 1, nothing written, when the directory exists and is non-empty", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-project-new-nonempty-"));
    fs.writeFileSync(path.join(dir, "existing.txt"), "hello\n");

    const exitCode = await runProjectNew("demo", { path: dir }, studioHome);
    expect(exitCode).toBe(1);

    const studio = await readStudio(studioHome);
    expect(studio.projects).toEqual([]);
    expect(fs.readdirSync(dir)).toEqual(["existing.txt"]);
  });

  it("succeeds when the directory exists but is empty", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-project-new-empty-"));
    const exitCode = await runProjectNew("demo", { path: dir }, studioHome);
    expect(exitCode).toBe(0);
  });

  it("exit 1 on an alias collision, without touching the existing registration", async () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-project-new-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-project-new-b-"));
    await runProjectNew("dup", { path: dirA }, studioHome);

    const exitCode = await runProjectNew("dup", { path: dirB }, studioHome);
    expect(exitCode).toBe(1);

    const studio = await readStudio(studioHome);
    expect(studio.projects).toEqual([{ alias: "dup", kind: "local_repo", path: dirA }]);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ProjectAliasAlreadyRegisteredError,
  ensureStudioInitialized,
  readStudio,
  registerProject,
  resolveStudioHome,
  writeStudio,
} from "./studioStore.js";

// Safety: every test in this file must operate on a freshly created OS
// tmpdir, never the real `~/.patchbay`. `studioHome` below is that tmpdir;
// `PATCHBAY_HOME` is additionally set/restored around each test so
// `resolveStudioHome()` itself is also covered without ever resolving to a
// real home directory.
let studioHome: string;
let originalPatchbayHome: string | undefined;

beforeEach(() => {
  originalPatchbayHome = process.env.PATCHBAY_HOME;
  studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-studio-store-"));
  process.env.PATCHBAY_HOME = studioHome;
});

afterEach(() => {
  if (originalPatchbayHome === undefined) {
    delete process.env.PATCHBAY_HOME;
  } else {
    process.env.PATCHBAY_HOME = originalPatchbayHome;
  }
});

describe("resolveStudioHome", () => {
  it("returns PATCHBAY_HOME when set", () => {
    expect(resolveStudioHome()).toBe(studioHome);
  });

  it("falls back to ~/.patchbay when unset", () => {
    delete process.env.PATCHBAY_HOME;
    expect(resolveStudioHome()).toBe(path.join(os.homedir(), ".patchbay"));
  });
});

describe("ensureStudioInitialized", () => {
  it("creates the directory and a git repo inside it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-studio-store-init-"));
    const target = path.join(dir, "nested", "home");
    await ensureStudioInitialized(target);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.existsSync(path.join(target, ".git"))).toBe(true);
  });

  it("is idempotent: calling it again does not throw or reset the repo", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-studio-store-init-"));
    await ensureStudioInitialized(dir);
    fs.writeFileSync(path.join(dir, "marker.txt"), "hello\n");
    await expect(ensureStudioInitialized(dir)).resolves.toBeUndefined();
    // The pre-existing file survives a second init -- proof it wasn't reset.
    expect(fs.existsSync(path.join(dir, "marker.txt"))).toBe(true);
  });
});

describe("readStudio", () => {
  it("returns a fresh default Studio when studio.yaml doesn't exist", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-studio-store-read-"));
    const studio = await readStudio(dir);
    expect(studio.projects).toEqual([]);
    expect(typeof studio.name).toBe("string");
    expect(studio.name.length).toBeGreaterThan(0);
  });

  it("round-trips a written studio.yaml", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-studio-store-read-"));
    await writeStudio(dir, {
      name: "Test Studio",
      projects: [{ alias: "demo", kind: "local_repo", path: "/tmp/demo" }],
    });
    const studio = await readStudio(dir);
    expect(studio).toEqual({
      name: "Test Studio",
      projects: [{ alias: "demo", kind: "local_repo", path: "/tmp/demo" }],
    });
  });
});

describe("writeStudio", () => {
  it("validates via studioSchema before writing (rejects a bad shape)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-studio-store-write-"));
    // @ts-expect-error -- deliberately invalid Studio shape for this test
    await expect(writeStudio(dir, { name: "x", projects: [{ alias: "a" }] })).rejects.toBeDefined();
  });
});

describe("registerProject", () => {
  it("appends a project to an empty studio and returns the updated Studio", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-studio-store-register-"));
    const updated = await registerProject(dir, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    expect(updated.projects).toEqual([{ alias: "demo", kind: "local_repo", path: "/tmp/demo" }]);

    const persisted = await readStudio(dir);
    expect(persisted.projects).toEqual(updated.projects);
  });

  it("rejects with a clear error when the alias already exists, without overwriting it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-studio-store-register-"));
    await registerProject(dir, { alias: "demo", kind: "local_repo", path: "/tmp/demo-1" });

    await expect(
      registerProject(dir, { alias: "demo", kind: "local_repo", path: "/tmp/demo-2" }),
    ).rejects.toBeInstanceOf(ProjectAliasAlreadyRegisteredError);

    const persisted = await readStudio(dir);
    expect(persisted.projects).toEqual([{ alias: "demo", kind: "local_repo", path: "/tmp/demo-1" }]);
  });
});

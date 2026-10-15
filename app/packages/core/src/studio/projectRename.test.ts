import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStudio, registerProject, renameProject, setProjectHidden } from "./studioStore.js";
import { readTodos, writeTodos } from "./todoStore.js";

describe("renameProject", () => {
  let base: string;
  let home: string;
  let repo: string;
  beforeEach(async () => {
    base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "pb-rename-")));
    home = path.join(base, "home"); repo = path.join(base, "original");
    await fs.mkdir(path.join(repo, "docs"), { recursive: true });
    await fs.writeFile(path.join(repo, "docs", "note.md"), "keep");
    await registerProject(home, { alias: "demo", kind: "local_repo", path: repo, name: "Before", docs: "docs" });
  });
  afterEach(async () => { vi.restoreAllMocks(); await fs.rm(base, { recursive: true, force: true }); });

  it("moves the actual folder and updates name/path while keeping alias, documents and todo links", async () => {
    await writeTodos(home, "demo", [{ id: "task", title: "keep", at: new Date().toISOString(), done: false, roomId: "room-1" }]);
    await registerProject(home, { alias: "nested", kind: "local_repo", path: path.join(repo, "docs") });
    const result = await renameProject(home, "demo", "  새 프로젝트  ");
    const renamed = path.join(base, "새 프로젝트");
    expect(result.project).toMatchObject({ alias: "demo", name: "새 프로젝트", path: renamed, docs: "docs" });
    expect(await fs.readFile(path.join(renamed, "docs", "note.md"), "utf8")).toBe("keep");
    await expect(fs.stat(repo)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readStudio(home)).projects.find(p => p.alias === "nested")?.path).toBe(path.join(renamed, "docs"));
    expect((await readTodos(home, "demo"))[0]).toMatchObject({ id: "task", roomId: "room-1" });
  });

  it.each(["", " ", ".", "..", "../escape", "a/b", "a\\b", "bad\u0000name", "name:", "trailing."])("rejects unsafe folder name %j", async name => {
    await expect(renameProject(home, "demo", name)).rejects.toMatchObject({ status: 400 });
    expect((await fs.stat(repo)).isDirectory()).toBe(true);
    expect((await readStudio(home)).projects[0]?.name).toBe("Before");
  });

  it("rejects a collision without overwriting either folder", async () => {
    await fs.mkdir(path.join(base, "existing"));
    await fs.writeFile(path.join(base, "existing", "other.txt"), "other");
    await expect(renameProject(home, "demo", "existing")).rejects.toMatchObject({ status: 409 });
    expect(await fs.readFile(path.join(base, "existing", "other.txt"), "utf8")).toBe("other");
    expect((await fs.stat(repo)).isDirectory()).toBe(true);
  });

  it("blocks busy projects, including registered children, and live workspace containers", async () => {
    await registerProject(home, { alias: "nested", kind: "local_repo", path: path.join(repo, "docs") });
    await expect(renameProject(home, "demo", "next", { isBusy: alias => alias === "nested" })).rejects.toMatchObject({ status: 409 });
    await registerProject(home, { alias: "container", kind: "local_repo", path: base });
    await expect(renameProject(home, "container", "next")).rejects.toMatchObject({ status: 409 });
    await expect(renameProject(home, "demo", "next", { protectedPaths: [path.join(repo, "docs")] })).rejects.toMatchObject({ status: 409 });
  });

  it("rejects symlink roots", async () => {
    const link = path.join(base, "linked");
    await fs.symlink(repo, link);
    await registerProject(home, { alias: "link", kind: "local_repo", path: link });
    await expect(renameProject(home, "link", "next")).rejects.toMatchObject({ status: 400 });
  });

  it("rolls back the folder if the registry cannot be committed", async () => {
    const originalRename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (to === path.join(home, "studio.yaml")) throw Object.assign(new Error("write failure"), { code: "EIO" });
      return originalRename(from, to);
    });
    await expect(renameProject(home, "demo", "next")).rejects.toThrow();
    expect((await fs.stat(repo)).isDirectory()).toBe(true);
    await expect(fs.stat(path.join(base, "next"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readStudio(home)).projects[0]).toMatchObject({ name: "Before", path: repo });
  });

  it("serializes rename, registration and hide updates without dropping any changes", async () => {
    await Promise.all([
      renameProject(home, "demo", "next"),
      registerProject(home, { alias: "other", kind: "local_repo", path: path.join(base, "other") }),
      setProjectHidden(home, "demo", true),
    ]);
    const studio = await readStudio(home);
    expect(studio.projects).toHaveLength(2);
    expect(studio.projects.find(p => p.alias === "demo")).toMatchObject({ name: "next", path: path.join(base, "next"), hidden: true });
  });

  it("does not overwrite a newly occupied original path when rollback fails", async () => {
    const originalRename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (to === path.join(home, "studio.yaml")) {
        await fs.mkdir(repo);
        await fs.writeFile(path.join(repo, "other.txt"), "other");
        throw new Error("write failure");
      }
      return originalRename(from, to);
    });
    await expect(renameProject(home, "demo", "next")).rejects.toMatchObject({ status: 500 });
    expect(await fs.readFile(path.join(repo, "other.txt"), "utf8")).toBe("other");
    expect(await fs.readFile(path.join(base, "next", "docs", "note.md"), "utf8")).toBe("keep");
  });

  it("updates the display name when the folder already has that name", async () => {
    expect((await renameProject(home, "demo", "original")).project.name).toBe("original");
    expect((await fs.stat(repo)).isDirectory()).toBe(true);
  });
});

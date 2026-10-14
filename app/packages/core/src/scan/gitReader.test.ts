import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readGitInfo } from "./gitReader.js";

/**
 * Test-only setup: creates a real git repo in the OS tmpdir (never inside
 * this monorepo, so no `.git` fixture is ever committed here) and commits
 * `count` commits, subjects `commit-1`, `commit-2`, ... in order. Shelling
 * out to `git` here is fine -- this is test fixture setup, not the
 * scanner itself, which is the thing that must never shell out.
 */
function initRepoWithCommits(count: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-gitreader-"));
  const run = (cmd: string) =>
    execSync(cmd, {
      cwd: dir,
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Patchbay Test",
        GIT_AUTHOR_EMAIL: "test@patchbay.invalid",
        GIT_COMMITTER_NAME: "Patchbay Test",
        GIT_COMMITTER_EMAIL: "test@patchbay.invalid",
      },
    });

  run("git init -q -b main");
  run("git config user.name 'Patchbay Test'");
  run("git config user.email test@patchbay.invalid");

  for (let i = 1; i <= count; i++) {
    fs.writeFileSync(path.join(dir, `file-${i}.txt`), `content ${i}\n`);
    run(`git add file-${i}.txt`);
    run(`git commit -q -m "commit-${i}"`);
  }

  return dir;
}

describe("readGitInfo", () => {
  it("returns branch, head, and recentCommitSubjects for a real repo", () => {
    const dir = initRepoWithCommits(3);
    return readGitInfo(dir).then((info) => {
      expect(info.branch).toBe("main");
      expect(info.head).toMatch(/^[0-9a-f]{40}$/);
      // most-recent-first
      expect(info.recentCommitSubjects).toEqual(["commit-3", "commit-2", "commit-1"]);
    });
  });

  it("caps recentCommitSubjects at 20 even with more history", () => {
    const dir = initRepoWithCommits(25);
    return readGitInfo(dir).then((info) => {
      expect(info.recentCommitSubjects).toHaveLength(20);
      expect(info.recentCommitSubjects[0]).toBe("commit-25");
      expect(info.recentCommitSubjects[19]).toBe("commit-6");
    });
  });

  it("does not include any ahead/behind information", () => {
    const dir = initRepoWithCommits(1);
    return readGitInfo(dir).then((info) => {
      expect(info).not.toHaveProperty("ahead");
      expect(info).not.toHaveProperty("behind");
      expect(Object.keys(info).sort()).toEqual(["branch", "head", "recentCommitSubjects"]);
    });
  });

  it("falls back to empty branch/head/subjects for a non-git folder, without throwing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-gitreader-nonrepo-"));
    return readGitInfo(dir).then((info) => {
      expect(info).toEqual({ branch: "", head: "", recentCommitSubjects: [] });
    });
  });

  it("does not throw for a git repo with zero commits", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-gitreader-emptyrepo-"));
    execSync("git init -q -b main", { cwd: dir, stdio: "pipe" });
    return readGitInfo(dir).then((info) => {
      expect(info.head).toBe("");
      expect(info.recentCommitSubjects).toEqual([]);
    });
  });

  it("scanning the same commit twice yields identical git info", () => {
    const dir = initRepoWithCommits(2);
    return Promise.all([readGitInfo(dir), readGitInfo(dir)]).then(([first, second]) => {
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { describe, expect, it } from "vitest";
import { backupStudio } from "./backup.js";

describe("backupStudio", () => {
  it("commits only when something changed and never pushes without an origin", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-backup-"));
    await expect(backupStudio(home)).rejects.toThrow(/git 레포가 아니다/);
    const git = simpleGit(home);
    await git.init();
    await git.addConfig("user.email", "t@example.com");
    await git.addConfig("user.name", "t");
    fs.writeFileSync(path.join(home, "studio.yaml"), "projects: []\n");
    const first = await backupStudio(home, { now: new Date("2026-10-14T00:00:00Z") });
    expect(first).toMatchObject({ committed: true, changed: 1, pushed: false });
    expect((await git.log()).latest?.message).toBe("작업 공간 백업 2026-10-14T00:00:00.000Z");
    const second = await backupStudio(home, { push: false });
    expect(second).toEqual({ committed: false, changed: 0, pushed: false });
  });
});

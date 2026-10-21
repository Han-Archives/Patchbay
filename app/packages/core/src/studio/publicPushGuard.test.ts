import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const hook = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../hooks/pre-push");
function git(cwd: string, ...args: string[]) { const r = spawnSync("git", args, { cwd, encoding: "utf8" }); if (r.status) throw new Error(r.stderr); return r.stdout.trim(); }
function commit(cwd: string, file: string, content: string) { fs.writeFileSync(path.join(cwd, file), content); git(cwd, "add", "."); git(cwd, "commit", "-m", file); return git(cwd, "rev-parse", "HEAD"); }
function check(cwd: string, root: string, sha: string, names: string) {
  const list = path.join(cwd, "private-names.txt"); fs.writeFileSync(list, names);
  return spawnSync("sh", [hook], { cwd, input: `refs/heads/main ${sha} refs/heads/main ${root}\n`, encoding: "utf8", env: { ...process.env, PATCHBAY_PUBLIC_ROOT: root, PATCHBAY_PRIVATE_NAMES_FILE: list } });
}
describe("공개 저장소 pre-push", () => {
  it("비공개 이름이 파일 경로나 내용에 있으면 막고 깨끗한 트리는 허용한다", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pb-pre-push-")); git(cwd, "init", "-q"); git(cwd, "config", "user.email", "test@example.com"); git(cwd, "config", "user.name", "test");
    const root = commit(cwd, "README.md", "public\n"); expect(check(cwd, root, root, "secret-project\n").status).toBe(0);
    const bad = commit(cwd, "note.md", "secret-project plan\n"); const result = check(cwd, root, bad, "secret-project\n"); expect(result.status).toBe(1); expect(result.stderr).toContain("비공개 이름");
    fs.unlinkSync(path.join(cwd, "note.md")); git(cwd, "add", "-A"); git(cwd, "commit", "-m", "remove content");
    const badPath = commit(cwd, "secret-project-plan.md", "redacted\n"); expect(check(cwd, root, badPath, "secret-project\n").status).toBe(1);
  });
});

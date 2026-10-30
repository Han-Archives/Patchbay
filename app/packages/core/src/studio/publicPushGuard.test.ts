import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const hook = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../hooks/pre-push");
function git(cwd: string, ...args: string[]) { const r = spawnSync("git", args, { cwd, encoding: "utf8" }); if (r.status) throw new Error(r.stderr); return r.stdout.trim(); }
function commit(cwd: string, file: string, content: string) { fs.writeFileSync(path.join(cwd, file), content); git(cwd, "add", "."); git(cwd, "commit", "-m", file); return git(cwd, "rev-parse", "HEAD"); }
function repo() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pb-pre-push-")); git(cwd, "init", "-q"); git(cwd, "config", "user.email", "test@example.com"); git(cwd, "config", "user.name", "test");
  const root = commit(cwd, "README.md", "public\n"); return { cwd, root };
}
function check(cwd: string, root: string, sha: string, names: string) {
  const list = path.join(cwd, "private-names.txt"); fs.writeFileSync(list, names);
  return spawnSync("sh", [hook], { cwd, input: `refs/heads/main ${sha} refs/heads/main ${root}\n`, encoding: "utf8", env: { ...process.env, PATCHBAY_PUBLIC_ROOT: root, PATCHBAY_PRIVATE_NAMES_FILE: list } });
}
describe("공개 저장소 pre-push", () => {
  it("비공개 이름이 파일 경로나 내용에 있으면 막고 깨끗한 트리는 허용한다", () => {
    const { cwd, root } = repo(); expect(check(cwd, root, root, "secret-project\n").status).toBe(0);
    const bad = commit(cwd, "note.md", "secret-project plan\n"); const result = check(cwd, root, bad, "secret-project\n"); expect(result.status).toBe(1); expect(result.stderr).toContain("비공개 이름");
    fs.unlinkSync(path.join(cwd, "note.md")); git(cwd, "add", "-A"); git(cwd, "commit", "-m", "remove content");
    const badPath = commit(cwd, "secret-project-plan.md", "redacted\n"); expect(check(cwd, root, badPath, "secret-project\n").status).toBe(1);
  });

  it("환경변수·인증 파일 경로는 막되 명시적인 템플릿은 허용한다", () => {
    const clean = repo();
    const template = commit(clean.cwd, ".env.example", "TOKEN=replace-me\n");
    expect(check(clean.cwd, clean.root, template, "").status).toBe(0);

    for (const file of [".env", "prod.env", "credentials.json", "id_ed25519", "server.pem", ".aws/config"]) {
      const sample = repo(); fs.mkdirSync(path.dirname(path.join(sample.cwd, file)), { recursive: true });
      const sha = commit(sample.cwd, file, "placeholder\n");
      const result = check(sample.cwd, sample.root, sha, "");
      expect(result.status, file).toBe(1);
      expect(result.stderr).toContain("비밀 파일 경로");
      expect(result.stderr).toContain(file);
    }
  });

  it("대표 키·개인 키·웹훅 형식을 값 노출 없이 막는다", () => {
    const values = [
      "AK" + "IA" + "A".repeat(16),
      "gh" + "p_" + "a".repeat(36),
      "sk-" + "a".repeat(24),
      "-----BEGIN " + "PRIVATE KEY-----",
      "https://hooks." + "slack.com/services/" + "A".repeat(24),
    ];
    for (const [index, value] of values.entries()) {
      const sample = repo(); const file = `config-${index}.txt`; const sha = commit(sample.cwd, file, `credential=${value}\n`);
      const result = check(sample.cwd, sample.root, sha, "");
      expect(result.status, file).toBe(1);
      expect(result.stderr).toContain("명백한 비밀 값 형식");
      expect(result.stderr).toContain(file);
      expect(result.stderr).not.toContain(value);
    }
  });

  it("뒤 커밋에서 지운 비밀도 공개 이력에 남으므로 막는다", () => {
    const sample = repo(); const value = "gh" + "p_" + "z".repeat(36);
    commit(sample.cwd, "temporary.txt", `${value}\n`);
    fs.unlinkSync(path.join(sample.cwd, "temporary.txt")); git(sample.cwd, "add", "-A"); git(sample.cwd, "commit", "-m", "remove secret");
    const cleanTip = git(sample.cwd, "rev-parse", "HEAD"); const result = check(sample.cwd, sample.root, cleanTip, "");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("명백한 비밀 값 형식");
    expect(result.stderr).not.toContain(value);
  });
});

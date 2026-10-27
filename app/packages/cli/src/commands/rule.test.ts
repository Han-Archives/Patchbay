import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listProjectRules, registerProject } from "@patchbay/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runRule } from "./rule.js";

afterEach(() => vi.restoreAllMocks());

describe("규칙 CLI", () => {
  it("규칙을 저장 · 보기 · 내보내기 하고 등록되지 않은 프로젝트는 거절한다", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-rule-cli-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pb-rule-cli-repo-"));
    await registerProject(home, { alias: "demo", kind: "local_repo", path: repo });
    expect(await runRule("save", { project: "demo", name: "tone", description: "짧게", body: "세 문장 이내.", always: true }, home)).toBe(0);
    expect((await listProjectRules(home, "demo"))[0]).toMatchObject({ name: "tone", apply: "always" });
    expect(await runRule("show", { project: "demo", name: "tone", json: true }, home)).toBe(0);
    expect(await runRule("export", { project: "demo", target: "cursor" }, home)).toBe(0);
    expect(fs.existsSync(path.join(repo, ".cursor", "rules", "tone.mdc"))).toBe(true);
    expect(await runRule("export", { project: "demo", target: "vscode" }, home)).toBe(1);
    expect(await runRule("list", { project: "nope" }, home)).toBe(1);
  });
});

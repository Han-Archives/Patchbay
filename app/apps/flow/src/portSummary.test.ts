import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureStudioInitialized,
  inferredSchema,
  registerProject,
  writeInferred,
  writeOverlayIfAbsent,
} from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { loadPortSummaries, summarizeMarkdown } from "./portSummary.js";

describe("summarizeMarkdown", () => {
  it("prefers a skill's own frontmatter description", () => {
    const skill = [
      "---",
      "name: next-slot",
      "description: 오답 로그에서 유형 하나를 골라 다음날 첫 슬롯에 둔다.",
      "---",
      "",
      "# next-slot",
      "",
      "2주차 준비 자료. 하루가 끝나면 이 스킬이 내일을 고른다.",
      "",
    ].join("\n");
    expect(summarizeMarkdown(skill)).toBe("오답 로그에서 유형 하나를 골라 다음날 첫 슬롯에 둔다.");
  });

  it("falls back to the first paragraph, skipping the heading that just restates the filename", () => {
    const doc = ["# 다음날 첫 슬롯", "", "2주차 Agent 준비. 오답 로그에서 유형 하나만 고른다.", ""].join("\n");
    expect(summarizeMarkdown(doc)).toBe("2주차 Agent 준비. 오답 로그에서 유형 하나만 고른다.");
  });

  it("skips tables, rules, quotes and list bullets to reach real prose", () => {
    const doc = [
      "# 기획",
      "",
      "| 항목 | 값 |",
      "| --- | --- |",
      "| 버전 | 1 |",
      "",
      "---",
      "",
      "> 인용",
      "",
      "- 목록 항목",
      "",
      "이것이 첫 문단이다.",
      "",
    ].join("\n");
    expect(summarizeMarkdown(doc)).toBe("이것이 첫 문단이다.");
  });

  it("strips markdown inline syntax and collapses newlines", () => {
    const doc = "# t\n\n**굵게** 와 `코드` 그리고 [링크](http://x)\n둘째 줄\n";
    expect(summarizeMarkdown(doc)).toBe("굵게 와 코드 그리고 링크 둘째 줄");
  });

  it("clips to one line's worth of characters", () => {
    const long = `# t\n\n${"가".repeat(300)}\n`;
    const summary = summarizeMarkdown(long, 40);
    expect(summary).toHaveLength(40);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("returns empty for a file with nothing but structure", () => {
    expect(summarizeMarkdown("# 제목\n\n## 하위\n")).toBe("");
    expect(summarizeMarkdown("")).toBe("");
  });

  it("ignores frontmatter without a description and reads the body instead", () => {
    expect(summarizeMarkdown("---\nname: x\n---\n\n본문 문장.\n")).toBe("본문 문장.");
  });
});

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const SAMPLE = inferredSchema.parse({
  discoveredPorts: ["source:README.md", "skill:skills/one/SKILL.md"],
  git: { branch: "main", head: "abc1234", recentCommitSubjects: [] },
  agents: [],
});

describe("loadPortSummaries", () => {
  it("returns 400 without alias and 404 for an unregistered one", async () => {
    const studioHome = tmpDir("patchbay-ports-");
    await ensureStudioInitialized(studioHome);
    const missing = await loadPortSummaries(studioHome, undefined);
    expect(missing).toMatchObject({ ok: false, status: 400 });
    const unknown = await loadPortSummaries(studioHome, "nope");
    expect(unknown).toMatchObject({ ok: false, status: 404 });
  });

  it("reads each port's file from the project's working tree", async () => {
    const studioHome = tmpDir("patchbay-ports-");
    const projectPath = tmpDir("patchbay-ports-project-");
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectPath });
    await writeOverlayIfAbsent(studioHome, "demo");
    await writeInferred(studioHome, "demo", SAMPLE);

    fs.writeFileSync(path.join(projectPath, "README.md"), "# demo\n\n한 줄 설명입니다.\n");
    fs.mkdirSync(path.join(projectPath, "skills", "one"), { recursive: true });
    fs.writeFileSync(
      path.join(projectPath, "skills/one/SKILL.md"),
      "---\ndescription: 스킬이 하는 일\n---\n\n# one\n",
    );

    const result = await loadPortSummaries(studioHome, "demo");
    if (!result.ok) throw new Error("expected ok");
    expect(result.body.ports["source:README.md"]).toEqual({
      path: "README.md",
      summary: "한 줄 설명입니다.",
    });
    expect(result.body.ports["skill:skills/one/SKILL.md"]).toEqual({
      path: "skills/one/SKILL.md",
      summary: "스킬이 하는 일",
    });
  });

  it("a port whose file is gone has no path, so the UI cannot offer to open it", async () => {
    const studioHome = tmpDir("patchbay-ports-");
    const projectPath = tmpDir("patchbay-ports-project-");
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectPath });
    await writeOverlayIfAbsent(studioHome, "demo");
    await writeInferred(studioHome, "demo", SAMPLE);

    const result = await loadPortSummaries(studioHome, "demo");
    if (!result.ok) throw new Error("expected ok");
    expect(result.body.ports["source:README.md"]).toEqual({ path: null, summary: "" });
  });

  it("an unscanned project returns no ports rather than an error", async () => {
    const studioHome = tmpDir("patchbay-ports-");
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: tmpDir("p-") });
    const result = await loadPortSummaries(studioHome, "demo");
    expect(result).toMatchObject({ ok: true, body: { ports: {} } });
  });
});

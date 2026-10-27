import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exportProjectRules, listProjectRules, listProjectSkills, pickedRules, readProjectRule, readProjectSkill, rulesPrompt, writeProjectRule, writeProjectSkill } from "./projectRules.js";

describe("프로젝트 규칙 · 스킬", () => {
  it("규칙을 프로젝트마다 저장하고 항상 · 요청 규칙을 가른다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-rules-"));
    await writeProjectRule(home, "demo", { name: "tone", description: "짧게 답한다", apply: "always", body: "# 말투\n\n세 문장 이내." });
    await writeProjectRule(home, "demo", { name: "deck", description: "덱 만들 때", apply: "request", body: "덱은 끝난 뒤에 만든다." });
    expect((await listProjectRules(home, "demo")).map(rule => [rule.name, rule.apply])).toEqual([["deck", "request"], ["tone", "always"]]);
    expect(await readProjectRule(home, "demo", "tone")).toMatchObject({ description: "짧게 답한다", body: "# 말투\n\n세 문장 이내." });
    expect(fs.existsSync(path.join(home, "projects", "demo", "rules", "tone.md"))).toBe(true);
    expect(await listProjectRules(home, "other")).toEqual([]);
    await expect(readProjectRule(home, "demo", "none")).rejects.toMatchObject({ status: 404 });
    await expect(writeProjectRule(home, "demo", { name: "../x", description: "", apply: "always", body: "x" })).rejects.toMatchObject({ status: 400 });
  });

  it("프로젝트 스킬이 같은 이름의 공용 스킬보다 앞선다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-skills-"));
    for (const name of ["shared", "same"]) {
      fs.mkdirSync(path.join(home, "skills", name), { recursive: true });
      fs.writeFileSync(path.join(home, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: 공용 ${name}\n---\n\n본문`);
    }
    await writeProjectSkill(home, "demo", { name: "same", description: "프로젝트 것", body: "프로젝트 본문" });
    expect((await listProjectSkills(home, "demo")).map(skill => [skill.name, skill.scope, skill.description])).toEqual([["same", "project", "프로젝트 것"], ["shared", "studio", "공용 shared"]]);
    expect((await readProjectSkill(home, "demo", "same")).text).toContain("프로젝트 본문");
  });

  it("프롬프트에는 항상 규칙 본문과 나머지 목록만 들어간다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-rules-prompt-"));
    await writeProjectRule(home, "demo", { name: "tone", description: "짧게", apply: "always", body: "세 문장 이내." });
    await writeProjectRule(home, "demo", { name: "deck", description: "덱 만들 때", apply: "request", body: "숨은 본문" });
    await writeProjectSkill(home, "demo", { name: "review", description: "검토 절차", body: "스킬 본문" });
    const prompt = rulesPrompt(await listProjectRules(home, "demo"), await listProjectSkills(home, "demo"));
    expect(prompt).toContain("세 문장 이내.");
    expect(prompt).toContain("규칙 deck: 덱 만들 때");
    expect(prompt).toContain("스킬 review: 검토 절차");
    expect(prompt).not.toContain("숨은 본문");
    expect(rulesPrompt([], [])).toBe("");
    const rules = await listProjectRules(home, "demo"); const skills = await listProjectSkills(home, "demo");
    const asked = rulesPrompt(rules, skills, await pickedRules(rules, skills, "deck 규칙이랑 review 스킬 써줘"));
    expect(asked).toContain("숨은 본문");
    expect(asked).toContain("스킬 본문");
  });
});

describe("규칙 내보내기", () => {
  it("원할 때만 Cursor 파일 · CLAUDE.md 칸을 만들고 칸 밖 글은 그대로 둔다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-rules-export-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pb-rules-repo-"));
    await writeProjectRule(home, "demo", { name: "tone", description: "짧게", apply: "always", body: "세 문장 이내." });
    await writeProjectRule(home, "demo", { name: "deck", description: "덱", apply: "request", body: "끝난 뒤." });
    await exportProjectRules(home, "demo", repo, "cursor");
    expect(fs.readFileSync(path.join(repo, ".cursor", "rules", "tone.mdc"), "utf8")).toContain("alwaysApply: true");
    expect(fs.readFileSync(path.join(repo, ".cursor", "rules", "deck.mdc"), "utf8")).toContain("alwaysApply: false");
    fs.writeFileSync(path.join(repo, "CLAUDE.md"), "# 내 글\n");
    await exportProjectRules(home, "demo", repo, "claude");
    await exportProjectRules(home, "demo", repo, "claude");
    const claude = fs.readFileSync(path.join(repo, "CLAUDE.md"), "utf8");
    expect(claude.startsWith("# 내 글\n")).toBe(true);
    expect(claude.match(/patchbay:rules —/g)).toHaveLength(1);
    expect(claude).toContain(`@${path.join(home, "projects", "demo", "rules", "tone.md")}`);
    expect(claude).not.toContain("deck.md");
    await exportProjectRules(home, "demo", home, "claude");
    expect(fs.readFileSync(path.join(home, "CLAUDE.md"), "utf8")).toContain("\n@projects/demo/rules/tone.md\n");
  });
});

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { projectStudioDir } from "./studioStore.js";

/**
 * 프로젝트 규칙 · 스킬 (사용자 결정 2026-10-27).
 * 사용자가 정한 규칙과 스킬을 Patchbay 작업 공간에 프로젝트마다 둔다. 특정 도구(Cursor · Claude Code)의 파일에 묶지 않는다.
 * - 규칙: `projects/<alias>/rules/<이름>.md` — 머리말 `description` · `apply`(always | request)
 * - 스킬: `projects/<alias>/skills/<이름>/SKILL.md` — 머리말 `name` · `description`. 작업 공간 공용 `skills/`도 같이 보인다.
 * 대화방은 `always` 규칙 본문과 나머지의 목록을 프롬프트에 넣고, 요청이 오면 LLM이 그 파일을 읽는다.
 */

export type RuleApply = "always" | "request";
export interface ProjectRule { name: string; description: string; apply: RuleApply; body: string; file: string }
export interface ProjectSkill { name: string; description: string; scope: "project" | "studio"; file: string }

const NAME = /^[a-z0-9가-힣][a-z0-9가-힣._-]{0,63}$/;

export class ProjectRuleError extends Error { constructor(message: string, public status: 400 | 404 = 400) { super(message); } }

export function projectRulesDir(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), "rules");
}

export function projectSkillsDir(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), "skills");
}

function checkName(name: string): string {
  if (!NAME.test(name) || name.endsWith(".proposed")) throw new ProjectRuleError("이름은 한글 · 영문 소문자 · 숫자 · . _ - 로 64자 이하.");
  return name;
}

function splitFrontmatter(text: string): { head: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { head: {}, body: text.trim() };
  const head = parseYaml(match[1]!) as unknown;
  return { head: head && typeof head === "object" ? head as Record<string, unknown> : {}, body: text.slice(match[0].length).trim() };
}

function ruleFrom(name: string, file: string, text: string): ProjectRule {
  const { head, body } = splitFrontmatter(text);
  return {
    name,
    description: typeof head.description === "string" ? head.description.trim() : "",
    apply: head.apply === "always" ? "always" : "request",
    body,
    file,
  };
}

async function writeAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, text, "utf8");
  await fs.rename(temporary, file);
}

async function names(dir: string): Promise<string[]> {
  try { return (await fs.readdir(dir)).sort(); } catch { return []; }
}

export async function listProjectRules(studioHome: string, alias: string): Promise<ProjectRule[]> {
  const dir = projectRulesDir(studioHome, alias);
  const rules: ProjectRule[] = [];
  for (const entry of await names(dir)) {
    const name = entry.replace(/\.md$/, "");
    if (!entry.endsWith(".md") || !NAME.test(name)) continue;
    const file = path.join(dir, entry);
    rules.push(ruleFrom(name, file, await fs.readFile(file, "utf8")));
  }
  return rules;
}

export async function readProjectRule(studioHome: string, alias: string, name: string): Promise<ProjectRule> {
  const file = path.join(projectRulesDir(studioHome, alias), `${checkName(name)}.md`);
  try { return ruleFrom(name, file, await fs.readFile(file, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ProjectRuleError(`규칙 ${name} 이 없다.`, 404);
    throw error;
  }
}

export async function writeProjectRule(studioHome: string, alias: string, rule: { name: string; description: string; apply: RuleApply; body: string }): Promise<ProjectRule> {
  const file = path.join(projectRulesDir(studioHome, alias), `${checkName(rule.name)}.md`);
  if (!rule.body.trim()) throw new ProjectRuleError("규칙 본문이 비어 있다.");
  const text = `---\n${stringifyYaml({ description: rule.description.trim(), apply: rule.apply }).trim()}\n---\n\n${rule.body.trim()}\n`;
  await writeAtomic(file, text);
  return ruleFrom(rule.name, file, text);
}

async function skillsIn(dir: string, scope: ProjectSkill["scope"]): Promise<ProjectSkill[]> {
  const skills: ProjectSkill[] = [];
  for (const name of await names(dir)) {
    if (!NAME.test(name) || name.endsWith(".proposed")) continue;
    const file = path.join(dir, name, "SKILL.md");
    let text: string;
    try { text = await fs.readFile(file, "utf8"); } catch { continue; }
    const { head } = splitFrontmatter(text);
    skills.push({ name, description: typeof head.description === "string" ? head.description.trim() : "", scope, file });
  }
  return skills;
}

/** 프로젝트 스킬과 작업 공간 공용 스킬. 이름이 같으면 프로젝트 것이 이긴다. */
export async function listProjectSkills(studioHome: string, alias: string): Promise<ProjectSkill[]> {
  const own = await skillsIn(projectSkillsDir(studioHome, alias), "project");
  const shared = (await skillsIn(path.join(studioHome, "skills"), "studio")).filter(skill => !own.some(row => row.name === skill.name));
  return [...own, ...shared];
}

export async function readProjectSkill(studioHome: string, alias: string, name: string): Promise<ProjectSkill & { text: string }> {
  checkName(name);
  const skill = (await listProjectSkills(studioHome, alias)).find(row => row.name === name);
  if (!skill) throw new ProjectRuleError(`스킬 ${name} 이 없다.`, 404);
  return { ...skill, text: await fs.readFile(skill.file, "utf8") };
}

export async function writeProjectSkill(studioHome: string, alias: string, skill: { name: string; description: string; body: string }): Promise<ProjectSkill> {
  const file = path.join(projectSkillsDir(studioHome, alias), checkName(skill.name), "SKILL.md");
  if (!skill.body.trim()) throw new ProjectRuleError("스킬 본문이 비어 있다.");
  await writeAtomic(file, `---\n${stringifyYaml({ name: skill.name, description: skill.description.trim() }).trim()}\n---\n\n${skill.body.trim()}\n`);
  return { name: skill.name, description: skill.description.trim(), scope: "project", file };
}

/** 사람 말에 이름이 나온 요청 규칙 · 스킬 — 파일을 못 읽는 LLM에도 본문을 넘긴다. */
export async function pickedRules(rules: readonly ProjectRule[], skills: readonly ProjectSkill[], text: string): Promise<{ kind: "규칙" | "스킬"; name: string; body: string }[]> {
  const said = text.toLowerCase();
  const picked: { kind: "규칙" | "스킬"; name: string; body: string }[] = [];
  for (const rule of rules) if (rule.apply === "request" && said.includes(rule.name)) picked.push({ kind: "규칙", name: rule.name, body: rule.body });
  for (const skill of skills) if (said.includes(skill.name)) picked.push({ kind: "스킬", name: skill.name, body: splitFrontmatter(await fs.readFile(skill.file, "utf8")).body });
  return picked;
}

/** 대화 프롬프트에 붙이는 규칙 · 스킬 칸. 항상 규칙은 본문을, 나머지는 이름 · 설명 · 파일만 준다. 이번 말에 나온 것은 본문도 준다. */
export function rulesPrompt(rules: readonly ProjectRule[], skills: readonly ProjectSkill[], picked: readonly { kind: "규칙" | "스킬"; name: string; body: string }[] = []): string {
  const always = rules.filter(rule => rule.apply === "always");
  const request = rules.filter(rule => rule.apply === "request");
  if (!always.length && !request.length && !skills.length) return "";
  const lines = ["", "## 이 프로젝트의 규칙 · 스킬 (Patchbay)"];
  if (always.length) {
    lines.push("아래 규칙은 늘 지킨다.");
    for (const rule of always) lines.push("", `### 규칙 ${rule.name}${rule.description ? ` — ${rule.description}` : ""}`, rule.body);
  }
  if (request.length || skills.length) {
    lines.push("", "아래는 사용자가 이름을 대며 쓰라고 하거나 일에 맞을 때만 쓴다. 쓸 때는 그 파일을 읽고 따른다.");
    for (const rule of request) lines.push(`- 규칙 ${rule.name}: ${rule.description || "설명 없음"} (${rule.file})`);
    for (const skill of skills) lines.push(`- 스킬 ${skill.name}: ${skill.description || "설명 없음"} (${skill.file})`);
  }
  if (picked.length) {
    lines.push("", "사용자가 이번에 이름을 댄 것 — 이번 답에 쓴다.");
    for (const row of picked) lines.push("", `### ${row.kind} ${row.name}`, row.body);
  }
  return lines.join("\n");
}

const CLAUDE_START = "<!-- patchbay:rules — `patchbay rule export --target claude`가 고친다. 원본은 Patchbay 작업 공간 -->";
const CLAUDE_END = "<!-- /patchbay:rules -->";

/**
 * 「내보내기」 — 원본은 그대로 두고, 사용자가 원할 때만 도구의 파일을 만든다.
 * - cursor: `<레포>/.cursor/rules/<이름>.mdc` (규칙마다 한 파일, 같은 이름이면 덮는다)
 * - claude: `<레포>/CLAUDE.md` 안 표시 사이 칸 — 늘 지킬 규칙을 원본 경로로 포함(@)한다. 칸 밖 글은 건드리지 않는다.
 */
export async function exportProjectRules(studioHome: string, alias: string, repoPath: string, target: "cursor" | "claude"): Promise<string[]> {
  const rules = await listProjectRules(studioHome, alias);
  if (target === "cursor") {
    const dir = path.join(repoPath, ".cursor", "rules");
    const written: string[] = [];
    for (const rule of rules) {
      const file = path.join(dir, `${rule.name}.mdc`);
      await fs.rm(file, { force: true });
      await writeAtomic(file, `---\n${stringifyYaml({ description: rule.description, alwaysApply: rule.apply === "always" }).trim()}\n---\n\n${rule.body}\n`);
      written.push(file);
    }
    return written;
  }
  const file = path.join(repoPath, "CLAUDE.md");
  let text = "";
  try { text = await fs.readFile(file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  // 원본이 레포 안에 있으면 레포 기준 상대 경로로 — 레포에 내 컴퓨터 경로를 남기지 않는다.
  const at = (file: string) => { const rel = path.relative(repoPath, file); return rel.startsWith("..") || path.isAbsolute(rel) ? file : rel; };
  const block = [CLAUDE_START, ...rules.filter(rule => rule.apply === "always").map(rule => `@${at(rule.file)}`), CLAUDE_END].join("\n");
  const start = text.indexOf(CLAUDE_START);
  const end = text.indexOf(CLAUDE_END);
  const next = start >= 0 && end > start
    ? `${text.slice(0, start)}${block}${text.slice(end + CLAUDE_END.length)}`
    : `${text.trimEnd()}${text.trim() ? "\n\n" : ""}${block}\n`;
  await writeAtomic(file, next);
  return [file];
}

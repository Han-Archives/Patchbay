import fs from "node:fs/promises";
import { exportProjectRules, listProjectRules, listProjectSkills, readProjectRule, readProjectSkill, readStudio, resolveStudioHome, writeProjectRule, writeProjectSkill } from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface RuleCommandOptions {
  project?: string; name?: string; description?: string; body?: string; file?: string;
  skill?: boolean; always?: boolean; target?: string; json?: boolean;
}

/** 프로젝트 규칙 · 스킬 (사용자 결정 2026-10-27). 원본은 작업 공간 `projects/<alias>/rules` · `skills`. */
export async function runRule(action: "list" | "show" | "save" | "export", options: RuleCommandOptions, home = resolveStudioHome()): Promise<number> {
  const json = Boolean(options.json);
  try {
    const project = (await readStudio(home)).projects.find(p => p.alias === options.project);
    if (!project) throw new Error("등록된 --project가 필요합니다.");
    const alias = project.alias;
    if (action === "list") {
      const rules = await listProjectRules(home, alias);
      const skills = await listProjectSkills(home, alias);
      printResult(json, { ok: true, rules: rules.map(({ body: _body, ...row }) => row), skills }, [
        ...rules.map(rule => `규칙 ${rule.name} [${rule.apply === "always" ? "항상" : "요청"}] ${rule.description}`),
        ...skills.map(skill => `스킬 ${skill.name} [${skill.scope === "project" ? "프로젝트" : "공용"}] ${skill.description}`),
      ]);
      return 0;
    }
    if (!options.name && action !== "export") throw new Error("--name이 필요합니다.");
    if (action === "show") {
      const rule = options.skill ? null : await readProjectRule(home, alias, options.name!).catch(() => null);
      const shown = rule ? { kind: "rule", ...rule } : { kind: "skill", ...(await readProjectSkill(home, alias, options.name!)) };
      printResult(json, { ok: true, ...shown }, [rule ? rule.body : (shown as { text: string }).text]);
      return 0;
    }
    if (action === "save") {
      const body = options.file ? await fs.readFile(options.file, "utf8") : options.body ?? "";
      const saved = options.skill
        ? await writeProjectSkill(home, alias, { name: options.name!, description: options.description ?? "", body })
        : await writeProjectRule(home, alias, { name: options.name!, description: options.description ?? "", body, apply: options.always ? "always" : "request" });
      printResult(json, { ok: true, name: saved.name, file: saved.file }, [`저장: ${saved.file}`]);
      return 0;
    }
    if (options.target !== "cursor" && options.target !== "claude") throw new Error("--target은 cursor 또는 claude입니다.");
    const written = await exportProjectRules(home, alias, project.path, options.target);
    printResult(json, { ok: true, written }, written.map(file => `내보냄: ${file}`));
    return 0;
  } catch (error) {
    printError(json, (error as Error).message);
    return 1;
  }
}

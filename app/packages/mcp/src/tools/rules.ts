import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listProjectRules, listProjectSkills, readProjectRule, readProjectSkill, writeProjectRule, writeProjectSkill } from "@patchbay/core";
import { z } from "zod";
import { jsonResult } from "./result.js";
import { resolveRegisteredProject } from "./shared.js";

/**
 * 프로젝트 규칙 · 스킬 (사용자 결정 2026-10-27) — 대화방과 같은 커널 함수.
 * 도구(Cursor · Claude Code)의 파일 대신 Patchbay 작업 공간의 `projects/<alias>/rules` · `skills`를 원본으로 쓴다.
 */
export function registerRuleTools(server: McpServer, studioHome: string): void {
  server.registerTool(
    "get_rules",
    {
      title: "Read project rules and skills",
      description: "그 프로젝트에서 사용자가 정한 규칙 · 스킬을 읽는다. name 없이 부르면 늘 지킬 규칙(apply=always)은 본문까지, 나머지 규칙 · 스킬은 이름 · 설명만 준다. 작업을 시작할 때 한 번 부르고 always 규칙을 따른다. 사용자가 이름을 대며 쓰라고 하면 name 으로 다시 불러 본문을 읽고 따른다.",
      inputSchema: { alias: z.string().describe("Registered project alias."), name: z.string().optional().describe("이 규칙 또는 스킬 하나의 본문.") },
      annotations: { readOnlyHint: true },
    },
    async ({ alias, name }) => {
      const { registered } = await resolveRegisteredProject(studioHome, alias);
      if (name) {
        const rule = await readProjectRule(studioHome, registered.alias, name).catch(() => null);
        if (rule) return jsonResult({ ok: true, project: registered.alias, kind: "rule", ...rule });
        return jsonResult({ ok: true, project: registered.alias, kind: "skill", ...(await readProjectSkill(studioHome, registered.alias, name)) });
      }
      const rules = await listProjectRules(studioHome, registered.alias);
      const skills = await listProjectSkills(studioHome, registered.alias);
      return jsonResult({
        ok: true,
        project: registered.alias,
        always: rules.filter(rule => rule.apply === "always").map(({ name: n, description, body }) => ({ name: n, description, body })),
        onRequest: rules.filter(rule => rule.apply === "request").map(({ name: n, description }) => ({ name: n, description })),
        skills: skills.map(({ name: n, description, scope }) => ({ name: n, description, scope })),
      });
    },
  );

  server.registerTool(
    "save_rule",
    {
      title: "Save a project rule or skill",
      description: "사용자가 정한 규칙이나 스킬을 그 프로젝트에 저장한다(같은 이름이면 고친다). 사용자가 저장하라고 한 내용만 쓴다. kind=rule 이면 apply 로 늘 지킬지(always) · 요청할 때만 쓸지(request) 정한다.",
      inputSchema: {
        alias: z.string().describe("Registered project alias."),
        kind: z.enum(["rule", "skill"]),
        name: z.string().describe("한글 · 영문 소문자 · 숫자 · . _ - 로 64자 이하."),
        description: z.string().describe("한 줄 설명 — 목록에 보인다."),
        body: z.string().describe("본문 (Markdown)."),
        apply: z.enum(["always", "request"]).optional().describe("규칙만. 기본 request."),
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async ({ alias, kind, name, description, body, apply }) => {
      const { registered } = await resolveRegisteredProject(studioHome, alias);
      const saved = kind === "rule"
        ? await writeProjectRule(studioHome, registered.alias, { name, description, body, apply: apply ?? "request" })
        : await writeProjectSkill(studioHome, registered.alias, { name, description, body });
      return jsonResult({ ok: true, project: registered.alias, kind, name: saved.name, file: saved.file });
    },
  );
}

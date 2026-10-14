import { parsePortId } from "../types/portId.js";
import type { Wire } from "../types/project.js";
import { appendWire, installSkillIntoProject, skillBayDir, skillPackageExists } from "./projectFiles.js";
import { readStudio } from "./studioStore.js";

export type PatchSkillResult =
  | { ok: true; install: Wire["install"]; wire: Wire }
  | { ok: false; reason: "bad-slug" | "no-skill" | "no-project"; error: string };

/**
 * Installs a Skill Bay skill into a registered project and records the Wire
 * (spec Phase 5). `patchbay patch` and the 배치도's 「프로젝트에 설치」 both
 * end here, so the checks and the one write order can't drift apart.
 *
 * All validation happens before any filesystem mutation: an invalid slug, a
 * missing Bay package, or an unregistered alias return `ok: false` with
 * nothing written. Records a Wire only, never a Patch -- a Wire without a
 * Patch shows up under 「선언 없는 실제 연결」, which is expected.
 */
export async function patchSkill(studioHome: string, skillSlug: string, projectAlias: string): Promise<PatchSkillResult> {
  const from = parsePortId(`skill:${skillSlug}`);
  if (!from.success) {
    return {
      ok: false,
      reason: "bad-slug",
      error: `"${skillSlug}" is not a valid Skill Bay slug: ${from.error.issues[0]?.message ?? "invalid PortId"}`,
    };
  }

  if (!(await skillPackageExists(studioHome, skillSlug))) {
    return {
      ok: false,
      reason: "no-skill",
      error:
        `no skill "${skillSlug}" found in the studio Skill Bay ` +
        `(expected ${skillBayDir(studioHome, skillSlug)}/SKILL.md to exist).`,
    };
  }

  const studio = await readStudio(studioHome);
  const registered = studio.projects.find((project) => project.alias === projectAlias);
  if (!registered) {
    const known = studio.projects.map((project) => project.alias);
    return {
      ok: false,
      reason: "no-project",
      error:
        `no project registered with alias "${projectAlias}". ` +
        (known.length > 0
          ? `Registered aliases: ${known.join(", ")}.`
          : `No projects are registered yet -- run "patchbay project add --path <path>" first.`),
    };
  }

  // A slug that passed the check above always yields a valid installed path.
  const to = parsePortId(`skill:skills/${skillSlug}/SKILL.md`);
  if (!to.success) {
    return { ok: false, reason: "bad-slug", error: `failed to build a valid installed-skill PortId for "${skillSlug}".` };
  }

  const install = await installSkillIntoProject(skillBayDir(studioHome, skillSlug), registered.path, skillSlug);
  const wire: Wire = { project: projectAlias, from: from.data, to: to.data, kind: "uses", install };
  await appendWire(studioHome, projectAlias, wire);
  return { ok: true, install, wire };
}

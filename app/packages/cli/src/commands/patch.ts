import { parsePortId, patchSkill, resolveStudioHome } from "@patchbay/core";
import { seedStudioBay } from "../bundledSkills.js";
import { printError, printResult } from "../output.js";

export interface PatchCommandOptions {
  json?: boolean;
}

/**
 * `patchbay patch <skill> <project> [--json]` -- installs a skill into a
 * project and records the resulting Wire (spec Phase 5). The checks, the
 * install and the Wire live in Core `patchSkill`, shared with the 배치도's
 * 「프로젝트에 설치」; this command only seeds the bundled skills first.
 *
 * `<skill>` is a bare studio Skill Bay slug (no `skill:` prefix). `<project>`
 * is a registered alias, required explicitly -- this command mutates state,
 * so it never defaults to the sole registered project. Nothing is written
 * unless every check passes.
 */
export async function runPatch(
  skillSlug: string,
  projectAlias: string,
  options: PatchCommandOptions,
  studioHome: string = resolveStudioHome(),
): Promise<number> {
  const json = Boolean(options.json);

  // A bad slug stops before seeding writes anything into the studio.
  const slugCheck = parsePortId(`skill:${skillSlug}`);
  if (!slugCheck.success) {
    printError(
      json,
      `patch: "${skillSlug}" is not a valid Skill Bay slug: ${slugCheck.error.issues[0]?.message ?? "invalid PortId"}`,
    );
    return 1;
  }

  await seedStudioBay(studioHome);
  const result = await patchSkill(studioHome, skillSlug, projectAlias);
  if (!result.ok) {
    printError(json, `patch: ${result.error}`);
    return 1;
  }

  const { wire, install } = result;
  printResult(json, { ok: true, alias: projectAlias, skill: skillSlug, install, wire }, [
    `Installed skill "${skillSlug}" into "${projectAlias}" (${install}).`,
    `Recorded wire: ${wire.from} --[${wire.kind}]--> ${wire.to}`,
  ]);
  return 0;
}

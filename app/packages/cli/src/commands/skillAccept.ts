import { acceptSkillDraft, resolveStudioHome } from "@patchbay/core";
import { seedStudioBay } from "../bundledSkills.js";
import { printError, printResult } from "../output.js";

export interface SkillAcceptOptions {
  json?: boolean;
}

/**
 * `patchbay skill accept <slug>` -- human confirmation. Moves
 * `skills/<slug>.proposed` to `skills/<slug>`. Refuses to overwrite a
 * confirmed package.
 */
export async function runSkillAccept(
  slug: string,
  options: SkillAcceptOptions,
  studioHome: string = resolveStudioHome(),
): Promise<number> {
  const json = Boolean(options.json);
  await seedStudioBay(studioHome);
  const result = await acceptSkillDraft(studioHome, slug);
  if (!result.ok) {
    printError(json, result.message);
    return 1;
  }
  printResult(json, { ok: true, slug: result.slug, path: result.path }, [
    `Confirmed skill "${result.slug}" in the Skill Bay.`,
    result.path,
    `Install with: patchbay patch ${result.slug} <project>`,
  ]);
  return 0;
}

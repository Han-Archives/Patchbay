import { resolveStudioHome, writeSkillDraft } from "@patchbay/core";
import { seedStudioBay } from "../bundledSkills.js";
import { printError, printResult } from "../output.js";

export interface SkillDistillOptions {
  project?: string;
  slug?: string;
  json?: boolean;
}

/**
 * `patchbay skill distill --project <alias> [--slug <slug>]`
 * Writes `skills/<slug>.proposed/SKILL.md` from board.yaml. Does not run
 * the skill and does not overwrite a confirmed Bay package.
 */
export async function runSkillDistill(
  options: SkillDistillOptions,
  studioHome: string = resolveStudioHome(),
): Promise<number> {
  const json = Boolean(options.json);
  await seedStudioBay(studioHome);

  if (!options.project) {
    printError(json, "skill distill: --project <alias> is required.");
    return 1;
  }

  const result = await writeSkillDraft(studioHome, options.project, { slug: options.slug });
  if (!result.ok) {
    printError(json, result.message);
    return 1;
  }

  printResult(
    json,
    { ok: true, alias: result.alias, slug: result.slug, path: result.path, overwritten: result.overwritten },
    [
      `Wrote skill draft "${result.slug}" for "${result.alias}".`,
      result.path,
      `This does not run the skill. Confirm with: patchbay skill accept ${result.slug}`,
      `Then install with: patchbay patch ${result.slug} ${result.alias}`,
    ],
  );
  return 0;
}

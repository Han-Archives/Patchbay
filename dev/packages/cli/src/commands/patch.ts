import {
  appendWire,
  installSkillIntoProject,
  parsePortId,
  readStudio,
  resolveStudioHome,
  skillBayDir,
  skillPackageExists,
  type Wire,
} from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface PatchCommandOptions {
  json?: boolean;
}

/**
 * `patchbay patch <skill> <project> [--json]` -- the only command that
 * actually installs a skill into a project and records the resulting Wire
 * (spec Phase 5). Patch (intent) authoring is out of scope here -- this
 * command records a Wire only, never a Patch. A matching Patch does not
 * need to exist; the recorded Wire will normally surface under Atlas's
 * "Wires without a patch" Gaps section, which is expected, not an error.
 *
 * `<skill>` is a bare studio Skill Bay slug (no `skill:` prefix -- this
 * command builds that PortId internally). `<project>` is a registered
 * alias, required explicitly (unlike `scan`/`atlas`, this command mutates
 * state, so it never defaults to the sole registered project).
 *
 * All validation happens before any filesystem mutation: an invalid slug,
 * a missing Bay package, or an unregistered alias all exit 1 with nothing
 * written. Only after every check passes does this install the skill
 * (symlink, falling back to a recursive copy on failure -- see
 * `installSkillIntoProject`) and append the Wire to `overlay.yaml`.
 */
export async function runPatch(
  skillSlug: string,
  projectAlias: string,
  options: PatchCommandOptions,
  studioHome: string = resolveStudioHome(),
): Promise<number> {
  const json = Boolean(options.json);

  const fromResult = parsePortId(`skill:${skillSlug}`);
  if (!fromResult.success) {
    printError(
      json,
      `patch: "${skillSlug}" is not a valid Skill Bay slug: ${fromResult.error.issues[0]?.message ?? "invalid PortId"}`,
    );
    return 1;
  }

  const exists = await skillPackageExists(studioHome, skillSlug);
  if (!exists) {
    printError(
      json,
      `patch: no skill "${skillSlug}" found in the studio Skill Bay ` +
        `(expected ${skillBayDir(studioHome, skillSlug)}/SKILL.md to exist).`,
    );
    return 1;
  }

  const studio = await readStudio(studioHome);
  const registered = studio.projects.find((project) => project.alias === projectAlias);
  if (!registered) {
    const knownAliases = studio.projects.map((project) => project.alias);
    printError(
      json,
      `patch: no project registered with alias "${projectAlias}". ` +
        (knownAliases.length > 0
          ? `Registered aliases: ${knownAliases.join(", ")}.`
          : `No projects are registered yet -- run "patchbay project add --path <path>" first.`),
    );
    return 1;
  }

  const toRaw = `skill:skills/${skillSlug}/SKILL.md`;
  const toResult = parsePortId(toRaw);
  if (!toResult.success) {
    // Unreachable given a slug that already passed the fromResult check
    // above, but never silently proceed with an invalid PortId.
    printError(json, `patch: failed to build a valid installed-skill PortId from "${toRaw}".`);
    return 1;
  }

  const installMethod = await installSkillIntoProject(skillBayDir(studioHome, skillSlug), registered.path, skillSlug);

  const wire: Wire = {
    project: projectAlias,
    from: fromResult.data,
    to: toResult.data,
    kind: "uses",
    install: installMethod,
  };
  await appendWire(studioHome, projectAlias, wire);

  printResult(json, { ok: true, alias: projectAlias, skill: skillSlug, install: installMethod, wire }, [
    `Installed skill "${skillSlug}" into "${projectAlias}" (${installMethod}).`,
    `Recorded wire: ${wire.from} --[${wire.kind}]--> ${wire.to}`,
  ]);
  return 0;
}

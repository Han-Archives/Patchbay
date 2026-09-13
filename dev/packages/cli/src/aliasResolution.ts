import type { Studio } from "@patchbay/core";

export type AliasResolution = { ok: true; alias: string } | { ok: false; message: string };

/**
 * Resolves which registered project alias a command (`scan`, `atlas`)
 * should act on: the explicit `--project` flag if given, else the single
 * registered project if there's exactly one, else an error asking the
 * caller to disambiguate.
 */
export function resolveProjectAlias(studio: Studio, explicitAlias: string | undefined): AliasResolution {
  const knownAliases = studio.projects.map((project) => project.alias);

  if (explicitAlias) {
    if (!knownAliases.includes(explicitAlias)) {
      return {
        ok: false,
        message:
          `No project registered with alias "${explicitAlias}". ` +
          (knownAliases.length > 0
            ? `Registered aliases: ${knownAliases.join(", ")}.`
            : `No projects are registered yet -- run "patchbay project add --path <path>" first.`),
      };
    }
    return { ok: true, alias: explicitAlias };
  }

  if (studio.projects.length === 1) {
    return { ok: true, alias: studio.projects[0]!.alias };
  }

  if (studio.projects.length === 0) {
    return {
      ok: false,
      message: `No projects are registered yet -- run "patchbay project add --path <path>" first.`,
    };
  }

  return {
    ok: false,
    message: `Multiple projects are registered -- specify --project <alias>. Registered aliases: ${knownAliases.join(", ")}.`,
  };
}

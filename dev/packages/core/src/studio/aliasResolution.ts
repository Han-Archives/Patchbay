import type { Studio } from "../types/studio.js";

export type AliasResolution = { ok: true; alias: string } | { ok: false; message: string };

/**
 * Resolves which registered project alias a command (`scan`, `atlas`, and
 * the MCP tools in `@patchbay/mcp`) should act on: the explicit `--project`
 * flag/`alias` argument if given, else the single registered project if
 * there's exactly one, else an error asking the caller to disambiguate.
 *
 * Lives in Core (moved here from the CLI in Phase 6) because both the CLI
 * and the MCP server need the exact same "alias omitted -> sole registered
 * project, else a clear error" logic -- per the project's core architecture
 * rule, MCP and CLI both go through Core rather than either one
 * reimplementing the other's logic.
 */
export function resolveProjectAlias(studio: Studio, explicitAlias?: string): AliasResolution {
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

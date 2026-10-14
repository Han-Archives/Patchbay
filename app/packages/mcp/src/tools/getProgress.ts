import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  readProgress,
  readProgressMd,
  readProgressRaw,
  readStudio,
  readStudioProgressRollup,
  renderProgressLevel1,
} from "@patchbay/core";
import { z } from "zod";
import { jsonResult } from "./result.js";
import { resolveLevel, type Level } from "./shared.js";

const inputShape = {
  alias: z
    .string()
    .optional()
    .describe(
      "Registered project alias. Omitted -> the studio-wide progress rollup across every registered " +
        "project -- NOT the sole-registered-project default the other tools use here; `progress` is " +
        "studio-wide by design.",
    ),
  level: z
    .union([z.literal(1), z.literal(2), z.literal(3)])
    .optional()
    .describe(
      "Only applies when alias is given: 1 = one-line current summary (default), 2 = full PROGRESS.md, " +
        "3 = raw progress.yaml. Ignored when alias is omitted (the rollup has no separate layers).",
    ),
};

/**
 * `get_progress` (spec Phase 7): mirrors the CLI's `patchbay progress
 * [--project <alias>] [--level 1|2|3]` (spec 8.4/5.5). Deliberately does NOT
 * use the sole-registered-project default the other three tools use
 * (`resolveRegisteredProject` in `shared.ts`) -- `alias` omitted always
 * means the studio-wide rollup, per the spec's explicit "progress는 원래부터
 * 포트폴리오 전체를 보여주는 명령" note, for the exact same reason the CLI's
 * `runProgress` avoids `resolveProjectAlias`.
 */
export function registerGetProgressTool(server: McpServer, studioHome: string): void {
  server.registerTool(
    "get_progress",
    {
      title: "Get progress",
      description:
        "Returns progress. Omit alias for the studio-wide rollup across every registered project (level is " +
        "ignored in that case). Pass alias for one project's progress: level 1 (default) = one-line current " +
        "summary, 2 = full PROGRESS.md, 3 = raw progress.yaml.",
      inputSchema: inputShape,
    },
    async ({ alias, level }) => {
      if (!alias) {
        let content: string;
        try {
          content = await readStudioProgressRollup(studioHome);
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
            throw new Error(
              `No progress has been recorded yet for any project -- run "patchbay progress write --project <alias> --summary <text>" first.`,
            );
          }
          throw error;
        }
        return jsonResult({ alias: null, level: null, content });
      }

      const studio = await readStudio(studioHome);
      const registered = studio.projects.find((project) => project.alias === alias);
      if (!registered) {
        const knownAliases = studio.projects.map((project) => project.alias);
        throw new Error(
          `No project registered with alias "${alias}". ` +
            (knownAliases.length > 0
              ? `Registered aliases: ${knownAliases.join(", ")}.`
              : `No projects are registered yet -- run "patchbay project add --path <path>" first.`),
        );
      }

      const resolvedLevel: Level = resolveLevel(level, 1);

      let content: string;
      if (resolvedLevel === 1) {
        content = renderProgressLevel1(await readProgress(studioHome, registered.alias));
      } else if (resolvedLevel === 3) {
        content = await readProgressRaw(studioHome, registered.alias);
      } else {
        try {
          content = await readProgressMd(studioHome, registered.alias);
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
            throw new Error(
              `No progress has been recorded yet for "${registered.alias}" -- run "patchbay progress write --project ${registered.alias} --summary <text>" first.`,
            );
          }
          throw error;
        }
      }

      return jsonResult({ alias: registered.alias, level: resolvedLevel, content });
    },
  );
}

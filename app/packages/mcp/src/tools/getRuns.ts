import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  checkBudget,
  compareRunsToDesign,
  draftEvalsFromRuns,
  readOverlay,
  readProposedIrIfValid,
  readRunRecords,
} from "@patchbay/core";
import { z } from "zod";
import { jsonResult } from "./result.js";
import { resolveRegisteredProject } from "./shared.js";

const inputShape = {
  alias: z.string().optional().describe("Registered project alias. Omitted -> the sole registered project."),
  drafts: z
    .boolean()
    .optional()
    .describe("Also return the evaluation cases the failing runs would make. Returns drafts; writes nothing."),
};

/**
 * `get_runs`: 「돌린 것이 설계대로였나」 for a host model.
 *
 * Read-only, like the other read tools — and deliberately so for `drafts`: a
 * model may *propose* evaluation cases, but adding them is a write to
 * `ir.proposed.yaml` that a person triggers (`patchbay runs draft-evals
 * --write`) and reviews before adopting. A tool that wrote the draft itself
 * would put the model inside the gate 명세 §2.3 exists to keep it outside of.
 */
export function registerGetRunsTool(server: McpServer, studioHome: string): void {
  server.registerTool(
    "get_runs",
    {
      title: "Get Run Comparison",
      description:
        "Returns the project's collected run records held against its approved design: how many runs ended in " +
        "each of the four statuses, which nodes ran and which only exist in the design, what the runs did that " +
        "the design never declared (undeclared model, tool, capability or document), and which runs went over " +
        "the cost ceiling. Optionally returns the evaluation cases the failures would make. Read-only; works " +
        "whether or not LangGraph is running.",
      inputSchema: inputShape,
    },
    async ({ alias, drafts }) => {
      const { registered } = await resolveRegisteredProject(studioHome, alias);
      const overlay = await readOverlay(studioHome, registered.alias);
      const { records, rejected } = await readRunRecords(studioHome, registered.alias);

      if (!overlay.ir) {
        return jsonResult({
          alias: registered.alias,
          design: null,
          note: `"${registered.alias}" has no approved design yet, so runs cannot be held against one. Run the 1단계 gate first: patchbay ir adopt --project ${registered.alias}`,
          collected: records.length,
          rejected: rejected.length,
        });
      }

      const compare = compareRunsToDesign(overlay.ir, records);
      const budget = checkBudget(overlay.budget, records);
      return jsonResult({
        alias: registered.alias,
        irVersion: overlay.ir.version,
        collected: records.length,
        byStatus: compare.byStatus,
        skipped: compare.skipped,
        nodes: compare.nodes,
        findings: compare.findings,
        usage: compare.usage,
        budget: {
          limit: budget.budget,
          breaches: budget.breaches,
          costUnknown: budget.costUnknown.length,
        },
        rejected,
        ...(drafts
          ? {
              drafts: draftEvalsFromRuns(overlay.ir, records, {
                draft: await readProposedIrIfValid(studioHome, registered.alias),
              }),
            }
          : {}),
      });
    },
  );
}

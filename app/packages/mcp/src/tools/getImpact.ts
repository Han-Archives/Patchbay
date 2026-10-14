import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  computeImpactRadius,
  computePortDebt,
  IMPACT_MAX_HOPS,
  readOverlay,
  type Overlay,
} from "@patchbay/core";
import { z } from "zod";
import { jsonResult } from "./result.js";
import { readInferredOrThrow, resolveRegisteredProject } from "./shared.js";

const inputShape = {
  alias: z.string().optional().describe("Registered project alias. Omitted -> the sole registered project."),
  port: z
    .string()
    .optional()
    .describe(
      'PortId to walk out from, e.g. "source:docs/notes.md". Omitted -> no radius, only the project\'s port debt.',
    ),
  hops: z
    .number()
    .int()
    .min(1)
    .max(6)
    .optional()
    .describe(`Edge distance to walk. Default ${IMPACT_MAX_HOPS}.`),
};

/**
 * `get_impact`: "what else does changing this touch", plus the project's
 * orphan/hub debt.
 *
 * Reads only `overlay.yaml` + `inferred.json` through Core's
 * `computeImpactRadius`/`computePortDebt`, so the answer is identical to the
 * 지식 tab's and does not need the Neo4j sidecar running -- Neo4j is a
 * replica the rescan rebuilds (기획 원칙 4), never the source of truth this
 * tool reports. Read-only: writes nothing, matching the other five read
 * tools.
 */
export function registerGetImpactTool(server: McpServer, studioHome: string): void {
  server.registerTool(
    "get_impact",
    {
      title: "Get Impact Radius",
      description:
        "Given a PortId, returns the ports within N hops of it in the project's patch/wire graph, " +
        "grouped by hop distance -- the blast radius of editing that file. Also returns port debt " +
        "(orphans: discovered ports nothing references; hubs: ports many things depend on). " +
        "Works whether or not Neo4j is running.",
      inputSchema: inputShape,
    },
    async ({ alias, port, hops }) => {
      const { registered } = await resolveRegisteredProject(studioHome, alias);
      const inferred = await readInferredOrThrow(studioHome, registered.alias);
      const overlay: Overlay = await readOverlay(studioHome, registered.alias);

      const debt = computePortDebt(inferred, overlay);
      const payload: Record<string, unknown> = {
        alias: registered.alias,
        debt: {
          orphanCount: debt.orphans.length,
          orphans: debt.orphans,
          hubs: debt.hubs,
        },
      };

      if (port) {
        const radius = computeImpactRadius(overlay, port, hops ?? IMPACT_MAX_HOPS);
        payload.impact = {
          origin: radius.origin,
          maxHops: radius.maxHops,
          total: radius.total,
          known: radius.total > 0 || inferred.discoveredPorts.includes(radius.origin),
          hops: radius.hops.map((ring, index) => ({
            hop: index + 1,
            count: ring.length,
            ports: ring.map((hit) => ({ port: hit.port, via: hit.via, kind: hit.kind })),
          })),
        };
      }

      return jsonResult(payload);
    },
  );
}

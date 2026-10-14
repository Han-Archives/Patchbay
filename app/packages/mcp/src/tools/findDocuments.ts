import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readKnowledgeReplica, retrieveDocuments, RETRIEVE_HOP_CHOICES } from "@patchbay/core";
import { z } from "zod";
import { jsonResult } from "./result.js";
import { resolveRegisteredProject } from "./shared.js";

const inputShape = {
  alias: z.string().optional().describe("Registered project alias. Omitted -> the sole registered project."),
  anchor: z
    .string()
    .describe('Where to start: a path, a design row id, or a port address ("pick", "D1", "guides/bug.md").'),
  input: z
    .string()
    .optional()
    .describe("The input being routed. Its words are what the ranking uses -- omitted means no ranking, just the radius."),
  hops: z
    .number()
    .int()
    .min(RETRIEVE_HOP_CHOICES[0])
    .max(RETRIEVE_HOP_CHOICES[RETRIEVE_HOP_CHOICES.length - 1]!)
    .optional()
    .describe("Relations to walk: 1 or 2. Default 2."),
};

/**
 * `find_documents`: 4단계 문서 호출 for a host model.
 *
 * This is what replaces a hardcoded routing table in an agent's own code
 * (기획서 4.6): instead of a `FRAGMENTS` map inside the node, the node asks the
 * graph and gets back candidates **with a 근거 경로**. A ranking a model cannot
 * explain is a ranking nobody can debug, so `via` is not optional here.
 *
 * Read-only, and computed by Core from `overlay.ir` + `inferred.json`, so it
 * answers with the Neo4j sidecar down -- the replica is an index (원칙 7).
 */
export function registerFindDocumentsTool(server: McpServer, studioHome: string): void {
  server.registerTool(
    "find_documents",
    {
      title: "Find Documents by Graph",
      description:
        "Given an anchor and the input being routed, returns the document dependencies within 1~2 hops " +
        "of that anchor in the project's design graph, ranked inside that neighborhood, each with the " +
        "evidence path from the anchor to it. Secret-grade rows (L4) are withheld and never appear in a " +
        "path. Use this instead of a hardcoded document-routing table. Works whether or not Neo4j is running.",
      inputSchema: inputShape,
    },
    async ({ alias, anchor, input, hops }) => {
      const { registered } = await resolveRegisteredProject(studioHome, alias);
      let replica;
      try {
        replica = await readKnowledgeReplica(studioHome, registered.alias);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
          throw new Error(
            `Project "${registered.alias}" has not been scanned yet -- run "patchbay scan --project ${registered.alias}" first.`,
          );
        }
        throw error;
      }

      const result = retrieveDocuments(replica.snapshot, { anchor, query: input ?? "", maxHops: hops });
      return jsonResult({
        alias: registered.alias,
        anchor,
        anchorPath: result.anchor?.path ?? null,
        irVersion: replica.irVersion,
        maxHops: result.maxHops,
        terms: result.terms,
        matchedCount: result.matchedCount,
        withheld: result.withheld,
        // 3.5 -- 0 means this graph holds nothing the scan did not already have.
        designEdges: replica.audit.designEdges,
        replicaWarning: replica.audit.warning,
        candidates: result.candidates,
        error: result.error,
        hits: result.hits,
      });
    },
  );
}

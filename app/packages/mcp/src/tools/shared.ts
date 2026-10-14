import {
  computeAtlasCounts,
  computeAtlasSections,
  computeFlowGraph,
  readAtlas,
  readAtlasDigest,
  readInferred,
  readOverlay,
  readStudio,
  resolveProjectAlias,
  type FlowGraph,
  type Inferred,
  type Overlay,
  type Studio,
  type StudioRegisteredProject,
} from "@patchbay/core";

/**
 * Shared helpers for the four MCP tools (Phase 6). Everything here calls
 * `@patchbay/core` only -- no direct `fs` access -- per the project's
 * "MCP and CLI both go through Core" rule.
 */

export type Level = 1 | 2 | 3;

/**
 * Validates a raw `level` tool argument (already known to be `number |
 * undefined` from the zod schema) against the `1 | 2 | 3` contract shared by
 * `get_atlas`/`get_graph`/`get_project_bundle`, applying `fallback` when
 * omitted.
 */
export function resolveLevel(raw: number | undefined, fallback: Level): Level {
  if (raw === undefined) return fallback;
  if (raw === 1 || raw === 2 || raw === 3) return raw;
  throw new Error(`Invalid level ${JSON.stringify(raw)} -- must be 1, 2, or 3.`);
}

/**
 * Resolves `alias` (spec 8.5: omitted -> the sole registered project, else a
 * clear error -- `resolveProjectAlias`, moved into Core this phase
 * specifically so MCP could reuse it) and returns both the `Studio` and the
 * matching `StudioRegisteredProject` record.
 *
 * Throws a plain `Error` on an unresolvable alias (unregistered alias,
 * zero, or multiple registered projects with none specified) -- the message
 * from `resolveProjectAlias` is already caller-facing, so it's used as-is.
 * A tool handler that throws has its error surfaced by the MCP SDK as a
 * `CallToolResult` with `isError: true` (see `server/mcp.js`'s
 * `createToolError`), which is the SDK's own convention for tool-level
 * errors -- this project doesn't need to reinvent that shape.
 */
export async function resolveRegisteredProject(
  studioHome: string,
  alias: string | undefined,
): Promise<{ studio: Studio; registered: StudioRegisteredProject }> {
  const studio = await readStudio(studioHome);
  const resolution = resolveProjectAlias(studio, alias);
  if (!resolution.ok) {
    throw new Error(resolution.message);
  }

  const registered = studio.projects.find((project) => project.alias === resolution.alias);
  if (!registered) {
    // Unreachable given resolveProjectAlias's contract -- mirrors the CLI's
    // own defensive check (packages/cli/src/commands/scan.ts) rather than
    // trusting that contract silently.
    throw new Error(`No project registered with alias "${resolution.alias}".`);
  }

  return { studio, registered };
}

/**
 * Wraps `fn`, translating a missing-file (`ENOENT`) error into a clear
 * "hasn't been scanned yet" message -- the MCP-side equivalent of the CLI's
 * `atlas` command's own not-found handling in `packages/cli/src/commands/atlas.ts`.
 * Any other error (a real I/O failure, a schema validation failure) passes
 * through unchanged.
 */
async function withNotScannedError<T>(alias: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new Error(
        `Project "${alias}" has not been scanned yet -- run "patchbay scan --project ${alias}" first.`,
      );
    }
    throw error;
  }
}

/**
 * `get_atlas`'s per-level content (spec 8.5): L1 digest, L2 full Atlas, or
 * L3 raw `inferred.json` re-serialized. Also reused as-is for
 * `get_project_bundle`'s `atlas` field, which the spec (8.5 + the project
 * lead's scope-parameter decision) defines as exactly this content.
 */
export async function readAtlasContent(studioHome: string, alias: string, level: Level): Promise<string> {
  return withNotScannedError(alias, async () => {
    if (level === 1) return readAtlasDigest(studioHome, alias);
    if (level === 2) return readAtlas(studioHome, alias);
    const inferred = await readInferred(studioHome, alias);
    return `${JSON.stringify(inferred, null, 2)}\n`;
  });
}

/**
 * Reads `inferred.json` for `alias`, translating a missing file into the
 * same "hasn't been scanned yet" error as `readAtlasContent`/
 * `computeGraphResult`. Exported for `get_project_bundle`'s `scope: "full"`
 * excerpts, which need `discoveredPorts` regardless of the requested
 * `level`.
 */
export async function readInferredOrThrow(studioHome: string, alias: string): Promise<Inferred> {
  return withNotScannedError(alias, () => readInferred(studioHome, alias));
}

/** The level-specific payload shared between the `get_graph` tool and `get_project_bundle`'s `graph` field. */
export type GraphLevelResult =
  | { nodeCount: number; edgeCount: number; patchesWithoutWireCount: number; wiresWithoutPatchCount: number }
  | { graph: FlowGraph }
  | { content: string };

async function readInferredAndOverlay(
  studioHome: string,
  alias: string,
): Promise<{ inferred: Inferred; overlay: Overlay }> {
  return withNotScannedError(alias, async () => {
    const inferred = await readInferred(studioHome, alias);
    const overlay = await readOverlay(studioHome, alias);
    return { inferred, overlay };
  });
}

/**
 * `get_graph`'s per-level result (spec 8.5):
 *   - L1: summary counts, computed on the spot from `computeFlowGraph` +
 *     `computeAtlasSections`/`computeAtlasCounts` -- no new digest file.
 *   - L2: the full `FlowGraph` (nodes/edges JSON), from `computeFlowGraph`.
 *   - L3: raw `inferred.json`, the same source as `get_atlas`'s L3.
 */
export async function computeGraphResult(
  studioHome: string,
  alias: string,
  level: Level,
): Promise<GraphLevelResult> {
  if (level === 3) {
    const content = await withNotScannedError(alias, async () => {
      const inferred = await readInferred(studioHome, alias);
      return `${JSON.stringify(inferred, null, 2)}\n`;
    });
    return { content };
  }

  const { inferred, overlay } = await readInferredAndOverlay(studioHome, alias);
  const graph = computeFlowGraph(inferred, overlay);

  if (level === 2) {
    return { graph };
  }

  const counts = computeAtlasCounts(computeAtlasSections(inferred, overlay));
  return {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    patchesWithoutWireCount: counts.patchesWithoutWire,
    wiresWithoutPatchCount: counts.wiresWithoutPatch,
  };
}

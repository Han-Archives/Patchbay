import {
  computeImpactRadius,
  computePortDebt,
  IMPACT_MAX_HOPS,
  nodeFromPort,
  readInferred,
  readOverlay,
  readStudio,
} from "@patchbay/core";
import type { ImpactViewResponse, ImpactPortView } from "./neo4jContract.js";

export type LoadImpactResult =
  | { ok: true; body: ImpactViewResponse }
  | { ok: false; status: 400 | 404; error: string };

/** Every skill's basename is `SKILL.md`, so the folder holding it is its name. */
function shortName(path: string, fallback: string): string {
  const segments = path.split("/");
  const base = segments[segments.length - 1] ?? fallback;
  if (base !== "SKILL.md") return base;
  return segments[segments.length - 2] ?? base;
}

function toPortView(port: string, via: string, kind: string): ImpactPortView {
  const node = nodeFromPort(port);
  const path = node?.path ?? port;
  return {
    port,
    path,
    name: shortName(path, port),
    label: node?.label ?? "File",
    via,
    kind,
  };
}

/**
 * The 지식 tab's impact radius. Answers from `inferred` + `overlay` through
 * Core, never through the Neo4j replica, so the number the console shows and
 * the number `get_impact` gives a host model are the same one and neither
 * needs the sidecar up (기획 원칙 4·5).
 */
export async function loadImpactView(
  studioHome: string,
  alias: string | undefined,
  origin: string | undefined,
  hops: number | undefined,
): Promise<LoadImpactResult> {
  if (!alias) {
    return { ok: false, status: 400, error: "impact: alias query parameter is required." };
  }

  const studio = await readStudio(studioHome);
  const registered = studio.projects.find((project) => project.alias === alias);
  if (!registered) {
    const known = studio.projects.map((project) => project.alias);
    return {
      ok: false,
      status: 404,
      error:
        `No project registered with alias "${alias}". ` +
        (known.length > 0
          ? `Registered aliases: ${known.join(", ")}.`
          : `No projects are registered yet -- run "patchbay project add --path <path>" first.`),
    };
  }

  let inferred;
  try {
    inferred = await readInferred(studioHome, alias);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, body: { status: "unscanned", alias, path: registered.path } };
    }
    throw error;
  }

  const overlay = await readOverlay(studioHome, alias);
  const debt = computePortDebt(inferred, overlay);
  const maxHops = hops && hops > 0 ? Math.min(hops, 6) : IMPACT_MAX_HOPS;

  const radius = origin ? computeImpactRadius(overlay, origin, maxHops) : null;

  return {
    ok: true,
    body: {
      status: "ok",
      alias,
      origin: origin ?? null,
      known: origin ? (radius?.total ?? 0) > 0 || inferred.discoveredPorts.includes(origin as never) : true,
      maxHops,
      total: radius?.total ?? 0,
      rings: (radius?.hops ?? []).map((ring, index) => ({
        hop: index + 1,
        count: ring.length,
        ports: ring.map((hit) => toPortView(hit.port, hit.via, hit.kind)),
      })),
      debt: {
        orphans: debt.orphans.length,
        hubs: debt.hubs.slice(0, 5).map((hub) => ({
          port: hub.port,
          name: shortName(nodeFromPort(hub.port)?.path ?? hub.port, hub.port),
          degree: hub.degree,
        })),
      },
    },
  };
}

import { createHash } from "node:crypto";
import {
  readKnowledgeReplica,
  readStudio,
  retrieveDocuments,
  snapshotCounts,
  type KnowledgeSnapshot,
} from "@patchbay/core";
import type { Neo4jPort } from "./neo4jAdapter.js";
import {
  DEFAULT_NEO4J_URI,
  KNOWLEDGE_HIT_LIMIT,
  type DocumentCallResponse,
  type KnowledgeEdgeView,
  type KnowledgeNodeView,
  type KnowledgeViewResponse,
} from "./neo4jContract.js";

export type LoadKnowledgeResult =
  | { ok: true; body: KnowledgeViewResponse }
  | { ok: false; status: 400 | 404; error: string };

export type LoadDocumentCallResult =
  | { ok: true; body: DocumentCallResponse }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Remembers which snapshot each alias was last ingested from.
 *
 * Without this, every `/api/knowledge` request re-ran `replaceAlias`, and
 * that is `DETACH DELETE` + full re-CREATE -- so typing in the search box
 * rewrote the whole project graph per keystroke, and two open tabs deleted
 * each other's rows mid-read. The replica still tracks the files: a rescan
 * changes the fingerprint (and the SSE `inferred`/`overlay` events call
 * `ingestKnowledgeAlias` directly), so Neo4j stays a copy the rescan can
 * rebuild -- it just stops being rebuilt for reads that changed nothing.
 */
export interface IngestTracker {
  /** True when `snapshot` differs from the last one ingested for `alias`. Records it either way. */
  claim(alias: string, snapshot: KnowledgeSnapshot): boolean;
  forget(alias: string): void;
}

export function createIngestTracker(): IngestTracker {
  const seen = new Map<string, string>();
  return {
    claim(alias, snapshot) {
      const digest = createHash("sha1").update(JSON.stringify(snapshot)).digest("hex");
      if (seen.get(alias) === digest) return false;
      seen.set(alias, digest);
      return true;
    },
    forget(alias) {
      seen.delete(alias);
    },
  };
}

export async function loadKnowledgeView(
  studioHome: string,
  alias: string | undefined,
  query: string,
  selectedPath: string | undefined,
  port: Neo4jPort | undefined,
  fallbackUri: string = DEFAULT_NEO4J_URI,
  tracker?: IngestTracker,
): Promise<LoadKnowledgeResult> {
  if (!alias) {
    return { ok: false, status: 400, error: "knowledge: alias query parameter is required." };
  }

  const uri = port?.uri ?? fallbackUri;
  if (!port || !(await safeProbe(port))) {
    return { ok: true, body: { status: "disconnected", uri, alias } };
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

  let replica;
  try {
    replica = await readKnowledgeReplica(studioHome, alias);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ok: true,
        body: { status: "unscanned", uri, alias, path: registered.path },
      };
    }
    throw error;
  }

  const snapshot = replica.snapshot;
  const warnings: string[] = [];
  if (!tracker || tracker.claim(alias, snapshot)) {
    try {
      await port.replaceAlias(alias, snapshot);
    } catch (error) {
      tracker?.forget(alias);
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  let hits = snapshot.nodes.slice(0, KNOWLEDGE_HIT_LIMIT);
  let counts = snapshotCounts(snapshot);
  try {
    hits = await port.search(alias, query, KNOWLEDGE_HIT_LIMIT);
    counts = await port.counts(alias);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
    const q = query.trim().toLowerCase();
    hits = (
      q
        ? snapshot.nodes.filter(
            (node) =>
              node.path.toLowerCase().includes(q) ||
              node.name.toLowerCase().includes(q) ||
              (node.port !== null && node.port.toLowerCase().includes(q)) ||
              (node.text !== null && node.text.toLowerCase().includes(q)),
          )
        : snapshot.nodes
    ).slice(0, KNOWLEDGE_HIT_LIMIT);
  }

  let selected: KnowledgeNodeView | null = selectedPath
    ? (snapshot.nodes.find((node) => node.path === selectedPath) ?? null)
    : null;
  let neighbors: KnowledgeNodeView[] = [];
  let edges: KnowledgeEdgeView[] = [];
  if (selectedPath) {
    try {
      const hood = await port.neighborhood(alias, selectedPath);
      selected = hood.selected ?? selected;
      neighbors = hood.neighbors;
      edges = hood.edges;
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    ok: true,
    body: {
      status: "connected",
      uri,
      alias,
      query,
      selected,
      hits,
      neighbors,
      edges,
      counts,
      // 3.5 -- counted from the snapshot the files produced, not from what the
      // sidecar happened to answer: a downed Neo4j must not read as "the design
      // is missing".
      replica: replica.audit,
      irVersion: replica.irVersion,
      warning: warnings.length > 0 ? warnings.join(" ") : null,
    },
  };
}

/**
 * 4단계 문서 호출 -- 앵커에서 1~2홉 안의 문서를, 근거 경로와 함께.
 *
 * Computed by Core from the project's own files, like the impact radius: 원칙 7
 * makes `overlay.yaml` the original and Neo4j an index, so a retrieval that
 * needed the sidecar up would make the index load-bearing.
 */
export async function loadDocumentCallView(
  studioHome: string,
  alias: string | undefined,
  anchor: string,
  query: string,
  hops: number | undefined,
): Promise<LoadDocumentCallResult> {
  if (!alias) {
    return { ok: false, status: 400, error: "knowledge documents: alias query parameter is required." };
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

  let replica;
  try {
    replica = await readKnowledgeReplica(studioHome, alias);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, body: { status: "unscanned", alias, path: registered.path } };
    }
    throw error;
  }

  const result = retrieveDocuments(replica.snapshot, { anchor, query, maxHops: hops });
  return {
    ok: true,
    body: {
      status: "ok",
      alias,
      anchor,
      anchorPath: result.anchor?.path ?? null,
      query,
      maxHops: result.maxHops,
      terms: result.terms,
      hits: result.hits,
      matchedCount: result.matchedCount,
      withheld: result.withheld,
      candidates: result.candidates,
      replica: replica.audit,
      error: result.error,
    },
  };
}

export async function ingestKnowledgeAlias(
  studioHome: string,
  alias: string,
  port: Neo4jPort,
  tracker?: IngestTracker,
): Promise<void> {
  if (!(await safeProbe(port))) return;
  try {
    const { snapshot } = await readKnowledgeReplica(studioHome, alias);
    if (tracker && !tracker.claim(alias, snapshot)) return;
    try {
      await port.replaceAlias(alias, snapshot);
    } catch (error) {
      tracker?.forget(alias);
      throw error;
    }
  } catch {
    // Missing inferred or a downed sidecar must not break SSE.
  }
}

async function safeProbe(port: Neo4jPort): Promise<boolean> {
  try {
    return await port.probe();
  } catch {
    return false;
  }
}

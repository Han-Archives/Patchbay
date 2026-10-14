import neo4j, { int, type Driver } from "neo4j-driver";
import {
  countsFromNodes,
  graphFromInferred,
  KNOWLEDGE_ASSUMED_LEVEL,
  KNOWLEDGE_LABELS,
  KNOWLEDGE_RELATIONS,
  KNOWLEDGE_SECRET_LEVEL,
  labelFromNeo4jLabels,
  type KnowledgeCounts,
  type KnowledgeEdgeView,
  type KnowledgeNodeView,
  type KnowledgeRelation,
  type KnowledgeSnapshot,
  type SensitivityLevel,
} from "@patchbay/core";
import {
  DEFAULT_NEO4J_URI,
  KNOWLEDGE_HIT_LIMIT,
  NEO4J_PROBE_TIMEOUT_MS,
  resolveNeo4jPassword,
  resolveNeo4jUri,
  resolveNeo4jUser,
} from "./neo4jContract.js";

export interface Neighborhood {
  selected: KnowledgeNodeView | null;
  neighbors: KnowledgeNodeView[];
  edges: KnowledgeEdgeView[];
}

export interface Neo4jPort {
  readonly uri: string;
  probe(): Promise<boolean>;
  replaceAlias(alias: string, snapshot: KnowledgeSnapshot): Promise<void>;
  search(alias: string, query: string, limit?: number): Promise<KnowledgeNodeView[]>;
  neighborhood(alias: string, path: string): Promise<Neighborhood>;
  counts(alias: string): Promise<KnowledgeCounts>;
  close(): Promise<void>;
}

export interface Neo4jAppOptions {
  uri?: string;
  user?: string;
  password?: string;
  timeoutMs?: number;
  /** Injected in tests. When set, no real driver is created. */
  port?: Neo4jPort;
}

/**
 * Withholds a secret row from anything that leaves the replica.
 *
 * After the scanner started grading ports, an L4 path never reaches
 * `inferred.json`'s `discoveredPorts`, so it cannot be ingested at all -- this
 * is the backstop for a replica written before that (no `level` property,
 * read as L2) and for an overlay endpoint a person wired by hand.
 */
function withheld(node: KnowledgeNodeView): boolean {
  return node.level >= KNOWLEDGE_SECRET_LEVEL;
}

export function createMemoryNeo4jPort(uri: string = DEFAULT_NEO4J_URI): Neo4jPort {
  const graphs = new Map<string, KnowledgeSnapshot>();
  return {
    uri,
    async probe() {
      return true;
    },
    async replaceAlias(alias, snapshot) {
      graphs.set(alias, {
        nodes: snapshot.nodes.map((node) => ({ ...node })),
        edges: snapshot.edges.map((edge) => ({ ...edge })),
      });
    },
    async search(alias, query, limit = KNOWLEDGE_HIT_LIMIT) {
      const snapshot = graphs.get(alias);
      if (!snapshot) return [];
      const q = query.trim().toLowerCase();
      const visible = snapshot.nodes.filter((node) => !withheld(node));
      const hits = q
        ? visible.filter(
            (node) =>
              node.path.toLowerCase().includes(q) ||
              node.name.toLowerCase().includes(q) ||
              (node.port !== null && node.port.toLowerCase().includes(q)) ||
              (node.text !== null && node.text.toLowerCase().includes(q)),
          )
        : visible;
      return hits.slice(0, limit);
    },
    async neighborhood(alias, path) {
      const snapshot = graphs.get(alias);
      if (!snapshot || !path) return { selected: null, neighbors: [], edges: [] };
      const selected = snapshot.nodes.find((node) => node.path === path) ?? null;
      if (!selected || withheld(selected)) return { selected: null, neighbors: [], edges: [] };
      const edges = snapshot.edges.filter((edge) => edge.from === path || edge.to === path);
      const neighborPaths = new Set<string>();
      for (const edge of edges) {
        neighborPaths.add(edge.from === path ? edge.to : edge.from);
      }
      const neighbors = snapshot.nodes.filter((node) => neighborPaths.has(node.path) && !withheld(node));
      const visible = new Set([selected.path, ...neighbors.map((node) => node.path)]);
      return { selected, neighbors, edges: edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to)) };
    },
    async counts(alias) {
      const snapshot = graphs.get(alias);
      return countsFromNodes(snapshot ? snapshot.nodes.filter((node) => !withheld(node)) : []);
    },
    async close() {
      graphs.clear();
    },
  };
}

export function createNeo4jDriverPort(options: Neo4jAppOptions = {}): Neo4jPort {
  if (options.port) return options.port;
  const uri = resolveNeo4jUri(options.uri);
  const user = resolveNeo4jUser(options.user);
  const password = resolveNeo4jPassword(options.password);
  const timeoutMs = options.timeoutMs ?? NEO4J_PROBE_TIMEOUT_MS;
  const driver: Driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
    connectionTimeout: timeoutMs,
    maxConnectionPoolSize: 4,
  });

  const run = async (cypher: string, params: Record<string, unknown> = {}) => {
    const session = driver.session();
    try {
      return await session.run(cypher, params);
    } finally {
      await session.close();
    }
  };

  /**
   * The spec fixes a Knowledge node's identity as `(alias, path)` but nothing
   * ever backed that with an index, so every search and neighborhood lookup
   * was a full `:Knowledge` label scan. One idempotent constraint per
   * process, ahead of the first write.
   */
  let schemaReady: Promise<void> | null = null;
  const ensureSchema = () => {
    schemaReady ??= run(
      `CREATE CONSTRAINT knowledge_alias_path IF NOT EXISTS
       FOR (n:Knowledge) REQUIRE (n.alias, n.path) IS UNIQUE`,
    ).then(
      () => undefined,
      () => undefined, // An older//community server without constraint support must not break ingest.
    );
    return schemaReady;
  };

  return {
    uri,
    async probe() {
      try {
        const reached = await Promise.race([
          driver.verifyConnectivity().then(() => true),
          sleep(timeoutMs).then(() => false),
        ]);
        return reached;
      } catch {
        return false;
      }
    },
    async replaceAlias(alias, snapshot) {
      await ensureSchema();
      await run("MATCH (n:Knowledge {alias: $alias}) DETACH DELETE n", { alias });
      /**
       * One statement per label, not one statement with a `FOREACH` arm per
       * label. Cypher cannot take a label from a parameter, and the arm chain
       * grew a line for every label the design rows added -- eight arms run for
       * every row to set one label. Grouping in JS first keeps the write linear
       * in the number of labels *present*, and the literal comes from
       * `KNOWLEDGE_LABELS`, never from a row.
       */
      for (const label of KNOWLEDGE_LABELS) {
        const rows = snapshot.nodes.filter((node) => node.label === label);
        if (rows.length === 0) continue;
        // `toInteger` because a plain JS number arrives as a Neo4j Float, and a
        // grade stored as 2.0 reads back wrong the moment anything compares it
        // to an Integer or prints it.
        await run(
          `UNWIND $nodes AS row
           CREATE (n:Knowledge:${label} {alias: $alias, path: row.path, name: row.name,
                                        port: row.port, text: row.text, level: toInteger(row.level)})`,
          { alias, nodes: rows },
        );
      }
      for (const kind of KNOWLEDGE_RELATIONS) {
        const rows = snapshot.edges.filter((edge) => edge.kind === kind);
        if (rows.length === 0) continue;
        await run(
          `UNWIND $edges AS row
           MATCH (a:Knowledge {alias: $alias, path: row.from})
           MATCH (b:Knowledge {alias: $alias, path: row.to})
           MERGE (a)-[:${kind}]->(b)`,
          { alias, edges: rows },
        );
      }
    },
    async search(alias, query, limit = KNOWLEDGE_HIT_LIMIT) {
      const q = query.trim().toLowerCase();
      const result = await run(
        `MATCH (n:Knowledge {alias: $alias})
         WHERE coalesce(n.level, $assumed) < $secret
           AND ($q = '' OR toLower(n.path) CONTAINS $q OR toLower(n.name) CONTAINS $q
                OR (n.port IS NOT NULL AND toLower(n.port) CONTAINS $q)
                OR (n.text IS NOT NULL AND toLower(n.text) CONTAINS $q))
         RETURN n.path AS path, n.name AS name, n.port AS port, n.text AS text,
                n.level AS level, labels(n) AS labels
         ORDER BY n.path
         LIMIT $limit`,
        { alias, q, limit: int(limit), assumed: int(KNOWLEDGE_ASSUMED_LEVEL), secret: int(KNOWLEDGE_SECRET_LEVEL) },
      );
      return result.records.map(recordToNode);
    },
    async neighborhood(alias, path) {
      if (!path) return { selected: null, neighbors: [], edges: [] };
      const selectedRes = await run(
        `MATCH (n:Knowledge {alias: $alias, path: $path})
         WHERE coalesce(n.level, $assumed) < $secret
         RETURN n.path AS path, n.name AS name, n.port AS port, n.text AS text,
                n.level AS level, labels(n) AS labels`,
        { alias, path, assumed: int(KNOWLEDGE_ASSUMED_LEVEL), secret: int(KNOWLEDGE_SECRET_LEVEL) },
      );
      const selectedRow = selectedRes.records[0];
      if (!selectedRow) return { selected: null, neighbors: [], edges: [] };
      const selected = recordToNode(selectedRow);
      const rels = await run(
        `MATCH (n:Knowledge {alias: $alias, path: $path})-[r]-(m:Knowledge {alias: $alias})
         WHERE coalesce(m.level, $assumed) < $secret
         RETURN m.path AS path, m.name AS name, m.port AS port, m.text AS text,
                m.level AS level, labels(m) AS labels,
                type(r) AS kind, startNode(r).path AS from, endNode(r).path AS to`,
        { alias, path, assumed: int(KNOWLEDGE_ASSUMED_LEVEL), secret: int(KNOWLEDGE_SECRET_LEVEL) },
      );
      const neighbors: KnowledgeNodeView[] = [];
      const edges: KnowledgeEdgeView[] = [];
      const seenN = new Set<string>();
      const seenE = new Set<string>();
      for (const rec of rels.records) {
        const neighbor = recordToNode(rec);
        if (!seenN.has(neighbor.path)) {
          seenN.add(neighbor.path);
          neighbors.push(neighbor);
        }
        const kind = relationFromType(rec.get("kind"));
        const from = String(rec.get("from") ?? "");
        const to = String(rec.get("to") ?? "");
        const key = `${kind}:${from}->${to}`;
        if (from && to && !seenE.has(key)) {
          seenE.add(key);
          edges.push({ from, to, kind });
        }
      }
      return { selected, neighbors, edges };
    },
    async counts(alias) {
      const result = await run(
        `MATCH (n:Knowledge {alias: $alias})
         WHERE coalesce(n.level, $assumed) < $secret
         RETURN n.path AS path, n.name AS name, n.port AS port, n.text AS text,
                n.level AS level, labels(n) AS labels`,
        { alias, assumed: int(KNOWLEDGE_ASSUMED_LEVEL), secret: int(KNOWLEDGE_SECRET_LEVEL) },
      );
      return countsFromNodes(result.records.map(recordToNode));
    },
    async close() {
      await driver.close();
    },
  };
}

function recordToNode(rec: { get: (key: string) => unknown }): KnowledgeNodeView {
  const path = String(rec.get("path") ?? "");
  const name = String(rec.get("name") ?? path);
  const portRaw = rec.get("port");
  const port = typeof portRaw === "string" && portRaw ? portRaw : null;
  const textRaw = rec.get("text");
  const text = typeof textRaw === "string" && textRaw ? textRaw : null;
  return {
    path,
    name,
    port,
    text,
    level: levelFromRecord(rec.get("level")),
    label: labelFromNeo4jLabels(rec.get("labels")),
  };
}

/**
 * Reads a stored relation type back. A type this Patchbay does not know reads
 * as `REFERENCES` -- the weakest claim in the set, "these two are related" --
 * rather than as `CONTAINS`, which would assert a containment that isn't there.
 */
function relationFromType(raw: unknown): KnowledgeRelation {
  const value = String(raw ?? "");
  return (KNOWLEDGE_RELATIONS as readonly string[]).includes(value)
    ? (value as KnowledgeRelation)
    : "REFERENCES";
}

/**
 * Reads a stored level back. Neo4j returns an integer as its own `Integer`
 * wrapper, and a row written before levels existed returns null -- both land
 * on the assumed grade rather than on 0, which would read as "public".
 */
function levelFromRecord(raw: unknown): SensitivityLevel {
  const value =
    typeof raw === "number"
      ? raw
      : raw !== null && typeof raw === "object" && "toNumber" in raw
        ? (raw as { toNumber: () => number }).toNumber()
        : NaN;
  if (!Number.isInteger(value) || value < 0 || value > KNOWLEDGE_SECRET_LEVEL) return KNOWLEDGE_ASSUMED_LEVEL;
  return value as SensitivityLevel;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
  });
}

/** Re-export so tests can seed a replica without going through loadKnowledgeView. */
export { graphFromInferred };

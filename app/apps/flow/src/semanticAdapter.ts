import { int, type Driver } from "neo4j-driver";
import type { SemanticProjection, SemanticGraph, SemanticPredicate } from "@patchbay/core";

export interface SemanticQuery { query: string; selected: string; evidenceIds: string[] }
export interface SemanticPort {
  cursor(alias: string): Promise<number>;
  apply(alias: string, projection: SemanticProjection): Promise<void>;
  query(alias: string, input: SemanticQuery): Promise<SemanticGraph>;
  reset(alias: string): Promise<void>;
}
type GraphRow = { id: string; from: string; to: string; subject: string; object: string; sourceId: string; predicate: SemanticPredicate; evidenceId: string };
function graph(rows: GraphRow[], selected: string): SemanticGraph {
  const entities = new Map<string, SemanticGraph["entities"][number]>(), claims = new Map<string, SemanticGraph["claims"][number]>();
  for (const r of rows.slice(0, 80)) {
    entities.set(r.from, { id: r.from, name: r.subject, sourceId: r.sourceId });
    entities.set(r.to, { id: r.to, name: r.object, sourceId: r.sourceId });
    const claim = claims.get(r.id) ?? { id: r.id, from: r.from, to: r.to, predicate: r.predicate, evidenceIds: [] };
    if (!claim.evidenceIds.includes(r.evidenceId)) claim.evidenceIds.push(r.evidenceId);
    claims.set(r.id, claim);
  }
  return { entities: [...entities.values()], claims: [...claims.values()], selected: selected || null, truncated: rows.length > 80 };
}
export function createMemorySemanticPort(): SemanticPort {
  const states = new Map<string, SemanticProjection>();
  return {
    async cursor(alias) { return states.get(alias)?.seq ?? 0; },
    async apply(alias, projection) {
      const previous = states.get(alias)?.seq ?? 0;
      if (projection.seq <= previous) return;
      if (projection.seq !== previous + 1) throw Error("의미 그래프 반영 순서가 맞지 않습니다.");
      states.set(alias, structuredClone(projection));
    },
    async query(alias, input) {
      const q = input.query.toLowerCase(), allowed = new Set(input.evidenceIds);
      const rows = (states.get(alias)?.evidence ?? []).filter(e => allowed.has(e.id) && e.current && e.decision === "approved"
        && (!input.selected || e.from === input.selected || e.to === input.selected)
        && (!q || e.subject.toLowerCase().includes(q) || e.object.toLowerCase().includes(q)))
        .map(e => ({ ...e, id: e.claimId, evidenceId: e.id }));
      return graph(rows, input.selected);
    },
    async reset(alias) { states.delete(alias); },
  };
}

/** Shares the driver with the existing scan replica, but no :Knowledge labels or cross edges. */
export function createSemanticDriverPort(driver: Driver): SemanticPort {
  let schema: Promise<void> | null = null;
  async function ensureSchema() {
    if (!schema) schema = (async () => {
      const session = driver.session();
      try {
        await session.run("CREATE CONSTRAINT semantic_alias_id IF NOT EXISTS FOR (n:SemanticRecord) REQUIRE (n.alias, n.id) IS UNIQUE");
        await session.run("CREATE CONSTRAINT semantic_cursor_alias IF NOT EXISTS FOR (n:SemanticCursor) REQUIRE n.alias IS UNIQUE");
      } finally { await session.close(); }
    })().catch(e => { schema = null; throw e; });
    return schema;
  }
  return {
    async cursor(alias) {
      const session = driver.session();
      try {
        const result = await session.run("MATCH (c:SemanticCursor {alias:$alias}) RETURN c.seq AS seq", { alias });
        return Number(result.records[0]?.get("seq") ?? 0);
      } finally { await session.close(); }
    },
    async apply(alias, p) {
      await ensureSchema();
      const session = driver.session();
      try {
        await session.executeWrite(async tx => {
          // The write lock precedes reading seq. Duplicate deliveries are no-ops, gaps stop the queue.
          const cursor = await tx.run("MERGE (c:SemanticCursor {alias:$alias}) ON CREATE SET c.seq=0, c.lock=0 SET c.lock=c.lock+1 RETURN c.seq AS seq", { alias });
          const previous = Number(cursor.records[0]!.get("seq"));
          if (p.seq <= previous) return;
          if (p.seq !== previous + 1) throw Error("의미 그래프 반영 순서가 맞지 않습니다.");
          await tx.run("MATCH (n:SemanticRecord {alias:$alias}) DETACH DELETE n", { alias });
          const put = async (label: string, rows: unknown[]) => {
            await tx.run(`UNWIND $rows AS row CREATE (n:SemanticRecord:${label}) SET n = row, n.alias=$alias`, { alias, rows });
          };
          await put("SemanticSource", p.sources);
          await put("SemanticVersion", p.versions.map(v => ({ id: v.id, sourceId: v.sourceId, hash: v.hash })));
          await put("SemanticChunk", [...new Map(p.versions.flatMap(v => v.chunks).map(c => [c.id, c])).values()]);
          await put("SemanticEntity", p.entities.map(e => ({ id: e.id, name: e.name, sourceId: e.sourceId })));
          await put("SemanticClaim", p.claims.map(c => ({ id: c.id, from: c.from, to: c.to, predicate: c.predicate })));
          await put("SemanticEvidence", p.evidence.map(e => ({ id: e.id, claimId: e.claimId, versionId: e.versionId, chunkId: e.chunkId,
            quote: e.quote, review: e.decision, current: e.current, sourceId: e.sourceId, path: e.path, line: int(e.line) })));
          await tx.run(`MATCH (s:SemanticSource {alias:$alias}), (v:SemanticVersion {alias:$alias}) WHERE s.id=v.sourceId MERGE (s)-[:HAS_VERSION]->(v)`, { alias });
          await tx.run(`UNWIND $versions AS v UNWIND v.chunkIds AS id MATCH (version:SemanticVersion {alias:$alias,id:v.id}), (chunk:SemanticChunk {alias:$alias,id:id}) MERGE (version)-[:HAS_CHUNK]->(chunk)`,
            { alias, versions: p.versions.map(v => ({ id: v.id, chunkIds: v.chunks.map(c => c.id) })) });
          await tx.run(`MATCH (c:SemanticClaim {alias:$alias}), (a:SemanticEntity {alias:$alias}), (b:SemanticEntity {alias:$alias})
            WHERE c.from=a.id AND c.to=b.id MERGE (a)-[:SUBJECT_OF]->(c) MERGE (c)-[:OBJECT]->(b)`, { alias });
          await tx.run(`MATCH (e:SemanticEvidence {alias:$alias}), (c:SemanticClaim {alias:$alias}), (ch:SemanticChunk {alias:$alias})
            WHERE e.claimId=c.id AND e.chunkId=ch.id MERGE (c)-[:HAS_EVIDENCE]->(e) MERGE (e)-[:CITES]->(ch)`, { alias });
          await tx.run("MATCH (c:SemanticCursor {alias:$alias}) SET c.seq=$seq", { alias, seq: int(p.seq) });
        }, { timeout: 10_000 });
      } finally { await session.close(); }
    },
    async query(alias, input) {
      if (!input.evidenceIds.length) return graph([], input.selected);
      const session = driver.session();
      try {
        // Mandatory file/permission whitelist, even when Neo4j still holds an older source version.
        const result = await session.run(`MATCH (a:SemanticEntity {alias:$alias})-[:SUBJECT_OF]->(c:SemanticClaim {alias:$alias})-[:OBJECT]->(b:SemanticEntity {alias:$alias}),
          (c)-[:HAS_EVIDENCE]->(e:SemanticEvidence {alias:$alias})
          WHERE e.id IN $ids AND e.review='approved' AND e.current=true
            AND ($selected='' OR a.id=$selected OR b.id=$selected)
            AND ($q='' OR toLower(a.name) CONTAINS $q OR toLower(b.name) CONTAINS $q)
          RETURN c.id AS id, a.id AS from, b.id AS to, a.name AS subject, b.name AS object,
            a.sourceId AS sourceId, c.predicate AS predicate, e.id AS evidenceId ORDER BY c.id,e.id LIMIT $limit`,
          { alias, ids: input.evidenceIds, q: input.query.toLowerCase(), selected: input.selected, limit: int(81) }, { timeout: 5000 });
        return graph(result.records.map(r => Object.fromEntries(["id", "from", "to", "subject", "object", "sourceId", "predicate", "evidenceId"].map(k => [k, r.get(k)]))) as GraphRow[], input.selected);
      } finally { await session.close(); }
    },
    async reset(alias) {
      await ensureSchema();
      const session = driver.session();
      try { await session.executeWrite(async tx => {
        // Keep cursor lock in the same transaction as reset so a projection cannot interleave.
        await tx.run("MERGE (c:SemanticCursor {alias:$alias}) ON CREATE SET c.lock=0 SET c.lock=c.lock+1, c.seq=0", { alias });
        await tx.run("MATCH (n:SemanticRecord {alias:$alias}) DETACH DELETE n", { alias });
      }); } finally { await session.close(); }
    },
  };
}

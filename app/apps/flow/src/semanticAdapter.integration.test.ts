import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import neo4j from "neo4j-driver";
import { expect, it } from "vitest";
import { ensureStudioInitialized, registerProject, readSemanticSource, importSemanticCandidates,
  readSemanticState, loadSemanticWorkspace, reviewSemanticEvidence, semanticProjection } from "@patchbay/core";
import { createNeo4jDriverPort } from "./neo4jAdapter.js";

it.skipIf(process.env.PATCHBAY_TEST_NEO4J !== "1")("real Neo4j: ordered replay, idempotence, rollback, scan isolation and rebuild", async () => {
  const alias = "pb-semantic-test-" + randomUUID(), root = await fs.mkdtemp(path.join(os.tmpdir(), "pb-semantic-db-"));
  const repo = path.join(root, "repo"), home = path.join(root, "home");
  await fs.mkdir(repo); await ensureStudioInitialized(home); await registerProject(home, { alias, kind: "local_repo", path: repo });
  await fs.writeFile(path.join(repo, "guide.md"), "# 그래프\n\nPatchbay uses Neo4j.\n");
  const source = await readSemanticSource(home, alias, "guide.md");
  await importSemanticCandidates(home, alias, { path: source.path, hash: source.hash, revision: 0, candidates: [{ chunkId: source.chunks[0]!.id, quote: source.chunks[0]!.text, subject: "Patchbay", predicate: "USES", object: "Neo4j" }] });
  const first = (await loadSemanticWorkspace(home, alias)).rows[0]!;
  await reviewSemanticEvidence(home, alias, { revision: 1, id: first.id, decision: "approved" });
  const approved = await readSemanticState(home, alias);
  await reviewSemanticEvidence(home, alias, { revision: 2, id: first.id, decision: "withdrawn" });
  const withdrawn = await readSemanticState(home, alias);
  const port = createNeo4jDriverPort(), semantic = port.semantic!;
  const cleanup = neo4j.driver("bolt://127.0.0.1:7687", neo4j.auth.basic("neo4j", "patchbay"));
  try {
    expect(await port.probe()).toBe(true);
    await semantic.apply(alias, semanticProjection(approved, 1));
    await semantic.apply(alias, semanticProjection(approved, 1));
    expect(await semantic.cursor(alias)).toBe(1);
    await expect(semantic.apply(alias, semanticProjection(withdrawn, 3))).rejects.toThrow("순서");
    await semantic.apply(alias, semanticProjection(approved, 2));
    const input = { query: "", selected: "", evidenceIds: [first.id] };
    expect((await semantic.query(alias, input)).claims).toHaveLength(1);
    expect((await semantic.query(alias, { ...input, evidenceIds: [] })).claims).toHaveLength(0);
    expect((await semantic.query("other-" + alias, input)).entities).toHaveLength(0);
    const before = await semantic.query(alias, input);
    await port.replaceAlias(alias, { nodes: [{ path: "guide.md", name: "guide", label: "File", port: "source:guide.md", level: 2, text: null }], edges: [] });
    expect(await semantic.query(alias, input)).toEqual(before);
    const broken = semanticProjection(withdrawn, 3); broken.entities.push(broken.entities[0]!);
    await expect(semantic.apply(alias, broken)).rejects.toThrow();
    expect(await semantic.cursor(alias)).toBe(2); expect(await semantic.query(alias, input)).toEqual(before);
    await semantic.apply(alias, semanticProjection(withdrawn, 3));
    expect((await semantic.query(alias, input)).claims).toHaveLength(0);
    await semantic.reset(alias);
    for (let seq = 1; seq <= 3; seq++) await semantic.apply(alias, semanticProjection(withdrawn, seq));
    expect(await semantic.cursor(alias)).toBe(3); expect((await semantic.query(alias, input)).claims).toHaveLength(0);
    expect((await port.search(alias, "guide"))).toHaveLength(1);
  } finally {
    // A fresh random test alias only; never the user's project or database as a whole.
    const session = cleanup.session();
    try { await session.run("MATCH (n {alias:$alias}) WHERE n:SemanticRecord OR n:SemanticCursor OR n:Knowledge DETACH DELETE n", { alias }); }
    finally { await session.close(); await cleanup.close(); await port.close(); }
  }
}, 60_000);

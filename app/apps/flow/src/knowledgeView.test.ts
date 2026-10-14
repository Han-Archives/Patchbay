import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureStudioInitialized,
  inferredSchema,
  parseIr,
  readIrFile,
  registerProject,
  setOverlayIr,
  writeInferred,
  writeOverlayIfAbsent,
} from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { createMemoryNeo4jPort } from "./neo4jAdapter.js";
import { createIngestTracker, loadDocumentCallView, loadKnowledgeView } from "./knowledgeView.js";
import { isDocumentCallOk } from "./neo4jContract.js";

function tmpStudioHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-knowledge-"));
}

const SAMPLE_INFERRED = inferredSchema.parse({
  discoveredPorts: ["skill:map-project", "source:README.md"],
  git: { branch: "main", head: "abc1234", recentCommitSubjects: ["init"] },
  agents: [],
});

describe("loadKnowledgeView", () => {
  it("returns 400 without alias and disconnected without a port", async () => {
    const missing = await loadKnowledgeView(tmpStudioHome(), undefined, "", undefined, undefined);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.status).toBe(400);

    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
    const down = await loadKnowledgeView(studioHome, "demo", "", undefined, undefined);
    expect(down.ok).toBe(true);
    if (down.ok) {
      expect(down.body.status).toBe("disconnected");
      expect(down.body.uri).toBe("bolt://127.0.0.1:7687");
    }
  });

  it("returns unscanned when inferred.json is missing", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
    const result = await loadKnowledgeView(studioHome, "demo", "", undefined, createMemoryNeo4jPort());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.status).toBe("unscanned");
  });

  it("ingests inferred and returns hits/neighbors for the alias", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
    await writeOverlayIfAbsent(studioHome, "demo");
    await writeInferred(studioHome, "demo", SAMPLE_INFERRED);

    const port = createMemoryNeo4jPort();
    const listed = await loadKnowledgeView(studioHome, "demo", "README", undefined, port);
    expect(listed.ok).toBe(true);
    if (!listed.ok || listed.body.status !== "connected") return;
    expect(listed.body.hits.map((n) => n.path)).toEqual(["README.md"]);
    expect(listed.body.counts.files).toBeGreaterThanOrEqual(1);

    const hood = await loadKnowledgeView(studioHome, "demo", "", "README.md", port);
    expect(hood.ok).toBe(true);
    if (!hood.ok || hood.body.status !== "connected") return;
    expect(hood.body.selected?.path).toBe("README.md");
  });

  it("with a tracker, a read that changes nothing does not rewrite the replica", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
    await writeOverlayIfAbsent(studioHome, "demo");
    await writeInferred(studioHome, "demo", SAMPLE_INFERRED);

    const port = createMemoryNeo4jPort();
    let writes = 0;
    const counted = { ...port, replaceAlias: async (...args: Parameters<typeof port.replaceAlias>) => {
      writes += 1;
      return port.replaceAlias(...args);
    } };
    const tracker = createIngestTracker();

    // Three searches over an unchanged project: ingest once, not per keystroke.
    await loadKnowledgeView(studioHome, "demo", "R", undefined, counted, undefined, tracker);
    await loadKnowledgeView(studioHome, "demo", "RE", undefined, counted, undefined, tracker);
    await loadKnowledgeView(studioHome, "demo", "REA", undefined, counted, undefined, tracker);
    expect(writes).toBe(1);

    // A rescan changes the snapshot, so the replica is rebuilt.
    await writeInferred(studioHome, "demo", inferredSchema.parse({
      ...SAMPLE_INFERRED,
      discoveredPorts: [...SAMPLE_INFERRED.discoveredPorts, "source:AGENTS.md" as never],
    }));
    await loadKnowledgeView(studioHome, "demo", "REA", undefined, counted, undefined, tracker);
    expect(writes).toBe(2);
  });

  it("without a tracker the old per-request ingest still happens (default path unchanged)", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
    await writeOverlayIfAbsent(studioHome, "demo");
    await writeInferred(studioHome, "demo", SAMPLE_INFERRED);

    const port = createMemoryNeo4jPort();
    let writes = 0;
    const counted = { ...port, replaceAlias: async (...args: Parameters<typeof port.replaceAlias>) => {
      writes += 1;
      return port.replaceAlias(...args);
    } };

    await loadKnowledgeView(studioHome, "demo", "R", undefined, counted);
    await loadKnowledgeView(studioHome, "demo", "RE", undefined, counted);
    expect(writes).toBe(2);
  });
});

const FIXTURE_IR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "packages", "core", "src", "ir", "__fixtures__", "valid.ir.yaml",
);

/** A registered, scanned project whose design has been adopted. */
async function adoptedStudio(): Promise<string> {
  const studioHome = tmpStudioHome();
  await ensureStudioInitialized(studioHome);
  await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
  await writeInferred(studioHome, "demo", SAMPLE_INFERRED);
  await writeOverlayIfAbsent(studioHome, "demo");
  // Core로 읽는다 -- 콘솔이 YAML 파서를 따로 지지 않는다 (원칙 8).
  const read = await readIrFile(FIXTURE_IR);
  if (!read.ok) throw new Error(read.error);
  const parsed = parseIr(read.raw);
  if (!parsed.ok) throw new Error(parsed.error);
  await setOverlayIr(studioHome, "demo", parsed.ir);
  return studioHome;
}

describe("loadDocumentCallView", () => {
  it("answers with no Neo4j at all -- the replica is an index, not the original", async () => {
    const studioHome = await adoptedStudio();
    const result = await loadDocumentCallView(studioHome, "demo", "pick", "저장 버튼이 두 번 눌린다 — 버그다", 2);
    expect(result.ok).toBe(true);
    if (!result.ok || !isDocumentCallOk(result.body)) throw new Error("expected an ok document call");
    expect(result.body.error).toBeNull();
    expect(result.body.hits[0]?.path).toBe("guides/bug.md");
    expect(result.body.hits[0]?.via).toBe("pick -[CONSULTS]-> D1");
    expect(result.body.replica.designEdges).toBeGreaterThan(0);
  });

  it("returns 400 without an alias and unscanned before a scan", async () => {
    const missing = await loadDocumentCallView(tmpStudioHome(), undefined, "pick", "", undefined);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.status).toBe(400);

    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
    const unscanned = await loadDocumentCallView(studioHome, "demo", "pick", "", undefined);
    expect(unscanned.ok).toBe(true);
    if (unscanned.ok) expect(unscanned.body.status).toBe("unscanned");
  });
});

describe("loadKnowledgeView + 설계 행", () => {
  it("counts the design rows and stops warning once the design is adopted", async () => {
    const studioHome = await adoptedStudio();
    const port = createMemoryNeo4jPort();
    const result = await loadKnowledgeView(studioHome, "demo", "", undefined, port, undefined, createIngestTracker());
    expect(result.ok).toBe(true);
    if (!result.ok || result.body.status !== "connected") throw new Error("expected connected");
    expect(result.body.counts).toMatchObject({ documents: 4, requirements: 7, evals: 6, agentNodes: 4 });
    expect(result.body.replica.warning).toBeNull();
    expect(result.body.irVersion).toBe(1);
  });
});

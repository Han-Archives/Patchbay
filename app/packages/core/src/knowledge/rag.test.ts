import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureStudioInitialized, registerProject } from "../studio/studioStore.js";
import { importSemanticCandidates, loadSemanticWorkspace, readSemanticSource, readSemanticState, reviewSemanticEvidence, semanticProjection, updateSemanticSourceUsage } from "./semantic.js";
import { loadRagSources, searchRag, validateRagAnswer, validateRagContext, openRagCitation, ragTerms } from "./rag.js";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pb-rag-core-")), home = path.join(root, "home"), repo = path.join(root, "repo");
  await fs.mkdir(repo); await ensureStudioInitialized(home); await registerProject(home, { alias: "demo", kind: "local_repo", path: repo });
  await fs.writeFile(path.join(repo, "guide.md"), "# 검색 설계\n\n승인한 관계를 탐색하려고 Neo4j를 사용한다.\n\n운영 로그의 보관 기간은 30일이다.\n\nsearchEvidence 함수가 본문 검색을 담당한다.\n");
  const source = await readSemanticSource(home, "demo", "guide.md");
  const add = async (retrieval = true, graph = false) => importSemanticCandidates(home, "demo", { path: source.path, hash: source.hash,
    revision: (await readSemanticState(home, "demo")).seq, candidates: [], usage: { retrieval, graph } });
  return { root, home, repo, source, add };
}
describe("RAG selected-original contract", () => {
  it("searches actual Korean body and identifier terms with original version/character ranges", async () => {
    const f = await fixture(); await f.add();
    const search = await searchRag(f.home, "demo", "운영 로그 보관 기간");
    expect(search.hits[0]?.text).toContain("30일");
    const hit = search.hits[0]!;
    const original = await openRagCitation(f.home, "demo", hit);
    expect(original.content.slice(hit.start, hit.end)).toBe(hit.text);
    expect(hit.line).toBe(5);
    const identifier = await searchRag(f.home, "demo", "searchEvidence");
    expect(identifier.hits[0]?.text).toContain("searchEvidence");
    expect(ragTerms("검색을 SearchEvidence")).toContain("검색");
    expect(ragTerms("검색".normalize("NFD"))).toEqual(ragTerms("검색"));
    expect((await searchRag(f.home, "demo", "존재하지않는외계비용 zzzzzzz")).hits).toEqual([]);
  });
  it("reuses the catalogue, keeps RAG-only sources out of graph review, and advances a no-op projection", async () => {
    const f = await fixture(); await f.add();
    const state = await readSemanticState(f.home, "demo");
    expect(state.sources).toHaveLength(1); expect(state.versions).toHaveLength(1);
    expect((await loadSemanticWorkspace(f.home, "demo")).sources).toEqual([]);
    expect(semanticProjection(state).seq).toBe(1); expect(semanticProjection(state).sources).toEqual([]);
    await importSemanticCandidates(f.home, "demo", { path: f.source.path, hash: f.source.hash, revision: 1, candidates: [{
      chunkId: f.source.chunks[0]!.id, subject: "서비스", predicate: "USES", object: "Neo4j", quote: f.source.chunks[0]!.text,
    }] });
    let graph = await loadSemanticWorkspace(f.home, "demo");
    await reviewSemanticEvidence(f.home, "demo", { revision: 2, id: graph.rows[0]!.id, decision: "approved" });
    await updateSemanticSourceUsage(f.home, "demo", { sourceId: f.source.sourceId, revision: 3, retrieval: false, remoteTransfer: false });
    graph = await loadSemanticWorkspace(f.home, "demo");
    expect(graph.counts.approved).toBe(1);
    expect((await searchRag(f.home, "demo", "Neo4j")).hits).toEqual([]);
    const updated = await readSemanticState(f.home, "demo");
    expect(updated.versions).toHaveLength(1); expect(semanticProjection(updated, 1).sources).toEqual([]);
    expect(semanticProjection(updated, 4).evidence[0]?.decision).toBe("approved");
  });
  it("uses no unselected documents and isolates aliases even when paths are identical", async () => {
    const f = await fixture(); await f.add(false, true);
    expect((await searchRag(f.home, "demo", "Neo4j")).hits).toEqual([]);
    await registerProject(f.home, { alias: "other", kind: "local_repo", path: f.repo });
    expect((await loadRagSources(f.home, "other")).sources).toEqual([]);
    expect((await searchRag(f.home, "other", "Neo4j")).hits).toEqual([]);
    await expect(searchRag(f.home, "../invalid", "Neo4j")).rejects.toMatchObject({ status: 404 });
  });
  it("detects disk edits, requires explicit reload, and retains immutable old versions", async () => {
    const f = await fixture(); await f.add();
    const search = await searchRag(f.home, "demo", "로그");
    await fs.writeFile(path.join(f.repo, "guide.md"), "# 검색 설계\n\n운영 로그는 90일 보관한다.\n");
    expect((await loadRagSources(f.home, "demo")).sources[0]?.status).toBe("changed");
    const changed = await searchRag(f.home, "demo", "로그");
    expect(changed.hits).toEqual([]); expect(changed.changed).toHaveLength(1);
    await expect(validateRagContext(f.home, "demo", search)).rejects.toMatchObject({ status: 409 });
    await expect(openRagCitation(f.home, "demo", search.hits[0]!)).rejects.toMatchObject({ status: 409 });
    const live = await readSemanticSource(f.home, "demo", "guide.md");
    await importSemanticCandidates(f.home, "demo", { path: live.path, hash: live.hash, revision: 1, candidates: [], usage: { retrieval: true, graph: false } });
    const state = await readSemanticState(f.home, "demo");
    expect(state.versions).toHaveLength(2); expect(state.versions[0]?.content).toContain("30일");
    expect((await searchRag(f.home, "demo", "로그")).hits[0]?.text).toContain("90일");
  });
  it("hides paths, titles, counts and cached text after a file becomes inaccessible", async () => {
    const f = await fixture(); await f.add();
    const old = await searchRag(f.home, "demo", "Neo4j");
    await fs.rename(path.join(f.repo, "guide.md"), path.join(f.root, "outside.md"));
    await fs.symlink(path.join(f.root, "outside.md"), path.join(f.repo, "guide.md"));
    expect((await loadRagSources(f.home, "demo")).sources).toEqual([]);
    const current = await searchRag(f.home, "demo", "Neo4j");
    expect(current.activeSources).toBe(0); expect(current.changed).toEqual([]);
    expect(JSON.stringify(current)).not.toContain("guide.md");
    await expect(validateRagContext(f.home, "demo", old)).rejects.toMatchObject({ status: 403 });
  });
  it("denies remote delivery until explicit policy and invalidates a context when consent is revoked", async () => {
    const f = await fixture(); await f.add();
    let search = await searchRag(f.home, "demo", "로그");
    await expect(validateRagContext(f.home, "demo", search, true)).rejects.toMatchObject({ status: 403 });
    await updateSemanticSourceUsage(f.home, "demo", { sourceId: f.source.sourceId, revision: 1, retrieval: true, remoteTransfer: true });
    search = await searchRag(f.home, "demo", "로그"); await validateRagContext(f.home, "demo", search, true);
    await updateSemanticSourceUsage(f.home, "demo", { sourceId: f.source.sourceId, revision: 2, retrieval: true, remoteTransfer: false });
    await expect(validateRagContext(f.home, "demo", search, true)).rejects.toMatchObject({ status: 409 });
  });
  it("rejects invented ids, altered quotes and uncited claims; allows explicit abstention", async () => {
    const f = await fixture(); await f.add(); const search = await searchRag(f.home, "demo", "보관 기간");
    const hit = search.hits[0]!;
    const answer = (id: string, quote: string) => JSON.stringify({ status: "supported", claims: [{ text: "로그는 30일 보관합니다.", citations: [{ id, quote }] }] });
    expect(validateRagAnswer(answer(hit.id, "보관 기간은 30일이다."), search).status).toBe("supported");
    expect(() => validateRagAnswer(answer("99", hit.text), search)).toThrow();
    expect(() => validateRagAnswer(answer(hit.id, "로그는 영구 보관된다"), search)).toThrow();
    expect(() => validateRagAnswer(answer(hit.id, hit.text).replace('"supported"', '"conflicting"'), search)).toThrow();
    expect(() => validateRagAnswer('{"status":"supported","claims":[{"text":"정답","citations":[]}]}', search)).toThrow();
    expect(validateRagAnswer('{"status":"insufficient","claims":[]}', search).status).toBe("insufficient");
    expect(() => validateRagAnswer('{"status":"ambiguous","claims":[{"text":"추정","citations":[]}]}', search)).toThrow();
    await expect(openRagCitation(f.home, "demo", { ...hit, start: hit.start + 1 })).rejects.toMatchObject({ status: 409 });
  });
});

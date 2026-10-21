import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureStudioInitialized, registerProject } from "../studio/studioStore.js";
import { importSemanticCandidates, loadSemanticWorkspace, readSemanticSource, readSemanticState, reviewSemanticEvidence, semanticProjection, semanticPaths } from "./semantic.js";
import { workspaceFileGrade } from "../studio/workspaceFiles.js";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pb-semantic-core-")), home = path.join(root, "workspace"), repo = path.join(root, "repo");
  await fs.mkdir(repo); await ensureStudioInitialized(home); await registerProject(home, { alias: "demo", kind: "local_repo", path: repo });
  await fs.writeFile(path.join(repo, "guide.md"), "# 그래프\n\nPatchbay는 Neo4j를 사용한다.\n\nNeo4j는 드라이버에 의존한다.\n");
  const source = await readSemanticSource(home, "demo", "guide.md");
  const candidate = { subject: "Patchbay", predicate: "USES" as const, object: "Neo4j", quote: source.chunks[0]!.text, chunkId: source.chunks[0]!.id };
  return { root, home, repo, source, candidate };
}
describe("reviewed semantic knowledge", () => {
  it("stores exact source versions and only approves individual evidence with optimistic concurrency", async () => {
    const f = await fixture();
    await importSemanticCandidates(f.home, "demo", { path: f.source.path, hash: f.source.hash, revision: 0, candidates: [f.candidate] });
    let v = await loadSemanticWorkspace(f.home, "demo");
    expect(v.counts.pending).toBe(1); expect(v.rows[0]?.line).toBe(3);
    expect((await readSemanticState(f.home, "demo")).versions[0]?.content).toContain("# 그래프");
    await reviewSemanticEvidence(f.home, "demo", { revision: v.revision, id: v.rows[0]!.id, decision: "approved", note: "원문 확인" });
    await expect(reviewSemanticEvidence(f.home, "demo", { revision: 1, id: v.rows[0]!.id, decision: "rejected" })).rejects.toMatchObject({ status: 409 });
    v = await loadSemanticWorkspace(f.home, "demo");
    expect(v.counts.approved).toBe(1); expect(v.rows[0]?.history[0]?.note).toBe("원문 확인");
    const state = await readSemanticState(f.home, "demo");
    expect(semanticProjection(state, 1).evidence[0]?.decision).toBe("pending");
    expect(semanticProjection(state, 2).evidence[0]?.decision).toBe("approved");
  });
  it("suppresses duplicate and rejected candidates across repeated extraction", async () => {
    const f = await fixture();
    await importSemanticCandidates(f.home, "demo", { path: f.source.path, hash: f.source.hash, revision: 0, candidates: [f.candidate, f.candidate] });
    let v = await loadSemanticWorkspace(f.home, "demo");
    expect(v.rows).toHaveLength(1);
    await reviewSemanticEvidence(f.home, "demo", { revision: v.revision, id: v.rows[0]!.id, decision: "rejected" });
    await importSemanticCandidates(f.home, "demo", { path: f.source.path, hash: f.source.hash, revision: 2, candidates: [f.candidate] });
    v = await loadSemanticWorkspace(f.home, "demo");
    expect(v.revision).toBe(2); expect(v.counts.pending).toBe(0); expect(v.counts.rejected).toBe(1);
  });
  it("keeps separate review states for multiple evidence of the same claim", async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.repo, "guide.md"), "# 그래프\n\nPatchbay는 Neo4j를 사용한다.\n\n다른 설명: Patchbay는 Neo4j를 사용한다.\n");
    const s = await readSemanticSource(f.home, "demo", "guide.md");
    await importSemanticCandidates(f.home, "demo", { path: s.path, hash: s.hash, revision: 0, candidates: s.chunks.map(c => ({ ...f.candidate, chunkId: c.id, quote: c.text })) });
    let v = await loadSemanticWorkspace(f.home, "demo");
    expect(new Set(v.rows.map(r => r.claimId)).size).toBe(1);
    await reviewSemanticEvidence(f.home, "demo", { revision: 1, id: v.rows[0]!.id, decision: "approved" });
    await reviewSemanticEvidence(f.home, "demo", { revision: 2, id: v.rows[1]!.id, decision: "rejected" });
    v = await loadSemanticWorkspace(f.home, "demo");
    expect(v.counts.approved).toBe(1); expect(v.counts.rejected).toBe(1);
  });
  it("reuses unchanged paragraphs after line shifts but invalidates changed content and heading context", async () => {
    const f = await fixture();
    await importSemanticCandidates(f.home, "demo", { path: f.source.path, hash: f.source.hash, revision: 0, candidates: [f.candidate] });
    const first = (await loadSemanticWorkspace(f.home, "demo")).rows[0]!;
    await reviewSemanticEvidence(f.home, "demo", { revision: 1, id: first.id, decision: "approved" });
    await fs.writeFile(path.join(f.repo, "guide.md"), "# 그래프\n\n\n\nPatchbay는 Neo4j를 사용한다.\n\nNeo4j는 드라이버에 의존한다.\n");
    let v = await loadSemanticWorkspace(f.home, "demo");
    expect(v.sources[0]?.status).toBe("changed"); expect(v.rows[0]?.current).toBe(true); expect(v.rows[0]?.line).toBe(5);
    let s = await readSemanticSource(f.home, "demo", "guide.md");
    await importSemanticCandidates(f.home, "demo", { path: s.path, hash: s.hash, revision: 2, candidates: [{ ...f.candidate, chunkId: s.chunks[0]!.id }] });
    v = await loadSemanticWorkspace(f.home, "demo");
    expect(v.rows).toHaveLength(1); expect(v.counts.approved).toBe(1); expect(v.sources[0]?.versions).toBe(2);
    await fs.writeFile(path.join(f.repo, "guide.md"), "# 가상 예시\n\nPatchbay는 Neo4j를 사용한다.\n");
    v = await loadSemanticWorkspace(f.home, "demo");
    expect(v.counts.approved).toBe(0); expect(v.counts.stale).toBe(1);
    await expect(reviewSemanticEvidence(f.home, "demo", { revision: 3, id: first.id, decision: "approved" })).rejects.toMatchObject({ status: 409 });
    s = await readSemanticSource(f.home, "demo", "guide.md");
    await importSemanticCandidates(f.home, "demo", { path: s.path, hash: s.hash, revision: 3, candidates: [{ ...f.candidate, chunkId: s.chunks[0]!.id }] });
    expect((await loadSemanticWorkspace(f.home, "demo")).counts.pending).toBe(1);
  });
  it("rejects invented quotations, altered inputs and unsupported predicates without saving partial data", async () => {
    const f = await fixture();
    await expect(importSemanticCandidates(f.home, "demo", { path: f.source.path, hash: f.source.hash, revision: 0, candidates: [f.candidate, { ...f.candidate, quote: "없는 문장" }] })).rejects.toMatchObject({ status: 422 });
    expect((await readSemanticState(f.home, "demo")).seq).toBe(0);
    await expect(importSemanticCandidates(f.home, "demo", { path: f.source.path, hash: "old", revision: 0, candidates: [f.candidate] })).rejects.toMatchObject({ status: 409 });
    expect((await readSemanticState(f.home, "demo")).sources).toHaveLength(0);
  });
  it("does not reveal cached evidence when a source moves outside the project or becomes secret", async () => {
    const f = await fixture();
    await importSemanticCandidates(f.home, "demo", { path: f.source.path, hash: f.source.hash, revision: 0, candidates: [f.candidate] });
    await fs.rename(path.join(f.repo, "guide.md"), path.join(f.root, "outside.md"));
    await fs.symlink(path.join(f.root, "outside.md"), path.join(f.repo, "guide.md"));
    const v = await loadSemanticWorkspace(f.home, "demo");
    expect(v.rows).toEqual([]); expect(v.sources[0]?.status).toBe("unavailable");
    expect(JSON.stringify(v)).not.toContain("Patchbay");
    await expect(readSemanticSource(f.home, "demo", "guide.md")).rejects.toMatchObject({ status: 403 });
    await expect(readSemanticSource(f.home, "demo", "../outside.md")).rejects.toMatchObject({ status: 400 });
    await fs.mkdir(path.join(f.repo, "secrets")); await fs.writeFile(path.join(f.repo, "secrets", "private.md"), "hidden");
    await fs.symlink(path.join(f.repo, "secrets", "private.md"), path.join(f.repo, "link.md"));
    await expect(readSemanticSource(f.home, "demo", "link.md")).rejects.toMatchObject({ status: 403 });
  });
  it("keeps project aliases and same-named entities from different sources separate", async () => {
    const f = await fixture(); await fs.copyFile(path.join(f.repo, "guide.md"), path.join(f.repo, "other.md"));
    await importSemanticCandidates(f.home, "demo", { path: f.source.path, hash: f.source.hash, revision: 0, candidates: [f.candidate] });
    const s = await readSemanticSource(f.home, "demo", "other.md");
    await importSemanticCandidates(f.home, "demo", { path: s.path, hash: s.hash, revision: 1, candidates: [{ ...f.candidate, chunkId: s.chunks[0]!.id }] });
    const v = await loadSemanticWorkspace(f.home, "demo");
    expect(v.rows[0]?.from).not.toBe(v.rows[1]?.from);
    await registerProject(f.home, { alias: "another", kind: "local_repo", path: f.repo });
    expect((await loadSemanticWorkspace(f.home, "another")).rows).toEqual([]);
    await expect(readSemanticState(f.home, "../invalid")).rejects.toMatchObject({ status: 404 });
    expect(semanticPaths(f.home, "demo").state).toContain(path.join("projects", "demo", "knowledge", "semantic.json"));
    expect(workspaceFileGrade("knowledge/semantic.json")).toBe("live");
  });
});
